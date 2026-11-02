/**
 * The studio's one frame of the org's moving background, for the page
 * editor (Codex-61zsk.73, #20b). The studio draws the org's shader once and
 * stops (`still`); straight after that draw the fullpage ShaderHero copies
 * the frame, small, into a picture here, and every Moving band the editor
 * draws (the canvas, each thumbnail, the Moving swatch) paints it under the
 * proven veil in place of the glow (`kit/atmosphere-still.ts`). A channel
 * beside `shaderTone`, so no second WebGL context and nothing polled: a copy
 * is taken only when the studio draws its frame again (a resize, a remount).
 */

export type StillTheme = 'light' | 'dark';

export interface ShaderStill {
  /** An object URL of the copy, revoked when a newer one replaces it. */
  url: string;
  /** The theme whose colours the shader drew it in: the other theme's bands
   *  keep the glow, since the live page would draw them in other colours. */
  theme: StillTheme;
}

/**
 * The copy's longer side, in px. A band shows it under a veil of 0.82 or
 * more, blurred as the studio draws it, so a thumbnail's worth of detail
 * fills the editor's widest band.
 */
export const STILL_SIZE = 480;
const STILL_QUALITY = 0.8;

class ShaderStillChannel {
  #still = $state.raw<ShaderStill | null>(null);
  // Each copy, and each clear, takes the next ticket: an encode that finishes
  // after a newer copy started, or after a clear, is dropped, so an older
  // frame can never land over a newer one.
  #ticket = 0;

  /** The latest copy, read reactively; null until one is taken. */
  get current(): ShaderStill | null {
    return this.#still;
  }

  /** ShaderHero: encodes `copy` (a 2D canvas it has drawn the frame on). */
  take(copy: HTMLCanvasElement, theme: StillTheme): void {
    const ticket = ++this.#ticket;
    // A null blob (an encoder that cannot) leaves whatever is shown, and a
    // band with no still keeps its glow: the glow is the designed fallback,
    // so there is nothing to report.
    copy.toBlob(
      (blob) => {
        if (!blob || ticket !== this.#ticket) return;
        this.#replace({ url: URL.createObjectURL(blob), theme });
      },
      'image/webp',
      STILL_QUALITY
    );
  }

  /** ShaderHero: the frame is gone (another shader, the studio left, unmounted). */
  clear(): void {
    this.#ticket++;
    this.#replace(null);
  }

  #replace(next: ShaderStill | null) {
    const previous = this.#still;
    this.#still = next;
    if (previous) URL.revokeObjectURL(previous.url);
  }
}

export const shaderStill = new ShaderStillChannel();

/**
 * Copies the frame `source` has just drawn, at most {@link STILL_SIZE} on its
 * longer side, to `shaderStill`. Called in the same task as the draw: the
 * drawing buffer is not preserved, so once the frame is composited it reads
 * back blank.
 *
 * `blur` is the blur the shader is drawn under (the org layout's filter), as
 * a share of the canvas's width, so the copy looks as the studio shows it.
 * Blurred, a copy fades toward its edges (the blur averages in the clear
 * pixels past them), so the frame is drawn twice the radius past every edge,
 * as the live page runs its canvas (`_org/[slug]/+layout.svelte`). A browser
 * whose 2D context has no `filter` copies it sharp.
 */
export function captureStill(
  source: HTMLCanvasElement,
  frame: { theme: StillTheme; blur: number }
): void {
  if (source.width <= 0 || source.height <= 0) return;
  const scale = Math.min(1, STILL_SIZE / Math.max(source.width, source.height));
  const copy = document.createElement('canvas');
  copy.width = Math.max(1, Math.round(source.width * scale));
  copy.height = Math.max(1, Math.round(source.height * scale));
  const ctx = copy.getContext('2d');
  if (!ctx) return;
  const radius = frame.blur * copy.width;
  if (radius > 0 && 'filter' in ctx) {
    const grow = Math.max(
      (copy.width + 4 * radius) / copy.width,
      (copy.height + 4 * radius) / copy.height
    );
    const width = copy.width * grow;
    const height = copy.height * grow;
    ctx.filter = `blur(${radius}px)`;
    ctx.drawImage(
      source,
      (copy.width - width) / 2,
      (copy.height - height) / 2,
      width,
      height
    );
  } else {
    ctx.drawImage(source, 0, 0, copy.width, copy.height);
  }
  shaderStill.take(copy, frame.theme);
}
