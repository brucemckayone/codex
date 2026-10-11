/**
 * The channel between the org's moving background and a page that reads what
 * it draws (landing-builder 03 X54). The fullpage ShaderHero (`tone`) samples
 * its frames into the grid only while something has asked (`demand`), and
 * tells each listener when the grid changes; a new shader, new colours or a
 * new size clear it, since what it held no longer lies under the same cells.
 */
import { accumulateTone, emptyToneGrid, type ToneGrid } from './tone-grid';

class ShaderToneChannel {
  grid: ToneGrid = emptyToneGrid();
  #demand = 0;
  #wake: (() => void) | null = null;
  readonly #listeners = new Set<() => void>();

  get wanted(): boolean {
    return this.#demand > 0;
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
  record(rgba: ArrayLike<number>): void {
    accumulateTone(this.grid, rgba);
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
