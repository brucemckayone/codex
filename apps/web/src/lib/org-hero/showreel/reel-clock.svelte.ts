/**
 * The Showreel's clock: which piece plays, and when the reel moves on. Time
 * comes in from outside (`tick(ms)`), so the rules are under test with no
 * frames and no timers.
 *
 * - A piece plays for `PIECE_MS` (the mock's seven seconds), then the next;
 *   after the last, the first again.
 * - Pause (WCAG 2.2.2) stops it until the visitor plays it again.
 * - A hold stops it while any reason lasts: the pointer over the words, the
 *   index or the strip; focus inside the reel; a phone's press and hold
 *   (which, as the owner chose, pauses the footage and the shader too); the
 *   film playing; the hero off screen. A mouse resting on the film or the
 *   shader is no hold.
 * - A clock that does not move (the static path) never moves on by itself,
 *   but the visitor's own index, strip or tap still changes piece.
 * - One clock lasts the visit. The page hands the reel over anew whenever
 *   its data refreshes, so the clock follows what the reel HOLDS
 *   (`follow(keys)`), never its identity: the pause and the holds are the
 *   visitor's and stay, and so does the piece on show while it is in the reel.
 */
import { SvelteSet } from 'svelte/reactivity';
import type { ReelEntry } from '../reel';

/** How long a piece plays before the reel moves on. */
export const PIECE_MS = 7000;

/** Why the reel waits: the pointer over its words, index or strip; focus
 *  inside; a phone's press; the film playing; the hero off screen; the
 *  opening holding the words back, so the first piece's turn starts when
 *  its words come in. */
export type HoldReason =
  | 'pointer'
  | 'focus'
  | 'press'
  | 'film'
  | 'away'
  | 'opening';

/** What an entry is to the clock: the piece itself, never its place or its look. */
export function reelKey(entry: ReelEntry): string {
  if (entry.type === 'piece') return `piece:${entry.piece.href}`;
  return `film:${entry.film.previewUrl ?? entry.film.posterUrl ?? ''}`;
}

/**
 * Every entry's key, each one unique, so the stage can key its elements by
 * entry and the clock can follow each one. Each piece's first entry keeps the
 * piece's own key; a repeat (two pieces with one href) takes the first count
 * no other entry's key is. An href can itself end in `#2`, so a count is
 * checked against every key, never assumed free.
 */
export function reelKeys(reel: readonly ReelEntry[]): string[] {
  const bases = reel.map(reelKey);
  const used = new Set<string>();
  const firsts = bases.map((base) => {
    if (used.has(base)) return null;
    used.add(base);
    return base;
  });
  return firsts.map((first, i) => {
    if (first !== null) return first;
    let n = 2;
    while (used.has(`${bases[i]}#${n}`)) n++;
    const counted = `${bases[i]}#${n}`;
    used.add(counted);
    return counted;
  });
}

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((key, i) => key === b[i]);

export class ReelClock {
  /** The playing piece. */
  index = $state(0);
  /** The visitor paused it (the pause button). */
  paused = $state(false);
  /** Whether it moves on by itself: false on the static path. */
  moves = $state(true);
  /** Each start of a piece, so its bar can begin again from 0 under a hold. */
  starts = $state(0);
  /** How far into the piece, 0-1 (the index's bar, the phone's segment). */
  progress = 0;

  #count: number;
  #keys: readonly string[] | null = null;
  readonly #holds = new SvelteSet<HoldReason>();
  #elapsed = 0;

  constructor(count: number, moves: boolean) {
    this.#count = Math.max(1, count);
    this.moves = moves;
  }

  get count(): number {
    return this.#count;
  }

  /** Held by any reason. */
  get held(): boolean {
    return this.#holds.size > 0;
  }

  /** Held by this reason. */
  holding(reason: HoldReason): boolean {
    return this.#holds.has(reason);
  }

  /** Whether time runs: it moves, and nothing stops it. */
  get running(): boolean {
    return this.moves && !this.paused && !this.held;
  }

  /**
   * The reel as it is now, one key per entry (`reelKey`). The same entries
   * handed over anew change nothing. Changed entries keep the piece on show
   * playing, where it is now, when it is still in the reel; otherwise the
   * piece now in its place starts.
   */
  follow(keys: readonly string[]): void {
    const was = this.#keys;
    this.#keys = keys;
    this.#count = Math.max(1, keys.length);
    if (!was || same(was, keys)) return;
    const at = keys.indexOf(was[this.index] ?? '');
    if (at >= 0) this.index = at;
    else this.go(Math.min(this.index, this.#count - 1));
  }

  /** Time passed. True when the reel moved on to the next piece. */
  tick(ms: number): boolean {
    if (!this.running || ms <= 0) return false;
    this.#elapsed += ms;
    if (this.#elapsed >= PIECE_MS) {
      this.go(this.index + 1);
      return true;
    }
    this.progress = this.#elapsed / PIECE_MS;
    return false;
  }

  /** Play piece `i` (wrapping), from its start. */
  go(i: number): void {
    this.index = ((i % this.#count) + this.#count) % this.#count;
    this.#elapsed = 0;
    this.progress = 0;
    this.starts += 1;
  }

  next(): void {
    this.go(this.index + 1);
  }

  back(): void {
    this.go(this.index - 1);
  }

  togglePause(): void {
    this.paused = !this.paused;
  }

  hold(reason: HoldReason, on: boolean): void {
    if (on) this.#holds.add(reason);
    else this.#holds.delete(reason);
  }
}
