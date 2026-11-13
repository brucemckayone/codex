/**
 * The content list's selection (Codex-a6ofh.3.5, data-design §4.2): the ids
 * of rows on the page, at most CONTENT_BULK_MAX (owner D-b3, one request per
 * action). At the cap the other boxes wait. The list makes a new one when
 * its view changes, and keeps only the rows still shown after a re-read.
 */
import { CONTENT_BULK_MAX } from '@codex/constants';

export class ContentSelection {
  readonly max: number;
  #ids = $state<readonly string[]>([]);

  constructor(max: number = CONTENT_BULK_MAX) {
    this.max = max;
  }

  get ids(): readonly string[] {
    return this.#ids;
  }

  get size(): number {
    return this.#ids.length;
  }

  get full(): boolean {
    return this.#ids.length >= this.max;
  }

  has(id: string): boolean {
    return this.#ids.includes(id);
  }

  /** On or off; a new one only while there is room. */
  toggle(id: string): void {
    if (this.has(id)) this.#ids = this.#ids.filter((held) => held !== id);
    else if (!this.full) this.#ids = [...this.#ids, id];
  }

  /** The header's box: every row given, as far as the cap allows, or none of them. */
  setPage(ids: readonly string[], on: boolean): void {
    if (!on) {
      const off = new Set(ids);
      this.#ids = this.#ids.filter((held) => !off.has(held));
      return;
    }
    const next = [...this.#ids];
    for (const id of ids) {
      if (next.length >= this.max) break;
      if (!next.includes(id)) next.push(id);
    }
    this.#ids = next;
  }

  /** Only these, of what is held: after an action, the pieces it left. */
  keepOnly(ids: Iterable<string>): void {
    const keep = new Set(ids);
    const next = this.#ids.filter((held) => keep.has(held));
    // Unchanged, the same array: what reads the selection is not woken.
    if (next.length !== this.#ids.length) this.#ids = next;
  }

  /** One off, if held: a piece deleted from its row's menu. */
  drop(id: string): void {
    if (this.has(id)) this.#ids = this.#ids.filter((held) => held !== id);
  }

  clear(): void {
    if (this.#ids.length > 0) this.#ids = [];
  }
}
