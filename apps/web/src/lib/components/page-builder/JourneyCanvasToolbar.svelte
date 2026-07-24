<!--
  @component JourneyCanvasToolbar

  The journey builder canvas toolbar (Codex-2pryk.3.3 · WP-5): a device switcher
  (Desktop / Tablet / Mobile) with the current width read-out, a theme control
  (Light / Dark / Side by side), and a full-screen toggle. Cloned + trimmed from
  `brand-studio/CanvasToolbar.svelte` — the journey builder previews a single
  surface (the sales page), so the brand toolbar's route switcher is dropped.

  Pure + presentational — it holds no state; the parent owns the selected values
  and receives changes via callbacks.
-->
<script lang="ts">
  import { MaximizeIcon, XIcon } from '$lib/components/ui/Icon';
  import {
    JOURNEY_PREVIEW_DEVICES,
    type JourneyPreviewDeviceId,
    type JourneyPreviewThemeMode,
  } from './journey-preview-canvas';

  interface Props {
    device: JourneyPreviewDeviceId;
    themeMode: JourneyPreviewThemeMode;
    /** Whether the workspace is full-screen (drives the toggle glyph). */
    fullscreen?: boolean;
    ondevicechange: (id: JourneyPreviewDeviceId) => void;
    onthememodechange: (mode: JourneyPreviewThemeMode) => void;
    /** Toggle full-screen preview. Absent → the button hides. */
    ontogglefullscreen?: () => void;
  }

  const {
    device,
    themeMode,
    fullscreen = false,
    ondevicechange,
    onthememodechange,
    ontogglefullscreen,
  }: Props = $props();

  const THEME_MODES: readonly { id: JourneyPreviewThemeMode; label: string }[] = [
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
    { id: 'split', label: 'Side by side' },
  ];

  const currentDevice = $derived(
    JOURNEY_PREVIEW_DEVICES.find((d) => d.id === device) ?? JOURNEY_PREVIEW_DEVICES[0]
  );
</script>

<div class="canvas-toolbar">
  <div class="canvas-toolbar__device">
    <div class="canvas-toolbar__group" role="group" aria-label="Preview device">
      {#each JOURNEY_PREVIEW_DEVICES as d (d.id)}
        <button
          type="button"
          class="canvas-toolbar__seg"
          aria-pressed={device === d.id}
          onclick={() => ondevicechange(d.id)}
        >
          {d.label}
        </button>
      {/each}
    </div>
    <span class="canvas-toolbar__width" aria-live="polite">
      {currentDevice.widthLabel}
    </span>
  </div>

  <div class="canvas-toolbar__spacer"></div>

  <div class="canvas-toolbar__group" role="group" aria-label="Preview theme">
    {#each THEME_MODES as t (t.id)}
      <button
        type="button"
        class="canvas-toolbar__seg"
        aria-pressed={themeMode === t.id}
        onclick={() => onthememodechange(t.id)}
      >
        {t.label}
      </button>
    {/each}
  </div>

  {#if ontogglefullscreen}
    <div class="canvas-toolbar__actions" role="group" aria-label="Preview size">
      <button
        type="button"
        class="canvas-toolbar__icon"
        aria-pressed={fullscreen}
        aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
        title={fullscreen ? 'Exit full screen' : 'Full screen'}
        onclick={ontogglefullscreen}
      >
        {#if fullscreen}
          <XIcon size={16} />
        {:else}
          <MaximizeIcon size={16} />
        {/if}
      </button>
    </div>
  {/if}
</div>

<style>
  .canvas-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
  }

  .canvas-toolbar__spacer {
    flex: 1 1 var(--space-4);
  }

  .canvas-toolbar__device {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  /* Segmented pill group — mirrors the brand-studio toolbar's rounded segments. */
  .canvas-toolbar__group {
    display: flex;
    gap: var(--space-1);
    padding: var(--space-1);
    background-color: var(--color-surface-secondary);
    border-radius: var(--radius-full);
  }

  .canvas-toolbar__seg {
    padding: var(--space-1) var(--space-3);
    border: 0;
    border-radius: var(--radius-full);
    background: none;
    color: var(--color-text-secondary);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    white-space: nowrap;
    cursor: pointer;
    transition:
      background-color var(--duration-fast) var(--ease-default),
      color var(--duration-fast) var(--ease-default);
  }

  .canvas-toolbar__seg:hover {
    color: var(--color-text);
    background-color: color-mix(in oklch, var(--color-interactive) 12%, transparent);
  }

  .canvas-toolbar__seg[aria-pressed='true'] {
    background-color: var(--color-text);
    color: var(--color-background);
  }

  .canvas-toolbar__seg:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }

  .canvas-toolbar__width {
    min-width: var(--space-12);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    color: var(--color-text-muted);
  }

  .canvas-toolbar__actions {
    display: flex;
    gap: var(--space-1);
  }

  .canvas-toolbar__icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-7);
    height: var(--space-7);
    padding: 0;
    border: 0;
    border-radius: var(--radius-full);
    background-color: var(--color-surface-secondary);
    color: var(--color-text-secondary);
    cursor: pointer;
    transition:
      background-color var(--duration-fast) var(--ease-default),
      color var(--duration-fast) var(--ease-default);
  }

  .canvas-toolbar__icon:hover {
    color: var(--color-text);
    background-color: color-mix(in oklch, var(--color-interactive) 12%, transparent);
  }

  .canvas-toolbar__icon[aria-pressed='true'] {
    background-color: var(--color-text);
    color: var(--color-background);
  }

  .canvas-toolbar__icon:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }

  @media (--below-md) {
    .canvas-toolbar__spacer {
      display: none;
    }
  }
</style>
