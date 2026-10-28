/**
 * One film at a time, page-wide (owner P3): starting any `PreviewPlayerCore`
 * pauses the one that played before it. A tiny registry, touched only from a
 * core's own `play` event and teardown, so nothing polls. The hero's ambient
 * loop (`HeroLoopVideo`) is decoration, muted and hidden from assistive tech,
 * and never joins.
 *
 * It also keeps the cores that are on screen (each core's own
 * IntersectionObserver reports in), so the sales page's floating bar
 * (`page-builder/kit/StickyCta.svelte`) can step aside while a film's
 * controls are in view: on a phone it sits right over them. Only ever written
 * in the browser; on the server the set stays empty.
 */
import { SvelteSet } from 'svelte/reactivity';

let current: HTMLMediaElement | null = null;
const inView = new SvelteSet<Element>();

/** `media` has started: the film playing before it stops. */
export function claim(media: HTMLMediaElement): void {
  if (current && current !== media) current.pause();
  current = media;
}

/**
 * `media` holds the page's one film: no other has started since it did. A
 * film waiting on a renewal (`PreviewPlayerCore`) plays on only if so.
 */
export function holds(media: HTMLMediaElement): boolean {
  return current === media;
}

/** `media` is going away: it no longer holds the page's one film. */
export function release(media: HTMLMediaElement): void {
  if (current === media) current = null;
}

/** Whether a core's box is on screen. */
export function showing(player: Element, onScreen: boolean): void {
  if (onScreen) inView.add(player);
  else inView.delete(player);
}

/** A film's player is on screen (read reactively). */
export function filmInView(): boolean {
  return inView.size > 0;
}
