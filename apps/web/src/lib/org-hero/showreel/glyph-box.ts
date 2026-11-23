/**
 * The box a word's glyphs fill, for the Showreel's fit: the union of its
 * text's own line boxes, never its block's.
 * OBB's kicker is a block as wide as the words' column (x 0.06 to 0.62 at
 * 1440) while its glyphs end at 0.18. Judged by the block, the shades the fit
 * grew fell short at its far end (0.52 against 0.57) and the reel reported
 * the kicker uncarried on every load, where the probe, which reads the pixels
 * round the glyphs, measured it passing.
 */

/** A box in the page, as `getBoundingClientRect` gives one. */
export interface GlyphBox {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

/**
 * `el`'s glyphs: its contents' client rects, joined. Its own box when it
 * lays out no text (an icon), or where the engine gives no rects for a range
 * (jsdom has no `Range.getClientRects`).
 */
export function glyphBox(el: Element): GlyphBox {
  const own = el.getBoundingClientRect();
  const range = el.ownerDocument.createRange();
  if (typeof range.getClientRects !== 'function') return own;
  range.selectNodeContents(el);
  const lines = [...range.getClientRects()].filter(
    (r) => r.width > 0.5 && r.height > 0.5
  );
  if (lines.length === 0) return own;
  const left = Math.min(...lines.map((r) => r.left));
  const top = Math.min(...lines.map((r) => r.top));
  const right = Math.max(...lines.map((r) => r.right));
  const bottom = Math.max(...lines.map((r) => r.bottom));
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}
