/**
 * Page-level facts a block may need but `BlockProps` does not carry: the
 * page's Style (a featured card's scheme depends on it), and whether the page
 * is still.
 *
 * Provided by `PageRenderer` as getters so a change re-renders the blocks
 * that read them. A block mounted on its own (a test) gets the default Style
 * and a live page rather than a missing context.
 */
import { getContext, setContext } from 'svelte';
import { DEFAULT_PAGE_STYLE, type PageStyleId } from './model/ids';

export interface KitPageContext {
  readonly style: PageStyleId;
  /**
   * Looked at rather than read: the canvas, and every still thumbnail (the
   * Layout picker, the Section gallery, the Style panel). Only then may a
   * block draw what stands in for missing media — a plate, a frame waiting
   * for a picture. The public page draws only what it has. The root's
   * `data-lp-still` is the same fact for CSS.
   */
  readonly still: boolean;
}

/**
 * The canvas's write-back, page-wide: which section, which props key, what
 * plain string. `PageRenderer` narrows it to one section's `BlockEdit`.
 */
export interface PageEdit {
  commit: (sectionId: string, key: string, value: string) => void;
}

const KEY = Symbol('lp-page');

export function setKitPage(context: KitPageContext): void {
  setContext(KEY, context);
}

export function getKitPage(): KitPageContext {
  return (
    getContext<KitPageContext | undefined>(KEY) ?? {
      style: DEFAULT_PAGE_STYLE,
      still: false,
    }
  );
}
