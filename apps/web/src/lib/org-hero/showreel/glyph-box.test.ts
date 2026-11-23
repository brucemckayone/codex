/**
 * The box the Showreel's fit judges a word by (review R4): its glyphs', not
 * its block's. jsdom lays out nothing and has no `Range.getClientRects`, so
 * each case says what the engine would.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { glyphBox } from './glyph-box';

const rect = (left: number, top: number, right: number, bottom: number) => ({
  left,
  top,
  right,
  bottom,
  width: right - left,
  height: bottom - top,
  x: left,
  y: top,
  toJSON: () => ({}),
});

afterEach(() => {
  Reflect.deleteProperty(Range.prototype, 'getClientRects');
  vi.restoreAllMocks();
});

/** A kicker as OBB lays it out at 1440: a block as wide as the column. */
function kicker() {
  const p = document.createElement('p');
  p.innerHTML = '<b>01</b> <span>Our film, 0:30</span>';
  document.body.appendChild(p);
  vi.spyOn(p, 'getBoundingClientRect').mockReturnValue(rect(85, 340, 891, 372));
  return p;
}

describe('glyphBox', () => {
  it("is the word's glyphs, joined: never the block's far end", () => {
    const p = kicker();
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: () => [
        rect(85, 341, 101, 371),
        rect(101, 341, 106, 371),
        rect(106, 340, 256, 372),
      ],
    });
    expect(glyphBox(p)).toMatchObject({
      left: 85,
      top: 340,
      right: 256,
      bottom: 372,
      width: 171,
    });
  });

  it('keeps its own box when the engine gives no rects for a range (jsdom), or it lays out no text', () => {
    const p = kicker();
    expect(glyphBox(p)).toMatchObject({ left: 85, right: 891 });
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: () => [rect(0, 0, 0, 0)],
    });
    expect(glyphBox(p)).toMatchObject({ left: 85, right: 891 });
  });
});
