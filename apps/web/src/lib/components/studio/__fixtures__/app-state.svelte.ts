/**
 * A reactive `$app/state` for mounting a studio list (Codex-a6ofh.3.1).
 * `nav.url` is `$state`, so a test can move the URL under a mounted page as
 * a navigation does, and `nav.to` stands in for a navigation in flight.
 *
 *   vi.mock('$app/state', () => import('…/__fixtures__/app-state.svelte'));
 */
export const nav = $state<{ url: URL; to: { url: URL } | null }>({
  url: new URL('https://studio.test/studio'),
  to: null,
});

export const page = {
  get url() {
    return nav.url;
  },
};

export const navigating = {
  get to() {
    return nav.to;
  },
};
