<!--
  @component PageBrandPanel

  The "Brand & theme" page-mode panel (Codex-2pryk.3.3 · WP-5). Per-page overrides
  on top of the org brand (D6 — inherit by default, override per page): a primary
  colour override written to `PageBuilderState.brandOverrides` via the store. The
  route applies it to the canvas as a brand CSS custom property, so the preview
  re-tints live, and the published page emits the same input on its nested
  `[data-org-brand]` wrapper. Unset fields inherit the org brand.

  ── THE HERO SHADER SELECT WAS REMOVED, AND IT COULD NEVER HAVE WORKED ─────
  It wrote `--brand-shader-preset` into `tokenOverrides`. Nothing reads that key
  from a page: `ShaderHero` resolves its preset through `getShaderConfig()`, which
  reads `getComputedStyle(document.querySelector('.org-layout'))` — the ORG layout
  element, an ANCESTOR of both the builder canvas and the journey page's brand
  wrapper. CSS custom properties inherit DOWNWARD, so a value set on a descendant
  can never reach the element the shader reads. A repo-wide grep for the key found
  only this panel, the route's echo of it onto the canvas, and the brand editor's
  own ORG-level injection — nothing in the page-builder tree mentions "shader" at
  all. One of the seven options offered ('ember') was not even a member of
  `ShaderPresetId`, so it could not have resolved to a preset even from the org
  layer.

  So it was a control that changed a stored value and nothing else — the same
  class of defect as the decorative media text input this builder already removed
  once. A page-level hero shader is a real feature and may come back, but it needs
  the reading end built first: the token has to land where `getShaderConfig` looks.
  Until then the honest panel is the one that only offers what it can deliver.

  A page saved earlier may still carry the key in `tokenOverrides`. It is inert
  (nothing reads it) and now unauthorable, which is why removing it is safe — but
  it also means the stored key cannot be cleared from here.
-->
<script lang="ts">
  import * as m from '$paraglide/messages';
  import { pageBuilder } from '$lib/page-builder/page-builder-store.svelte';

  const overrides = $derived(pageBuilder.pending?.brandOverrides ?? {});
  const overridePrimary = $derived(!!overrides.primaryColor);

  /**
   * The primary colour this page is ALREADY showing, read from the same brand
   * input the override replaces.
   *
   * `--brand-color` is the raw org input `_org/[slug]/+layout.svelte` sets on
   * `.org-layout` from `branding_settings`, and `org-brand.css` derives ~50
   * semantic tokens from it; where an org sets none, `--color-primary-500`
   * resolves through that file's own `var(--brand-color, var(--color-primary-500))`
   * fallback to whatever the platform default currently is. Reading the live
   * cascade rather than naming a hex is the point: this panel used to seed
   * `#c24129` — the PLATFORM primary — so enabling "Override primary colour"
   * instantly repainted any org rust, a design decision nobody made, and one that
   * contradicted the comment claiming it seeded the org's own colour.
   *
   * Same source of truth as `getShaderConfig`'s read of `.org-layout`. Only a
   * 6-digit hex is usable: `<input type="color">` accepts nothing else, and
   * silently shows black for a value it cannot parse.
   */
  function effectiveOrgPrimary(): string | undefined {
    if (typeof document === 'undefined') return undefined;
    const el = document.querySelector('.org-layout') ?? document.documentElement;
    const style = getComputedStyle(el);
    for (const prop of ['--brand-color', '--color-primary-500']) {
      const raw = style.getPropertyValue(prop).trim();
      const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw)?.[1];
      if (!hex) continue;
      return hex.length === 3
        ? `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`.toLowerCase()
        : `#${hex.toLowerCase()}`;
    }
    return undefined;
  }

  function toggleOverride(): void {
    if (overridePrimary) {
      pageBuilder.updateBrandOverrides({ primaryColor: undefined });
      return;
    }
    // ON seeds the colour the page already renders with, so enabling the override
    // changes nothing on screen until the author picks. An override that repainted
    // the page the moment it was switched on is the defect this replaces.
    const seed = overrides.primaryColor ?? effectiveOrgPrimary();
    // No resolvable colour means no stylesheet is applied (SSR, a bare test DOM) —
    // an environment where nothing can be clicked anyway. Writing a constant here
    // is exactly what went wrong before, so write nothing.
    if (!seed) return;
    pageBuilder.updateBrandOverrides({ primaryColor: seed });
  }

  function setPrimary(color: string): void {
    pageBuilder.updateBrandOverrides({ primaryColor: color });
  }
</script>

<div class="panel">
  <header class="panel__head">
    <h2 class="panel__title">{m.studio_builder_brand_title()}</h2>
    <p class="panel__sub">{m.studio_builder_brand_sub()}</p>
  </header>

  <div class="row" class:row--on={overridePrimary}>
    <span class="row__copy">{m.studio_builder_brand_override_primary()}<small>{m.studio_builder_brand_only_this_page()}</small></span>
    <button
      type="button"
      class="row__sw"
      aria-pressed={overridePrimary}
      aria-label={m.studio_builder_brand_override_primary()}
      onclick={toggleOverride}
    ></button>
  </div>

  {#if overridePrimary}
    <label class="panel__field panel__field--inline">
      <span class="panel__label">{m.studio_builder_brand_primary_colour()}</span>
      <!-- No fallback value: this block renders only while `primaryColor` is set,
           because that is what `overridePrimary` reads. A `?? '#c24129'` here was
           unreachable, and it named the platform primary rather than the org's. -->
      <input
        type="color"
        class="panel__color"
        value={overrides.primaryColor}
        oninput={(e) => setPrimary(e.currentTarget.value)}
      />
    </label>
  {/if}

  <p class="panel__callout">
    {m.studio_builder_brand_callout()} <b>{m.studio_builder_brand_only_this_page()}</b>.
  </p>
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
  }

  .panel__head {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }

  .panel__title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .panel__sub {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .panel__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .panel__field--inline {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }

  .panel__label {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
  }

  .panel__color {
    width: var(--space-12);
    height: var(--space-8);
    padding: 0;
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-sm);
    background: none;
    cursor: pointer;
  }

  .panel__callout {
    margin: var(--space-1) 0 0;
    padding: var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-md);
    background-color: var(--color-surface-secondary);
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--color-text-muted);
  }

  .panel__callout b {
    color: var(--color-text-secondary);
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
  }

  .row--on {
    border-color: color-mix(in oklab, var(--color-interactive) 40%, var(--color-border));
  }

  .row__copy {
    flex: 1;
    display: flex;
    flex-direction: column;
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .row__copy small {
    color: var(--color-text-muted);
    font-size: var(--text-xs);
  }

  .row__sw {
    position: relative;
    flex: none;
    width: 34px;
    height: 20px;
    border: 0;
    border-radius: var(--radius-full);
    background-color: var(--color-surface-tertiary, var(--color-surface-secondary));
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .row__sw::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background-color: var(--color-text-muted);
    transition: transform var(--duration-fast) var(--ease-default);
  }

  .row--on .row__sw {
    background-color: color-mix(in oklab, var(--color-interactive) 55%, var(--color-surface-secondary));
  }

  .row--on .row__sw::after {
    transform: translateX(14px);
    background-color: var(--color-interactive);
  }

  .row__sw:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }
</style>
