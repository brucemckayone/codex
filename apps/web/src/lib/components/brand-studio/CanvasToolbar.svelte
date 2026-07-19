<!--
  @component CanvasToolbar

  The Brand Studio canvas toolbar (Codex-cijzb · WP-1.3): a route switcher
  (Landing / Grid / Detail / Player / Nav), a device switcher (Desktop / Tablet
  / Mobile) with the current width read-out, and a theme control (Light / Dark /
  Side by side).

  Pure + presentational — it holds no state; the parent owns the selected
  values and receives changes via callbacks. Content routes (Detail / Player)
  are disabled when the org has no published content to preview.
-->
<script lang="ts">
  import {
    PREVIEW_DEVICES,
    PREVIEW_ROUTES,
    type PreviewDeviceId,
    type PreviewRouteId,
    type PreviewThemeMode,
  } from './preview-canvas';

  interface Props {
    route: PreviewRouteId;
    device: PreviewDeviceId;
    themeMode: PreviewThemeMode;
    /** False when the org has no published content — disables Detail/Player. */
    contentAvailable: boolean;
    onroutechange: (id: PreviewRouteId) => void;
    ondevicechange: (id: PreviewDeviceId) => void;
    onthememodechange: (mode: PreviewThemeMode) => void;
  }

  const {
    route,
    device,
    themeMode,
    contentAvailable,
    onroutechange,
    ondevicechange,
    onthememodechange,
  }: Props = $props();

  const THEME_MODES: readonly { id: PreviewThemeMode; label: string }[] = [
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
    { id: 'split', label: 'Side by side' },
  ];

  const currentDevice = $derived(
    PREVIEW_DEVICES.find((d) => d.id === device) ?? PREVIEW_DEVICES[0]
  );
</script>

<div class="canvas-toolbar">
  <div class="canvas-toolbar__group" role="group" aria-label="Preview route">
    {#each PREVIEW_ROUTES as r (r.id)}
      {@const disabled = r.requiresContent && !contentAvailable}
      <button
        type="button"
        class="canvas-toolbar__pill"
        aria-pressed={route === r.id}
        {disabled}
        title={disabled
          ? 'Publish content to preview this page'
          : undefined}
        onclick={() => onroutechange(r.id)}
      >
        {r.label}
      </button>
    {/each}
  </div>

  <div class="canvas-toolbar__spacer"></div>

  <div class="canvas-toolbar__device">
    <div
      class="canvas-toolbar__group"
      role="group"
      aria-label="Preview device"
    >
      {#each PREVIEW_DEVICES as d (d.id)}
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

  /* Segmented pill group — mirrors the mockup's rounded route/theme segments. */
  .canvas-toolbar__group {
    display: flex;
    gap: var(--space-1);
    padding: var(--space-1);
    background-color: var(--color-surface-secondary);
    border-radius: var(--radius-full);
  }

  .canvas-toolbar__pill,
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

  .canvas-toolbar__pill:hover:not(:disabled),
  .canvas-toolbar__seg:hover:not(:disabled) {
    color: var(--color-text);
    background-color: color-mix(
      in oklch,
      var(--color-interactive) 12%,
      transparent
    );
  }

  .canvas-toolbar__pill[aria-pressed='true'],
  .canvas-toolbar__seg[aria-pressed='true'] {
    background-color: var(--color-text);
    color: var(--color-background);
  }

  .canvas-toolbar__pill:disabled {
    opacity: var(--opacity-40);
    cursor: not-allowed;
  }

  .canvas-toolbar__pill:focus-visible,
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

  @media (--below-md) {
    .canvas-toolbar__spacer {
      display: none;
    }
  }
</style>
