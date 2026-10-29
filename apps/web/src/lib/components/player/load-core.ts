/**
 * `PreviewPlayerCore`, loaded on demand (owner P9). A sales page carries
 * four films at most and most visitors play none, so the player is its own
 * chunk, fetched as a visitor shows intent — a pointer or focus on a play
 * button, or the button first nearing the screen (`preloadPlayer`) — and
 * never with the page. One-shot: a static path, imported once, and no
 * server call.
 *
 * A press needs the core NOW: its `play()` must run in the press's own tick
 * to keep the sound (`start.ts`), so a caller mounts `loadedPlayerCore()`
 * when it is there and waits on `loadPlayerCore()` only when it is not (the
 * film may then start muted). The core imports no checkout remote and no
 * `$app/state`, which is what lets it cross a dynamic import at all
 * (`ContentDetailView.svelte` on why a `*.remote.ts` cannot).
 */
import type { Attachment } from 'svelte/attachments';

export type PlayerCore = typeof import('./PreviewPlayerCore.svelte').default;

let pending: Promise<PlayerCore> | null = null;
let loaded: PlayerCore | null = null;

export function loadPlayerCore(): Promise<PlayerCore> {
  pending ??= import('./PreviewPlayerCore.svelte').then(
    (module) => {
      loaded = module.default;
      return loaded;
    },
    (error: unknown) => {
      // A failed chunk (a deploy, a dropped connection) may be asked for again.
      pending = null;
      throw error;
    }
  );
  return pending;
}

/** The core, if it has loaded: what a press mounts in its own tick. */
export function loadedPlayerCore(): PlayerCore | null {
  return loaded;
}

/**
 * Load the core before the press: the first time a pointer enters `node`,
 * focus reaches it, or it comes within a screen's quarter of the viewport.
 * Then every trigger is dropped. A failure here is quiet: the press asks
 * again, and says so if it fails too.
 */
export const preloadPlayer: Attachment<HTMLElement> = (node) => {
  const triggers = ['pointerenter', 'focusin'] as const;
  let observer: IntersectionObserver | null = null;

  function stop() {
    for (const type of triggers) node.removeEventListener(type, warm);
    observer?.disconnect();
    observer = null;
  }

  function warm() {
    stop();
    loadPlayerCore().catch(() => {});
  }

  for (const type of triggers) node.addEventListener(type, warm);
  if (typeof IntersectionObserver !== 'undefined') {
    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) warm();
      },
      { rootMargin: '25% 0px' }
    );
    observer.observe(node);
  }
  return stop;
};
