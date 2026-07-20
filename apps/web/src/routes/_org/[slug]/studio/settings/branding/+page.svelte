<!--
  @component BrandingSettings (retired)

  This route moved to the unified /studio/brand workspace (Codex-cijzb).
  +page.ts issues a 301 redirect, so this component never renders in practice;
  it exists only as a no-JS / redirect-disabled fallback.
-->
<p class="branding-moved">
  Branding has moved. <a href="/studio/brand">Open the Brand workspace</a>.
</p>

<style>
  .branding-moved {
    padding: var(--space-6);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
</style>
