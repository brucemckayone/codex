/**
 * An accordion's open panels — shared by the questions and the curriculum.
 *
 * Until the page's script has run (the server render, a visitor without JS)
 * every panel reads as OPEN: a closed panel that nothing can open is content
 * lost. `enhance()`, called from `onMount`, hands control to the buttons,
 * starting from `initial`. Both renders a test compares (public and canvas)
 * enhance the same way, so their markup stays identical.
 *
 * Panels open independently. Opening one never closes another, so an answer
 * being read never snaps shut and nothing jumps under the pointer; and the
 * no-JS state (all open) is simply a state of the same model.
 */
import { SvelteSet } from 'svelte/reactivity';

export class Disclosures {
  #open: SvelteSet<string>;
  #enhanced = $state(false);

  constructor(initial: Iterable<string> = []) {
    this.#open = new SvelteSet(initial);
  }

  enhance(): void {
    this.#enhanced = true;
  }

  isOpen(key: string): boolean {
    return !this.#enhanced || this.#open.has(key);
  }

  toggle(key: string): void {
    if (this.#open.has(key)) this.#open.delete(key);
    else this.#open.add(key);
  }

  /** Find-in-page matched text inside a closed panel: it stays open. */
  reveal(key: string): void {
    this.#open.add(key);
  }
}

const STEP_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End']);

/**
 * The accordion keys of the ARIA pattern: up and down step between the
 * headers, Home and End jump to the ends. Tab still moves through the page.
 * Bound on each toggle (a button), so the list itself stays non-interactive.
 */
export function stepFocus(event: KeyboardEvent): void {
  if (!STEP_KEYS.has(event.key)) return;
  const current = event.currentTarget as HTMLElement;
  const group = current.closest('[data-lp-disclosures]');
  if (!group) return;
  const toggles = [...group.querySelectorAll<HTMLElement>('[data-lp-toggle]')];
  const index = toggles.indexOf(current);
  if (index < 0) return;
  event.preventDefault();
  const last = toggles.length - 1;
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? last
        : event.key === 'ArrowDown'
          ? (index + 1) % toggles.length
          : (index - 1 + toggles.length) % toggles.length;
  toggles[next]?.focus();
}
