/**
 * Which `NavigationProgress` instance draws the page-load bar (Codex-451j0).
 *
 * The bar paints `--color-interactive`, which `tokens/org-brand.css` remaps to
 * the org's brand colour — `--brand-color` in light, `--brand-color-dark` first
 * in dark — but only INSIDE `[data-org-brand]`. A custom property reaches an
 * element by inheritance alone, so the root layout's bar, mounted ABOVE the
 * org's brand scope, could never see the remap and drew the platform colour on
 * every org page.
 *
 * So each brand scope mounts a bar of its own inside itself
 * (`placement="brand"`: `_org/[slug]/+layout.svelte`, and `(auth)/+layout.svelte`
 * on an org host), and the root layout's bar (`placement="root"`) stands down
 * while any is mounted. One bar per document either way:
 *   · no brand bar mounted → the root bar draws (platform pages, and an org
 *     page whose layout failed to load);
 *   · one or more mounted → only the NEWEST draws. Moving between the two org
 *     trees on one host swaps one layout for the other; if the outgoing one is
 *     ever still mounted when the incoming one mounts, the bars must not stack.
 *
 * Module state rather than context, because there is one bar per DOCUMENT, and
 * that is what a module is on the client. It is SSR-safe for the same reason
 * the claim is taken in `onMount`: `onMount` never runs on the server, so this
 * list is never written there and cannot leak from one request into another.
 *
 * `$state.raw` and reassignment, never `push`: a deep `$state` array would wrap
 * its entries, and `draws()` compares them by identity.
 */
let mountedBrandBars = $state.raw<readonly symbol[]>([]);

export const brandBars = {
  /** True while any brand scope has a bar mounted, so the root bar stands down. */
  get mounted(): boolean {
    return mountedBrandBars.length > 0;
  },
  /** Whether `bar` is the brand bar that draws: the most recently mounted. */
  draws(bar: symbol): boolean {
    return mountedBrandBars.at(-1) === bar;
  },
  /** Record a mounted brand bar. Returns the release for its teardown. */
  register(bar: symbol): () => void {
    mountedBrandBars = [...mountedBrandBars, bar];
    return () => {
      mountedBrandBars = mountedBrandBars.filter((b) => b !== bar);
    };
  },
};
