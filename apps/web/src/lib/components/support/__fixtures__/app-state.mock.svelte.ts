/**
 * Reactive test double for `$app/state` (Codex-2hxff.28): `page.url` and
 * `page.params` read `$state`, so a test can move the URL (the queue's
 * `?tab=`, the search's `?q=`) and watch the page follow, as it would after
 * a navigation. Not a `*.test.*` file, so never collected as a suite.
 */

const state = $state<{ url: URL; params: Record<string, string> }>({
  url: new URL('http://lvh.me:3000/admin/refunds'),
  params: {},
});

export const page = {
  get url() {
    return state.url;
  },
  get params() {
    return state.params;
  },
};

export function setPage(href: string, params: Record<string, string> = {}) {
  state.url = new URL(href, 'http://lvh.me:3000');
  state.params = params;
}
