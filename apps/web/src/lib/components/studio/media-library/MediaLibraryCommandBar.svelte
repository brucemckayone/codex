<!--
  @component MediaLibraryCommandBar

  Sticky command bar for the Studio media library: the breadcrumb (Studio /
  Media), the live status chip, and the Upload action that triggers the
  parent's hidden file input. Search, filters, sort and view live in
  MediaLibraryToolbar below the page header (Codex-a6ofh.1.6).
-->
<script lang="ts">
  import { tick } from 'svelte';
  import * as m from '$paraglide/messages';
  import { UploadIcon } from '$lib/components/ui/Icon';
  import Badge from '$lib/components/ui/Badge/Badge.svelte';
  import type { MediaStatusConnection } from '$lib/client/media-status.svelte';

  interface Props {
    /**
     * The live status socket (Codex-l2c48.7). Shown while it is live, or
     * while the tiles may lag (reconnecting, polling, paused); hidden otherwise.
     */
    live?: MediaStatusConnection;
    /** Refresh, offered once the fallback has paused (Codex-a6ofh.1.3). */
    onLiveResume?: () => void;
    /** Upload button click — parent should trigger hidden file input */
    onUploadClick: () => void;
  }

  const { live = 'idle', onUploadClick, onLiveResume }: Props = $props();

  const LIVE_LABELS: Partial<Record<MediaStatusConnection, () => string>> = {
    live: () => m.media_live_live(),
    reconnecting: () => m.media_live_reconnecting(),
    polling: () => m.media_live_polling(),
    // The fallback spent its few refetches: nothing runs until Refresh.
    paused: () => m.media_live_paused(),
    // The session ended, or the ticket was refused twice in a row: nothing
    // reconnects until the page loads again.
    stopped: () => m.media_live_stopped(),
  };
  const liveLabel = $derived(LIVE_LABELS[live]);

  let liveStatus = $state<HTMLElement | null>(null);

  async function resumeLive() {
    onLiveResume?.();
    // Refresh goes once the store leaves 'paused': keep focus on the status
    // it changed, never <body> (WCAG 2.4.3).
    await tick();
    liveStatus?.focus();
  }
</script>

<div class="command-bar" role="toolbar" aria-label={m.media_command_bar_label()}>
  <div class="bar-identity">
    <a href="/studio" class="breadcrumb">
      <span class="breadcrumb-root">{m.media_breadcrumb_root()}</span>
      <span class="breadcrumb-sep" aria-hidden="true">/</span>
      <span class="breadcrumb-leaf">{m.media_title()}</span>
    </a>
    {#if liveLabel}
      <!-- A status region: a screen reader hears it pause, reconnect, recover. -->
      <div class="live-status" role="status" tabindex="-1" bind:this={liveStatus}>
        <Badge class="live-chip" variant={live === 'live' ? 'success' : 'warning'} data-state={live}>
          {liveLabel()}
        </Badge>
      </div>
      {#if live === 'paused' && onLiveResume}
        <button type="button" class="live-resume" onclick={resumeLive}>
          {m.media_live_resume()}
        </button>
      {/if}
    {/if}
  </div>

  <div class="bar-actions">
    <button type="button" class="upload-btn" onclick={onUploadClick}>
      <UploadIcon size={16} />
      <span class="upload-btn-label">{m.media_upload_title()}</span>
    </button>
  </div>
</div>

<style>
  .command-bar {
    position: sticky;
    top: 0;
    z-index: var(--z-sticky);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-5);
    background-color: color-mix(in srgb, var(--color-surface) 88%, transparent);
    backdrop-filter: blur(var(--blur-2xl, 24px));
    -webkit-backdrop-filter: blur(var(--blur-2xl, 24px));
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    box-shadow: 0 var(--space-1) var(--space-4)
      color-mix(in srgb, var(--color-text) 6%, transparent);
  }

  @media (--below-lg) {
    .command-bar {
      padding: var(--space-3) var(--space-4);
    }
  }

  /* ── Identity (breadcrumb + live status) ──────────────────────── */
  /* Wraps rather than overflows: at 390px a longer live chip ("Updates every
     minute", "Reload for live updates") squeezed the breadcrumb to 0 and ran
     under the upload button. Lines break on natural widths, so the chip
     drops to its own line and nothing shrinks. */
  .bar-identity {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    min-width: 0;
  }

  .breadcrumb {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-2);
    text-decoration: none;
    color: var(--color-text);
    font-family: var(--font-heading);
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-tight);
    min-width: 0;
    transition: var(--transition-colors);
  }

  .breadcrumb:hover { color: var(--color-link); }

  .breadcrumb:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-sm);
  }

  .breadcrumb-root {
    font-weight: var(--font-normal);
    color: var(--color-text-muted);
    font-size: var(--text-sm);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
  }

  .breadcrumb-sep {
    color: var(--color-text-muted);
    font-weight: var(--font-normal);
  }

  .breadcrumb-leaf {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  /* The live chip is a Badge (its colours); this adds the dot and the blink. */
  .bar-identity :global(.live-chip)::before {
    content: '';
    width: var(--space-1-5);
    height: var(--space-1-5);
    margin-right: var(--space-1-5);
    border-radius: var(--radius-full);
    background: currentColor;
  }

  @media (prefers-reduced-motion: no-preference) {
    .bar-identity :global(.live-chip[data-state='reconnecting'])::before {
      animation: live-chip-blink 1s steps(2) infinite;
    }
  }

  @keyframes live-chip-blink {
    50% { opacity: 0.2; }
  }

  .live-status {
    display: inline-flex;
    border-radius: var(--radius-sm);
  }

  .live-status:focus {
    outline: none;
  }

  .live-status:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .live-resume {
    appearance: none;
    border: 0;
    background: transparent;
    padding: var(--space-0-5) var(--space-1);
    font: inherit;
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-link);
    text-decoration: underline;
    text-underline-offset: var(--space-0-5);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .live-resume:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  /* ── Actions ────────────────────────────────────────────── */
  .bar-actions {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    justify-content: flex-end;
  }

  .upload-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    height: var(--space-10);
    padding: 0 var(--space-4);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-on-interactive);
    background-color: var(--color-interactive);
    border: none;
    border-radius: var(--radius-full, 9999px);
    cursor: pointer;
    white-space: nowrap;
    transition:
      background-color var(--duration-fast) var(--ease-out),
      transform var(--duration-fast) var(--ease-out);
  }

  .upload-btn:hover {
    background-color: var(--color-interactive-hover);
    color: var(--color-on-interactive-hover);
  }

  .upload-btn:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  @media (prefers-reduced-motion: no-preference) {
    .upload-btn:hover { transform: translateY(calc(-1 * var(--border-width))); }
  }

  @media (--below-sm) {
    .upload-btn-label { display: none; }
    .upload-btn { padding: 0 var(--space-3); }
  }
</style>
