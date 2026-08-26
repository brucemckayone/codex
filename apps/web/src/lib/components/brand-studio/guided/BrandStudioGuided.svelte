<!--
  @component BrandStudioGuided

  The SHALLOW end of the `/studio/brand` difficulty dial (Codex-cijzb · WP-1.7).
  Three fast starts — all writing the SAME `brandEditor` store, so every choice
  live-previews through the WP-1.4 bridge and carries seamlessly into the full
  rail (WP-1.5) when the admin "opens the full editor":

    1. Presets   — the 12 built-in presets via the REUSED BrandEditorPresets
                   component (click → store.applyPreset, spread-merge preserved).
    2. Seed      — one colour → generateFullPalettes → clickable complete palettes.
    3. From logo — client-side canvas colour extraction from the uploaded logo →
                   a seed → the same palette generator. (The only new colour code.)

  This view occupies the rail region; the live-preview CANVAS is shared with
  Advanced mode and never unmounts, so the handoff is a pure content swap — no
  store state is transferred or lost. Target visual: docs/design/
  brand-editor-mockups.html, Concept D ("Guided").
-->
<script lang="ts">
  import { brandEditor, BRAND_DEFAULT_PRIMARY } from '$lib/brand-editor';
  import {
    generateFullPalettes,
    type FullPalette,
  } from '$lib/brand-editor/palette-generator';
  import { Button } from '$lib/components/ui';
  import { ChevronRightIcon } from '$lib/components/ui/Icon';
  import * as Tabs from '$lib/components/ui/Tabs';
  // Reused wholesale — the same preset gallery the retired overlay used. Safe
  // to static-import here: brand-studio is admin-only studio UI, outside the
  // public-route bundle the brand-editor boundary gate protects.
  import BrandEditorPresets from '$lib/components/brand-editor/levels/BrandEditorPresets.svelte';
  import { applyFullPalette } from './apply-palette';
  import {
    extractColorsFromLogo,
    type LogoExtraction,
  } from './logo-color-extraction';

  interface Props {
    /** True while a save is in flight — disables Save. */
    saving?: boolean;
    /** True when the store has unsaved edits — gates Save. */
    isDirty?: boolean;
    /** Persist the current brand payload. Owned by the route. */
    onsave: () => void;
    /** Progressive handoff — switch the workspace to Advanced (the full rail). */
    onopenfulleditor: () => void;
    /** Org name for the intro line. */
    orgName?: string;
  }

  const {
    saving = false,
    isDirty = false,
    onsave,
    onopenfulleditor,
    orgName = '',
  }: Props = $props();

  // Which quick-start is showing. Typed as string so it binds to Tabs' value.
  let activePath = $state<string>('presets');

  // The seed is the current primary until the admin picks one (via the colour
  // input or a logo swatch); `seedOverride` holds that explicit pick.
  let seedOverride = $state<string | null>(null);
  const seed = $derived(
    seedOverride ?? brandEditor.pending?.primaryColor ?? BRAND_DEFAULT_PRIMARY
  );
  const seedPalettes = $derived(generateFullPalettes(seed));

  const logoUrl = $derived(brandEditor.pending?.logoUrl ?? null);

  // ── Brand-from-logo extraction ────────────────────────────────────────────
  // Runs lazily when the From-logo tab is opened, once per logo URL. Every
  // failure mode is an explicit status so the UI explains itself.
  let logoResult = $state<LogoExtraction | null>(null);
  let logoBusy = $state(false);
  // Plain (non-reactive) guard so re-opening the tab doesn't re-extract.
  let lastExtractedUrl: string | null = null;

  $effect(() => {
    if (activePath !== 'logo') return;
    const url = logoUrl;
    if (url === lastExtractedUrl) return;
    lastExtractedUrl = url;

    if (!url) {
      logoResult = { status: 'no-logo' };
      logoBusy = false;
      return;
    }

    logoBusy = true;
    logoResult = null;
    let cancelled = false;

    extractColorsFromLogo(url)
      .then((result) => {
        if (cancelled) return;
        logoResult = result;
        // Seed the generator from the logo so palettes appear immediately.
        if (result.status === 'ok') seedOverride = result.colors.seed;
      })
      .catch(() => {
        if (!cancelled) logoResult = { status: 'load-error' };
      })
      .finally(() => {
        if (!cancelled) logoBusy = false;
      });

    return () => {
      cancelled = true;
    };
  });

  function selectSeed(hex: string): void {
    seedOverride = hex;
  }

  function onSeedInput(event: Event & { currentTarget: HTMLInputElement }): void {
    seedOverride = event.currentTarget.value;
  }

  /** True when `pending` already matches this palette (shows the applied state). */
  function isApplied(palette: FullPalette): boolean {
    const pending = brandEditor.pending;
    if (!pending) return false;
    return (
      pending.primaryColor === palette.primary &&
      pending.secondaryColor === palette.secondary &&
      pending.accentColor === palette.accent &&
      pending.backgroundColor === palette.background
    );
  }
</script>

{#snippet paletteOptions(palettes: FullPalette[])}
  {#if palettes.length > 0}
    <div class="guided__palettes">
      {#each palettes as palette (palette.name)}
        {@const applied = isApplied(palette)}
        <button
          type="button"
          class="guided__palette"
          class:is-applied={applied}
          aria-pressed={applied}
          title={palette.name}
          onclick={() => applyFullPalette(palette)}
        >
          <span
            class="guided__palette-bars"
            style:background={palette.background ?? 'var(--color-surface)'}
          >
            <span class="guided__palette-bar" style:background={palette.primary}></span>
            <span class="guided__palette-bar" style:background={palette.secondary}></span>
            <span class="guided__palette-bar" style:background={palette.accent}></span>
          </span>
          <span class="guided__palette-name">{palette.name}</span>
        </button>
      {/each}
    </div>
  {/if}
{/snippet}

<section class="guided">
  <header class="guided__intro">
    <h1 class="guided__title">
      {orgName ? `Let's brand ${orgName}.` : "Let's brand your space."}
    </h1>
    <p class="guided__subtitle">
      Start anywhere — pick a preset, drop in a colour, or pull colours from your
      logo. You can refine every detail later.
    </p>
  </header>

  <Tabs.Root bind:value={activePath} class="guided__tabs">
    <Tabs.List class="guided__tablist">
      <Tabs.Trigger value="presets">Presets</Tabs.Trigger>
      <Tabs.Trigger value="seed">Seed colour</Tabs.Trigger>
      <Tabs.Trigger value="logo">From logo</Tabs.Trigger>
    </Tabs.List>

    <div class="guided__scroll">
      <Tabs.Content value="presets" class="guided__panel">
        <BrandEditorPresets />
      </Tabs.Content>

      <Tabs.Content value="seed" class="guided__panel">
        <label class="guided__seed">
          <input
            type="color"
            class="guided__seed-input"
            value={seed}
            oninput={onSeedInput}
            aria-label="Seed colour"
          />
          <span class="guided__seed-meta">
            <span class="guided__seed-label">Seed colour</span>
            <span class="guided__seed-hex">{seed}</span>
          </span>
        </label>
        <p class="guided__hint">
          One colour generates complete palettes — primary, secondary, accent and
          background. Pick the one you like.
        </p>
        {@render paletteOptions(seedPalettes)}
      </Tabs.Content>

      <Tabs.Content value="logo" class="guided__panel">
        {#if logoBusy}
          <p class="guided__hint" aria-live="polite">Reading colours from your logo…</p>
        {:else if logoResult?.status === 'ok'}
          <div class="guided__found" role="group" aria-label="Colours from your logo">
            {#each logoResult.colors.dominant as hex (hex)}
              {@const selected = seed.toLowerCase() === hex.toLowerCase()}
              <button
                type="button"
                class="guided__found-swatch"
                class:is-selected={selected}
                aria-pressed={selected}
                style:background={hex}
                title={hex}
                aria-label={`Use ${hex} as the seed colour`}
                onclick={() => selectSeed(hex)}
              ></button>
            {/each}
          </div>
          <p class="guided__hint">
            Colours we found in your logo — pick a seed, then choose a palette.
          </p>
          {@render paletteOptions(seedPalettes)}
        {:else if logoResult?.status === 'no-logo'}
          <p class="guided__hint">
            No logo uploaded yet. Add one in the full editor, then come back to
            brand from it.
          </p>
        {:else if logoResult?.status === 'tainted'}
          <p class="guided__hint">
            Your logo is hosted somewhere that blocks colour extraction, so we
            can't read its colours here. Try the preset or seed-colour starts
            instead.
          </p>
        {:else if logoResult?.status === 'load-error'}
          <p class="guided__hint">
            We couldn't read colours from your logo. Try the preset or seed-colour
            starts instead.
          </p>
        {/if}
      </Tabs.Content>
    </div>
  </Tabs.Root>

  <footer class="guided__footer">
    <Button variant="ghost" size="sm" onclick={onopenfulleditor}>
      Open full editor
      <ChevronRightIcon size={16} />
    </Button>
    <Button variant="primary" onclick={onsave} loading={saving} disabled={!isDirty}>
      Save
    </Button>
  </footer>
</section>

<style>
  .guided {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  /* ── Intro ── */
  .guided__intro {
    padding: var(--space-5) var(--space-5) var(--space-3);
  }

  .guided__title {
    font-size: var(--text-xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    line-height: var(--leading-tight);
  }

  .guided__subtitle {
    margin-top: var(--space-1);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    line-height: var(--leading-snug);
  }

  /* ── Tabs ── */
  .guided :global(.guided__tabs) {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .guided :global(.guided__tablist) {
    display: flex;
    gap: var(--space-1);
    padding: 0 var(--space-5);
    border-bottom: var(--border-width) var(--border-style) var(--color-border-subtle);
  }

  .guided :global(.guided__tablist button) {
    appearance: none;
    background: none;
    border: none;
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text-muted);
    cursor: pointer;
    border-bottom: var(--border-width-thick) solid transparent;
    margin-bottom: calc(-1 * var(--border-width));
    transition: var(--transition-colors);
  }

  .guided :global(.guided__tablist button:hover) {
    color: var(--color-text);
  }

  .guided :global(.guided__tablist button[data-state='active']) {
    color: var(--color-interactive);
    border-bottom-color: var(--color-interactive);
  }

  .guided :global(.guided__tablist button:focus-visible) {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-xs);
  }

  .guided__scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-4) var(--space-5);
  }

  .guided :global(.guided__panel) {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .guided__hint {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    line-height: var(--leading-snug);
  }

  /* ── Seed field ── */
  .guided__seed {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-surface-secondary);
    cursor: pointer;
  }

  .guided__seed-input {
    width: var(--space-12);
    height: var(--space-12);
    padding: 0;
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: none;
    cursor: pointer;
    flex: none;
  }

  .guided__seed-meta {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }

  .guided__seed-label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .guided__seed-hex {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    text-transform: uppercase;
  }

  /* ── Found (logo) swatches ── */
  .guided__found {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .guided__found-swatch {
    width: var(--space-9);
    height: var(--space-9);
    border-radius: var(--radius-md);
    border: var(--border-width-thick) var(--border-style) var(--color-border);
    cursor: pointer;
    padding: 0;
    transition: var(--transition-transform);
  }

  .guided__found-swatch:hover {
    transform: scale(1.05);
  }

  .guided__found-swatch.is-selected {
    border-color: var(--color-interactive);
    box-shadow: 0 0 0 var(--border-width) var(--color-interactive);
  }

  .guided__found-swatch:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  /* ── Palette options ── */
  .guided__palettes {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
  }

  .guided__palette {
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
    padding: var(--space-2);
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-lg);
    background: var(--color-surface);
    cursor: pointer;
    transition: var(--transition-colors);
    text-align: left;
  }

  .guided__palette:hover {
    border-color: var(--color-border);
    background: var(--color-surface-secondary);
  }

  .guided__palette.is-applied {
    border-color: var(--color-interactive);
    box-shadow: 0 0 0 var(--border-width) var(--color-interactive);
  }

  .guided__palette:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .guided__palette-bars {
    display: flex;
    gap: var(--space-0-5);
    padding: var(--space-1-5);
    border-radius: var(--radius-md);
    height: var(--space-10);
  }

  .guided__palette-bar {
    flex: 1;
    border-radius: var(--radius-xs);
  }

  .guided__palette-name {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  /* ── Footer ── */
  .guided__footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-5);
    border-top: var(--border-width) var(--border-style) var(--color-border);
  }
</style>
