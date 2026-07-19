<!--
  @component BrandStudioCanvas

  Placeholder live-preview canvas for the `/studio/brand` workspace. WP-1.1
  ships an empty, correctly-sized canvas region so the two-pane shell reads as
  intended; the real preview lands in later WPs.

  EXTENSION POINTS — do NOT build these here in WP-1.1:
    - WP-1.3: embed the org's real public routes in an <iframe> (same-origin,
              `frame-ancestors 'self'`), with a route switcher
              (Landing / Grid / Detail / Player / Nav), device + light/dark
              toggles, and optional side-by-side.
    - WP-1.4: a postMessage bridge that streams brand-editor `pending` state
              into the iframe for live, no-reload preview.

  Epic: Codex-cijzb · WP-1.1.
-->
<div class="brand-studio-canvas">
  <div class="brand-studio-canvas__placeholder">
    <p class="brand-studio-canvas__title">Live preview</p>
    <p class="brand-studio-canvas__hint">
      Your public pages render here so you can see brand changes as you make them.
    </p>
  </div>
</div>

<style>
  .brand-studio-canvas {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
    min-height: 0;
    padding: var(--space-8);
  }

  .brand-studio-canvas__placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    max-width: var(--container-sm);
    text-align: center;
  }

  .brand-studio-canvas__title {
    font-family: var(--font-heading);
    font-size: var(--text-base);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    margin: 0;
  }

  .brand-studio-canvas__hint {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    margin: 0;
  }
</style>
