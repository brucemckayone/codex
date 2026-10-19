import { describe, expect, it } from 'vitest';
import { dialNoEffect } from './dial-effect';
import { PAGE_DIALS, PAGE_STYLE_IDS, type PageDialId } from './ids';

const ROUNDED = { roundedBrand: true };

/** Every step of `dial` that changes nothing, in every Style, as `style:step:reason`. */
function noEffects(dial: PageDialId, context = ROUNDED): string[] {
  return PAGE_STYLE_IDS.flatMap((style) =>
    PAGE_DIALS[dial].flatMap((step) => {
      const reason = dialNoEffect(style, dial, step, context);
      return reason ? [`${style}:${step}:${reason}`] : [];
    })
  );
}

describe('the steps that change nothing (03 X61, Codex-61zsk.59)', () => {
  it('colour: computed from each Style’s own bands, exactly X61’s list', () => {
    expect(noEffects('colour')).toEqual([
      'bold:vivid:no-tints',
      'cinematic:muted:no-coloured-bands',
      'poster:vivid:no-tints',
      'quiet:muted:no-bands',
      'quiet:vivid:no-bands',
    ]);
  });

  it('corners: rounder is Soft’s own, and brand is Path’s own for a rounded brand only', () => {
    expect(noEffects('corners')).toEqual([
      'soft:rounder:own-corners',
      'path:brand:own-corners',
    ]);
    // A square brand's chips are square on Path; the dial makes them pills.
    expect(noEffects('corners', { roundedBrand: false })).toEqual([
      'soft:rounder:own-corners',
    ]);
  });

  it.each([
    'spacing',
    'drama',
    'motion',
  ] as const)('%s: every step changes the page', (dial) => {
    expect(noEffects(dial)).toEqual([]);
  });
});
