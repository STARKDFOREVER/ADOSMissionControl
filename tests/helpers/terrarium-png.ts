/**
 * Synthetic terrarium tiles for terrain tests: encode a 256×256 PNG whose
 * pixels carry chosen elevations, plus the inverse of the Web Mercator pixel
 * mapping and an in-memory stand-in for idb-keyval.
 * @license GPL-3.0-only
 */
import { deflate } from 'pako';

export interface PngOptions {
  /** PNG colour type: 2 RGB, 6 RGBA. */
  colour?: 2 | 6;
  /** Filter type per row; rows past the end use filter 0. */
  filters?: number[];
  /** IHDR bit depth written (only 8 produces a valid tile). */
  depth?: number;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  return out; // CRC left zero; the decoder does not check it
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Encode a tile whose pixel (col, row) holds `elevation(col, row)` metres. */
export function encodeTerrariumPng(
  elevation: (col: number, row: number) => number,
  { colour = 2, filters = [], depth = 8 }: PngOptions = {},
): Uint8Array {
  const bpp = colour === 6 ? 4 : 3;
  const stride = 256 * bpp;
  const pixels = new Uint8Array(256 * stride);
  for (let row = 0; row < 256; row++) {
    for (let col = 0; col < 256; col++) {
      const v = elevation(col, row) + 32768;
      const i = row * stride + col * bpp;
      pixels[i] = Math.floor(v / 256);
      pixels[i + 1] = Math.floor(v) % 256;
      pixels[i + 2] = Math.round((v - Math.floor(v)) * 256);
      if (bpp === 4) pixels[i + 3] = 255;
    }
  }
  const raw = new Uint8Array(256 * (stride + 1));
  for (let row = 0; row < 256; row++) {
    const filter = filters[row] ?? 0;
    raw[row * (stride + 1)] = filter;
    for (let i = 0; i < stride; i++) {
      const at = row * stride + i;
      const a = i >= bpp ? pixels[at - bpp] : 0;
      const b = row > 0 ? pixels[at - stride] : 0;
      const c = row > 0 && i >= bpp ? pixels[at - stride - bpp] : 0;
      const predictor = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter];
      raw[row * (stride + 1) + 1 + i] = (pixels[at] - predictor) & 0xff;
    }
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, 256);
  view.setUint32(4, 256);
  ihdr[8] = depth;
  ihdr[9] = colour;
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflate(raw)),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Latitude and longitude of global pixel coordinates (`x`, `y`) at zoom `z`. */
export function latLonOfPixel(x: number, y: number, z: number): { lat: number; lon: number } {
  const size = 2 ** z * 256;
  const n = Math.PI * (1 - (2 * y) / size);
  return { lat: (Math.atan(Math.sinh(n)) * 180) / Math.PI, lon: (x / size) * 360 - 180 };
}

/** In-memory idb-keyval: one Map per store name. */
export function createIdbMock(stores: Map<string, Map<string, unknown>>) {
  const of = (store: unknown) => {
    const name = store as string;
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name)!;
  };
  return {
    createStore: (_db: string, name: string) => name,
    get: async (k: string, s: unknown) => of(s).get(k),
    set: async (k: string, v: unknown, s: unknown) => {
      of(s).set(k, v);
    },
    keys: async (s: unknown) => [...of(s).keys()],
    entries: async (s: unknown) => [...of(s).entries()],
    delMany: async (ks: string[], s: unknown) => {
      for (const k of ks) of(s).delete(k);
    },
  };
}
