/**
 * Scroll-Reset Decision — used by the root layout's `afterNavigate` handler
 * to decide whether to scroll to the top on a navigation.
 *
 * Rules (in order):
 *   - **popstate** (browser back/forward) → never reset. Let the browser's
 *     native scroll restoration place the user back at their saved offset.
 *   - **anchor/hash navigation** (`/page#section`) → never reset. The
 *     browser's default anchor scroll wins.
 *   - **same-pathname navigation** (query-param or shallow state changes,
 *     e.g. filter/sort toggles) → never reset. Preserve where the user is.
 *   - Otherwise (genuine new-page navigation) → reset to top.
 *
 * Extracted as a pure function so the rules are unit-testable without a
 * router, DOM, or requestAnimationFrame.
 */

export type NavigationType =
  | 'enter'
  | 'form'
  | 'leave'
  | 'link'
  | 'goto'
  | 'popstate';

export interface ScrollResetInput {
  type: NavigationType | undefined;
  fromPathname: string | null | undefined;
  toPathname: string | null | undefined;
  toHash: string | null | undefined;
}

export function shouldScrollToTopOnNav(input: ScrollResetInput): boolean {
  if (input.type === 'popstate') return false;
  if (input.toHash) return false;
  if (
    input.fromPathname != null &&
    input.toPathname != null &&
    input.fromPathname === input.toPathname
  ) {
    return false;
  }
  return true;
}
