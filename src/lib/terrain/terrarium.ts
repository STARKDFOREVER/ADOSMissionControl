/**
 * @module terrain/terrarium
 * @description Terrain tile addressing and decoding for the open "terrarium"
 * elevation tiles (Mapzen Terrain Tiles on AWS Open Data).
 *
 * Each tile is a 256×256 Web Mercator PNG whose pixel colour encodes height
 * in metres above mean sea level: `r * 256 + g + b / 256 - 32768`. The PNG is
 * decoded here byte for byte (inflate plus the PNG row filters) rather than
 * through a canvas, because browser colour management may alter the encoded
 * values on the way through a canvas.
 *
 * @license GPL-3.0-only
 */

import { inflate } from "pako";

/** Tile set root; tiles live at `{z}/{x}/{y}.png` below it. */
export const TERRAIN_TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";

/** Zoom the planner reads: about 15 m pixels at mid latitudes. */
export const TERRAIN_ZOOM = 13;

/** Pixels along each tile edge. */
export const TILE_SIZE = 256;

/** Web Mercator latitude limit, degrees. */
const MAX_LAT = 85.05112878;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function unsupported(): Error {
  return new Error("Unsupported terrain tile");
}

function readU32(bytes: Uint8Array, at: number): number {
  return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * Decode a terrarium PNG to 65,536 elevations in metres, row-major from the
 * north-west corner.
 *
 * @throws Error("Unsupported terrain tile") for anything but a 256×256,
 *   8-bit, non-interlaced RGB or RGBA PNG.
 */
export function decodeTerrariumPng(bytes: Uint8Array): Float32Array {
  if (bytes.length < 33 || PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) throw unsupported();

  let width = 0;
  let bpp = 0;
  const idat: Uint8Array[] = [];
  let idatLength = 0;
  let at = 8;
  let sawHeader = false;
  while (at + 8 <= bytes.length) {
    const length = readU32(bytes, at);
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    const data = at + 8;
    if (data + length > bytes.length) throw unsupported();
    if (type === "IHDR") {
      width = readU32(bytes, data);
      const height = readU32(bytes, data + 4);
      const depth = bytes[data + 8];
      const colour = bytes[data + 9];
      const interlace = bytes[data + 12];
      if (width !== TILE_SIZE || height !== TILE_SIZE || depth !== 8 || interlace !== 0) throw unsupported();
      if (colour === 2) bpp = 3;
      else if (colour === 6) bpp = 4;
      else throw unsupported();
      sawHeader = true;
    } else if (type === "IDAT") {
      idat.push(bytes.subarray(data, data + length));
      idatLength += length;
    } else if (type === "IEND") {
      break;
    }
    at = data + length + 4; // skip the CRC
  }
  if (!sawHeader || idat.length === 0) throw unsupported();

  const compressed = new Uint8Array(idatLength);
  let offset = 0;
  for (const chunk of idat) {
    compressed.set(chunk, offset);
    offset += chunk.length;
  }
  let raw: Uint8Array;
  try {
    raw = inflate(compressed);
  } catch {
    throw unsupported();
  }

  const stride = width * bpp;
  if (raw.length < TILE_SIZE * (stride + 1)) throw unsupported();

  // Unfilter in place into `pixels`, row by row.
  const pixels = new Uint8Array(TILE_SIZE * stride);
  for (let row = 0; row < TILE_SIZE; row++) {
    const filter = raw[row * (stride + 1)];
    const src = row * (stride + 1) + 1;
    const dst = row * stride;
    const up = dst - stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i];
      const a = i >= bpp ? pixels[dst + i - bpp] : 0;
      const b = row > 0 ? pixels[up + i] : 0;
      const c = row > 0 && i >= bpp ? pixels[up + i - bpp] : 0;
      let v: number;
      switch (filter) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: v = x + paeth(a, b, c); break;
        default: throw unsupported();
      }
      pixels[dst + i] = v & 0xff;
    }
  }

  const out = new Float32Array(TILE_SIZE * TILE_SIZE);
  for (let p = 0; p < out.length; p++) {
    const i = p * bpp;
    out[p] = pixels[i] * 256 + pixels[i + 1] + pixels[i + 2] / 256 - 32768;
  }
  return out;
}

/** Web Mercator global pixel coordinates of a point at zoom `z`. */
export function worldPixel(lat: number, lon: number, z: number): { x: number; y: number } {
  const size = 2 ** z * TILE_SIZE;
  const phi = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * size,
    y: ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * size,
  };
}

/** URL of one terrain tile. */
export function tileUrl(z: number, x: number, y: number): string {
  return `${TERRAIN_TILE_URL}/${z}/${x}/${y}.png`;
}
