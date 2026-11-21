/**
 * The title as the film's window on the Corner and Wide layouts (Codex-1yd58.7,
 * WP-6; owner, 2026-11-21): the big title words are the letters "through the
 * name" plays in, so the opening and the way into the film run on every
 * layout, the defaults included. The Name window draws the org's name the
 * same way (Showreel's `drawMask`, from `name-lines`).
 *
 * The title wraps where the page wraps it (`text-wrap: balance`), so its
 * lines are read from the page, never re-wrapped here: each word's box comes
 * from a Range over its text, in the title's own font. The words' swap moves
 * the title a few px (`translateY`), so each box is taken back by the
 * title's computed translation: the window is where the title SITS, never
 * where its rise has it this frame.
 *
 * The canvas is window sized, white on black (the compositor reads the red
 * channel), the words placed in document space as the Name window's are.
 */

/** A word of the title where the page lays it out, in CSS px. */
export interface MaskWord {
  readonly text: string;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** The words of `text` and where each sits in it. PURE. */
export function wordsAt(
  text: string
): { word: string; start: number; end: number }[] {
  return [...text.matchAll(/\S+/g)].map((match) => {
    const start = match.index ?? 0;
    return { word: match[0], start, end: start + match[0].length };
  });
}

/**
 * The translation a computed `transform` applies, in px: `none`, a
 * `matrix(a, b, c, d, e, f)` (e, f) or a `matrix3d(...)` (its 13th and 14th).
 * PURE.
 */
export function translationOf(transform: string): { x: number; y: number } {
  const values = /^matrix(3d)?\(([^)]*)\)$/.exec(transform.trim());
  if (!values?.[2]) return { x: 0, y: 0 };
  const n = values[2].split(',').map((v) => Number.parseFloat(v));
  const at = values[1] ? 12 : 4;
  const x = n[at] ?? 0;
  const y = n[at + 1] ?? 0;
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
  };
}

/** Each word of the title `el` where it sits, in document space. */
export function titleWords(el: HTMLElement): MaskWord[] {
  const doc = el.ownerDocument;
  const view = doc.defaultView;
  if (!view) return [];
  const shift = translationOf(view.getComputedStyle(el).transform);
  const words: MaskWord[] = [];
  const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? '';
    for (const { word, start, end } of wordsAt(text)) {
      const range = doc.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      const box = range.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) continue;
      words.push({
        text: word,
        left: box.left - shift.x,
        top: box.top - shift.y + view.scrollY,
        width: box.width,
        height: box.height,
      });
    }
  }
  return words;
}

/** The longest side the mask is drawn at, in device px per CSS px. */
const MAX_DPR = 2;

/**
 * How far below a word box's top the page sets the baseline, measured in the
 * page, for a browser whose `measureText` reports no content area (Firefox
 * before 116): a zero-size inline-block's bottom sits on its line's
 * baseline, so one at the end of the title, on its last word's line,
 * measures it for every word (one font, one size). It is taken out at once.
 */
function measuredBaseline(el: HTMLElement, last: MaskWord): number {
  const view = el.ownerDocument.defaultView;
  const shift = translationOf(view?.getComputedStyle(el).transform ?? 'none');
  const marker = el.ownerDocument.createElement('span');
  marker.style.cssText =
    'display:inline-block;width:0;height:0;vertical-align:baseline';
  el.appendChild(marker);
  try {
    const { bottom } = marker.getBoundingClientRect();
    // in document space, as the words are
    return bottom - shift.y + (view?.scrollY ?? 0) - last.top;
  } finally {
    marker.remove();
  }
}

/**
 * The title `el` drawn as the film's window: a window-sized canvas, the words
 * white on black in the title's font. Null when there is no word to draw (no
 * title, or one not laid out), so "through the name" falls back.
 */
export function drawTitleMask(el: HTMLElement): HTMLCanvasElement | null {
  const doc = el.ownerDocument;
  const view = doc.defaultView;
  const { clientWidth: width, clientHeight: height } = doc.documentElement;
  // No window laid out (a page not rendered yet): nothing to place words in.
  if (!view || width <= 0 || height <= 0) return null;
  const words = titleWords(el);
  if (words.length === 0) return null;
  const dpr = Math.min(view.devicePixelRatio || 1, MAX_DPR);
  const canvas = doc.createElement('canvas');
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const style = view.getComputedStyle(el);
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#fff';
  ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  if (style.letterSpacing && style.letterSpacing !== 'normal')
    ctx.letterSpacing = style.letterSpacing;
  ctx.textAlign = 'left';
  // Each word on its baseline where the page sets it: the font's content
  // area (its ascent and descent) centred in the word's box, as CSS lays
  // glyphs in a line (half-leading). The em square's middle ('middle' at
  // the box's middle) sits higher in most faces: 8 CSS px at 96 px in OBB's
  // serif, a copy of the title showing above its ink (the WP-6 board).
  ctx.textBaseline = 'alphabetic';
  let measured: number | null = null;
  for (const word of words) {
    const { fontBoundingBoxAscent: ascent, fontBoundingBoxDescent: descent } =
      ctx.measureText(word.text);
    const area = ascent + descent;
    let below: number;
    if (Number.isFinite(area)) below = (word.height - area) / 2 + ascent;
    else {
      measured ??= measuredBaseline(el, words[words.length - 1] ?? word);
      below = measured;
    }
    ctx.fillText(word.text, word.left, word.top + below);
  }
  return canvas;
}
