/**
 * Page-level facts a block may need but `BlockProps` does not carry — today,
 * only the page's Style (a featured card's scheme depends on it).
 *
 * Provided by `PageRenderer` as a getter so a Style change re-renders the
 * blocks that read it. A block mounted on its own (a test, a thumbnail) gets
 * the default Style rather than a missing context.
 */
import { getContext, setContext } from 'svelte';
import { DEFAULT_PAGE_STYLE, type PageStyleId } from './model/ids';

export interface KitPageContext {
  readonly style: PageStyleId;
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
    getContext<KitPageContext | undefined>(KEY) ?? { style: DEFAULT_PAGE_STYLE }
  );
}
