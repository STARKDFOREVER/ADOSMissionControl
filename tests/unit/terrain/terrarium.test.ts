/**
 * Terrarium tiles decode to the exact elevations they encode under every PNG
 * row filter, in RGB and RGBA; anything else is refused; points map to the
 * right Web Mercator pixel.
 * @license GPL-3.0-only
 */
import { describe, it, expect } from 'vitest';
import { decodeTerrariumPng, tileUrl, worldPixel } from '@/lib/terrain/terrarium';
import { encodeTerrariumPng } from '../../helpers/terrarium-png';

// Varied per pixel so every filter predictor sees real neighbours; a multiple
// of 1/256 m so the encoding is exact.
const height = (col: number, row: number) => -50 + ((col * 37 + row * 101) % 3000) + ((col * 7 + row) % 256) / 256;
const FILTERED_ROWS = [0, 1, 2, 3, 4];

describe('decodeTerrariumPng', () => {
  it('undoes every row filter exactly', () => {
    const decoded = decodeTerrariumPng(encodeTerrariumPng(height, { filters: FILTERED_ROWS }));
    expect(decoded).toHaveLength(65_536);
    for (const row of [0, 1, 2, 3, 4, 5, 255]) {
      for (let col = 0; col < 256; col++) expect(decoded[row * 256 + col]).toBe(height(col, row));
    }
  });

  it('decodes an RGBA tile like the RGB one', () => {
    const rgb = decodeTerrariumPng(encodeTerrariumPng(height, { filters: FILTERED_ROWS }));
    const rgba = decodeTerrariumPng(encodeTerrariumPng(height, { filters: FILTERED_ROWS, colour: 6 }));
    expect(rgba).toEqual(rgb);
  });

  it('refuses a non-PNG and a 16-bit PNG', () => {
    expect(() => decodeTerrariumPng(new TextEncoder().encode('<Error>NoSuchKey</Error>'.repeat(4)))).toThrow(
      'Unsupported terrain tile',
    );
    expect(() => decodeTerrariumPng(encodeTerrariumPng(height, { depth: 16 }))).toThrow('Unsupported terrain tile');
  });
});

describe('worldPixel', () => {
  it('maps a point to its global pixel', () => {
    const p = worldPixel(36.0602, -112.11, 13);
    expect(p.x).toBeCloseTo(395487.91, 1);
    expect(p.y).toBeCloseTo(823088.01, 1);
    expect([Math.floor(p.x / 256), Math.floor(p.y / 256)]).toEqual([1544, 3215]);
  });

  it('clamps latitude to the Mercator limit', () => {
    expect(worldPixel(90, 0, 1).y).toBeCloseTo(worldPixel(85.05112878, 0, 1).y, 9);
    expect(worldPixel(85.05112878, 0, 1).y).toBeCloseTo(0, 3);
  });
});

describe('tileUrl', () => {
  it('addresses a tile by zoom, column and row', () => {
    expect(tileUrl(13, 1549, 3218)).toBe('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/13/1549/3218.png');
  });
});
