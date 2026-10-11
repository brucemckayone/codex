import { describe, expect, it } from 'vitest';
import {
  LIVE_VEIL_MARGIN,
  liveVeil,
  luminance,
  type Rgb,
  textFloor,
  type VeilBackdrop,
} from './live-veil';

const PAPER: Rgb = [232, 236, 214]; // of-blood-and-bones' tinted light veil
const NIGHT: Rgb = [30, 33, 19]; // and its dark one
const SOFT_INK: Rgb = [77, 78, 70]; // its light soft ink
const SOFT_INK_DARK: Rgb = [169, 170, 169];
const cell = (lo: Rgb, hi: Rgb): VeilBackdrop => ({ lo, hi });
const flat = (c: Rgb) => cell(c, c);

const ratio = (a: Rgb, b: Rgb) => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const over = (s: number, g: Rgb, b: Rgb): Rgb => [
  s * g[0] + (1 - s) * b[0],
  s * g[1] + (1 - s) * b[1],
  s * g[2] + (1 - s) * b[2],
];

describe('liveVeil', () => {
  const light = { ground: PAPER, thin: 0.71, floor: 0.82 };

  it('goes as thin as the Style asks over a shader as light as the paper', () => {
    expect(
      liveVeil({
        ...light,
        inks: [{ rgb: SOFT_INK, floor: 4.5 }],
        backdrops: [flat(PAPER)],
      })
    ).toBe(0.71);
  });

  it('keeps the proven veil until the shader has been measured, or with nothing to hold', () => {
    expect(
      liveVeil({
        ...light,
        inks: [{ rgb: SOFT_INK, floor: 4.5 }],
        backdrops: [],
      })
    ).toBe(0.82);
    expect(liveVeil({ ...light, inks: [], backdrops: [flat(PAPER)] })).toBe(
      0.82
    );
  });

  it('never goes thinner than the Style asks, nor thicker than the proven veil', () => {
    const black = flat([0, 0, 0]);
    const veil = liveVeil({
      ...light,
      inks: [{ rgb: SOFT_INK, floor: 4.5 }],
      backdrops: [black],
    });
    expect(veil).toBeGreaterThanOrEqual(0.71);
    expect(veil).toBeLessThanOrEqual(0.82);
  });

  it('thickens over a dark shader until the soft ink holds, 2% past its floor', () => {
    const dusk = flat([60, 64, 40]);
    const veil = liveVeil({
      ...light,
      inks: [{ rgb: SOFT_INK, floor: 4.5 }],
      backdrops: [dusk],
    });
    expect(veil).toBeGreaterThan(0.71);
    expect(ratio(SOFT_INK, over(veil, PAPER, dusk.lo))).toBeGreaterThanOrEqual(
      4.5 * LIVE_VEIL_MARGIN
    );
    // One step thinner does not hold: it is the thinnest.
    expect(ratio(SOFT_INK, over(veil - 0.005, PAPER, dusk.lo))).toBeLessThan(
      4.5 * LIVE_VEIL_MARGIN
    );
  });

  it('answers to the worst cell, not the average one', () => {
    const inks = [{ rgb: SOFT_INK, floor: 4.5 }];
    const one = liveVeil({ ...light, inks, backdrops: [flat([60, 64, 40])] });
    const many = liveVeil({
      ...light,
      inks,
      backdrops: [flat(PAPER), flat([60, 64, 40]), flat(PAPER)],
    });
    expect(many).toBe(one);
  });

  it("reads a cell's lightest colour as well as its darkest: a light ink on the dark veil", () => {
    // Nothing under the dark veil is darker than the veil itself, so only a
    // bright patch can wash the light ink out.
    const bright = cell(NIGHT, [235, 230, 240]);
    const veil = liveVeil({
      ground: NIGHT,
      thin: 0.78,
      floor: 0.86,
      inks: [{ rgb: SOFT_INK_DARK, floor: 4.5 }],
      backdrops: [bright],
    });
    expect(veil).toBeGreaterThan(0.78);
    expect(
      ratio(SOFT_INK_DARK, over(veil, NIGHT, bright.hi))
    ).toBeGreaterThanOrEqual(4.5 * LIVE_VEIL_MARGIN);
  });

  it('holds an ink whose own lightness falls inside the run a cell draws to the proven veil', () => {
    // A cell from pure black to pure white under a thin grey veil: both of
    // its ends hold 3:1 against a mid-grey ink (4.6 and 4.57), but between
    // them it draws the ink's own lightness, where nothing can be read.
    const grey: Rgb = [118, 118, 118];
    const everything = cell([0, 0, 0], [255, 255, 255]);
    expect(ratio(grey, [0, 0, 0])).toBeGreaterThan(3 * LIVE_VEIL_MARGIN);
    expect(ratio(grey, [255, 255, 255])).toBeGreaterThan(3 * LIVE_VEIL_MARGIN);
    expect(
      liveVeil({
        ground: [128, 128, 128],
        thin: 0,
        floor: 0.5,
        inks: [{ rgb: grey, floor: 3 }],
        backdrops: [everything],
      })
    ).toBe(0.5);
  });
});

describe('textFloor', () => {
  it("is WCAG's: 3:1 from 24px, or 18.66px bold; 4.5:1 below", () => {
    expect(textFloor(24, 400)).toBe(3);
    expect(textFloor(18.66, 700)).toBe(3);
    expect(textFloor(18.66, 600)).toBe(4.5);
    expect(textFloor(23.9, 400)).toBe(4.5);
  });
});
