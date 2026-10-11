/**
 * The channel between the org's moving background and a page that reads what
 * it draws (landing-builder 03 X54). The fullpage ShaderHero (`tone`) samples
 * its frames into the grid only while something has asked (`demand`), and
 * tells each listener when the grid changes; a new shader, new colours or a
 * new size clear it, since what it held no longer lies under the same cells.
 */
import { accumulateTone, emptyToneGrid, type ToneGrid } from './tone-grid';

/**
 * Frames a moving shader is watched for before its grid is trusted: about
 * four seconds at two a second. One frame of 'flow' let a veil thin to 0.712
 * that the frames after it needed at 0.727. A still shader draws one frame,
 * so one is all of it.
 */
export const TONE_SETTLE_SAMPLES = 8;

class ShaderToneChannel {
  grid: ToneGrid = emptyToneGrid();
  /** The last frame folded in was a still one (reduced motion, `still`). */
  still = false;
  /** The CSS blur over the shader, in px: what reaches past a cell's edge. */
  blur = 0;
  #demand = 0;
  #wake: (() => void) | null = null;
  readonly #listeners = new Set<() => void>();

  get wanted(): boolean {
    return this.#demand > 0;
  }

  /** Enough of the shader has been seen to judge a veil by it. */
  get settled(): boolean {
    return this.grid.samples >= (this.still ? 1 : TONE_SETTLE_SAMPLES);
  }

  /** Asks for samples, and for a frame now; returns the release. */
  demand(): () => void {
    this.#demand++;
    this.#wake?.();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#demand--;
    };
  }

  /** Called with nothing each time the grid changes; returns the unsubscribe. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** ShaderHero: how to have a frame drawn (and so sampled) now. */
  onDemand(wake: (() => void) | null): void {
    this.#wake = wake;
  }

  /** ShaderHero: folds a sampled frame (RGBA, one pixel per cell) in. */
  record(
    rgba: ArrayLike<number>,
    frame: { still: boolean; blur: number } = { still: false, blur: 0 }
  ): void {
    accumulateTone(this.grid, rgba);
    this.still = frame.still;
    this.blur = frame.blur;
    this.#notify();
  }

  /** ShaderHero: the shader, its colours or its size changed. */
  clear(): void {
    if (this.grid.samples === 0) return;
    this.grid = emptyToneGrid();
    this.#notify();
  }

  #notify() {
    for (const listener of this.#listeners) listener();
  }
}

export const shaderTone = new ShaderToneChannel();

/** The window both sides map the grid onto: its size without scrollbars. */
export function toneViewport(): { width: number; height: number } {
  const root = document.documentElement;
  return { width: root.clientWidth, height: root.clientHeight };
}
