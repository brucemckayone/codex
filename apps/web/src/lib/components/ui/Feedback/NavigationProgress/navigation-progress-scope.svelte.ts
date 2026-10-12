/**
 * Which `NavigationProgress` instance draws the page-load bar (Codex-451j0).
 *
 * The bar paints `--color-interactive`, which `tokens/org-brand.css` remaps to
 * the org's brand colour — `--brand-color` in light, `--brand-color-dark` first
 * in dark — but only INSIDE `[data-org-brand]`. A custom property reaches an
 * element by inheritance alone, so the root layout's bar, mounted ABOVE
 * `.org-layout`, could never see the remap and drew the platform colour on
 * every org page.
 *
 * So a brand scope mounts a bar of its own inside itself (`placement="brand"`),
 * and the root layout's bar (`placement="root"`) stands down while one is
 * mounted. One bar per document either way: the root bar is the fallback for
 * every tree that has no brand scope, and for an org page whose layout failed
 * to load.
 *
 * Module state rather than context, because there is one bar per DOCUMENT, and
 * that is what a module is on the client. It is SSR-safe for the same reason
 * the claim is taken in `onMount`: `onMount` never runs on the server, so the
 * count is never written there and cannot leak from one request into another.
 */
let mountedBrandBars = $state(0);

export const brandBars = {
  /** True while a brand scope has a bar mounted, so the root bar stands down. */
  get mounted(): boolean {
    return mountedBrandBars > 0;
  },
  /** Record a mounted brand-scoped bar. Returns the release for its teardown. */
  register(): () => void {
    mountedBrandBars += 1;
    return () => {
      mountedBrandBars -= 1;
    };
  },
};
