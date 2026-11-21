/**
 * The duotone's three stops (WP-5b review M1): the brand's dark, its
 * primary, a pale of it. On an extreme brand (Mono's #000 on #FFF and #FFF
 * on #0A0A0A, or any #000 ground) the old stops were literal black and
 * white. Every stop now keeps off the extremes, and a primary near black or
 * white gives a midpoint near mid-grey, so the footage keeps its light.
 */
import { describe, expect, it } from 'vitest';
import { DUOTONE_FLOOR, duotoneStops, type Rgb } from '../duotone';

const hex = (h: string): Rgb => [
  Number.parseInt(h.slice(1, 3), 16) / 255,
  Number.parseInt(h.slice(3, 5), 16) / 255,
  Number.parseInt(h.slice(5, 7), 16) / 255,
];
const luma = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Every channel of every stop off the extremes, and the light rising. */
function expectHeld(stops: readonly Rgb[]) {
  for (const stop of stops) {
    for (const channel of stop) {
      expect(channel).toBeGreaterThanOrEqual(DUOTONE_FLOOR);
      expect(channel).toBeLessThanOrEqual(1 - DUOTONE_FLOOR);
    }
  }
  const [deep, mid, pale] = stops.map(luma);
  expect(deep).toBeLessThan(mid);
  expect(mid).toBeLessThan(pale);
}

describe('duotoneStops', () => {
  it('keeps Mono light (#000 on #FFF) off black and white, its middle near grey', () => {
    const stops = duotoneStops(hex('#000000'), hex('#FFFFFF'));
    expectHeld(stops);
    for (const channel of stops[1]) expect(channel).toBeCloseTo(0.5, 1);
  });

  it('keeps Mono dark (#FFF on #0A0A0A) off black and white, its middle near grey', () => {
    const stops = duotoneStops(hex('#FFFFFF'), hex('#0A0A0A'));
    expectHeld(stops);
    for (const channel of stops[1]) expect(channel).toBeCloseTo(0.5, 1);
  });

  it('keeps a #000 ground off black', () => {
    const stops = duotoneStops(hex('#CB213C'), hex('#000000'));
    expectHeld(stops);
    // the ground is still the dark: as near it as the floor allows
    for (const channel of stops[0]) expect(channel).toBe(DUOTONE_FLOOR);
  });

  it('leaves a brand with a colour of its own its own primary in the middle', () => {
    // OBB's red on its dark ground
    const [deep, mid, pale] = duotoneStops(hex('#CB213C'), hex('#0F0000'));
    expect(mid).toEqual(hex('#CB213C'));
    expectHeld([deep, mid, pale]);
    // a saturated blue is no near-black, though its light is low
    expect(duotoneStops(hex('#0000FF'), hex('#FFFFFF'))[1]).toEqual([
      DUOTONE_FLOOR,
      DUOTONE_FLOOR,
      1 - DUOTONE_FLOOR,
    ]);
  });
});
