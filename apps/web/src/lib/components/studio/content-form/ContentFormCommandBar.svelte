<!--
  @component ContentFormCommandBar

  Sticky top command bar for ContentForm. Anchors the form:
  breadcrumb + mode badge + status pill + readiness ratio +
  primary submit + publish/unpublish.

  Stays in view as the user scrolls through the form — removes
  the need to scroll to the bottom of a sidebar to save.

  @prop isEdit          Whether in edit mode (changes CTA labels + shows publish button)
  @prop contentStatus   Current draft|published|archived
  @prop formPending     True while submit is in flight
  @prop publishing      True while publish/unpublish is in flight
  @prop deleting        True while delete is in flight
  @prop readinessMet    Number of readiness checks satisfied
  @prop readinessTotal  Total number of readiness checks
  @prop onPublishToggle Publish/unpublish handler
-->
<script lang="ts">
  import { Button } from '$lib/components/ui';
  import * as m from '$paraglide/messages';

  interface Props {
    isEdit: boolean;
    contentStatus: string;
    formPending: boolean;
    publishing: boolean;
    deleting: boolean;
    readinessMet: number;
    readinessTotal: number;
    onPublishToggle: () => void;
  }

  const {
    isEdit,
    contentStatus,
    formPending,
    publishing,
    deleting,
    readinessMet,
    readinessTotal,
    onPublishToggle,
  }: Props = $props();

  const isReady = $derived(readinessMet === readinessTotal && readinessTotal > 0);
  const statusLabel = $derived(
    contentStatus === 'published'
      ? m.studio_content_status_published()
      : contentStatus === 'archived'
        ? m.studio_content_status_archived()
        : m.studio_content_status_draft()
  );
</script>

<div class="command-bar" role="toolbar" aria-label="Content actions">
  <div class="bar-identity">
    <a href="/studio/content" class="breadcrumb">
      <span class="breadcrumb-root">Content</span>
      <span class="breadcrumb-sep" aria-hidden="true">/</span>
      <span class="breadcrumb-leaf">
        {isEdit ? m.studio_content_form_edit_title() : m.studio_content_form_create_title()}
      </span>
    </a>
  </div>

  <div class="bar-meta">
    {#if isEdit}
      <span class="status-pill" data-status={contentStatus} aria-label="Status: {statusLabel}">
        <span class="status-dot" aria-hidden="true"></span>
        {statusLabel}
      </span>
    {/if}
    <span class="ready-chip" data-ready={isReady || undefined} aria-label="Readiness {readinessMet} of {readinessTotal}">
      <span class="ready-numerator">{readinessMet.toString().padStart(2, '0')}</span>
      <span class="ready-sep" aria-hidden="true">/</span>
      <span class="ready-denominator">{readinessTotal.toString().padStart(2, '0')}</span>
      <span class="ready-label">ready</span>
    </span>
  </div>

  <div class="bar-actions">
    {#if isEdit && contentStatus !== 'published'}
      <Button
        type="button"
        variant="secondary"
        disabled={publishing || deleting || formPending || !isReady}
        onclick={onPublishToggle}
        title={isReady ? '' : 'Complete all readiness checks before publishing'}
        loading={publishing}
      >
        {publishing ? m.studio_content_form_publishing() : m.studio_content_form_publish()}
      </Button>
    {:else if isEdit && contentStatus === 'published'}
      <Button
        type="button"
        variant="secondary"
        disabled={publishing || deleting || formPending}
        onclick={onPublishToggle}
        loading={publishing}
      >
        {publishing ? m.studio_content_form_unpublishing() : m.studio_content_form_unpublish()}
      </Button>
    {/if}

    <Button
      type="submit"
      variant="primary"
      disabled={formPending || deleting}
      loading={formPending}
    >
      {#if formPending}
        {m.studio_content_form_submitting()}
      {:else if isEdit}
        {m.studio_content_form_submit_update()}
      {:else}
        {m.studio_content_form_submit_create()}
      {/if}
    </Button>
  </div>
</div>

<style>
  .command-bar {
    position: sticky;
    top: 0;
    z-index: var(--z-sticky);
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-5);
    background-color: color-mix(in srgb, var(--color-surface) 88%, transparent);
    backdrop-filter: blur(var(--blur-2xl, 24px));
    -webkit-backdrop-filter: blur(var(--blur-2xl, 24px));
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    /* Sits above form body; edge glow reinforces sticky edge */
    box-shadow: 0 var(--space-1) var(--space-4)
      color-mix(in srgb, var(--color-text) 6%, transparent);
  }

  @media (--below-md) {
    .command-bar {
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas:
        'identity actions'
        'meta     meta';
      row-gap: var(--space-2);
      padding: var(--space-3);
    }
    .bar-identity { grid-area: identity; }
    .bar-meta     { grid-area: meta; justify-content: start; }
    .bar-actions  { grid-area: actions; }
  }

  /* ── Breadcrumb ──────────────────────────────────────────────── */
  /* Uses center alignment (not baseline) so the uppercase root — sitting
     between baseline and cap-height only — visually aligns with the mixed-
     case leaf's x-height and descenders. Both spans share --text-sm so
     case/weight carry the hierarchy without reintroducing the optical drift. */
  .breadcrumb {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    text-decoration: none;
    color: var(--color-text);
    font-family: var(--font-heading);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-tight);
    min-width: 0;
    transition: var(--transition-colors);
  }

  .breadcrumb:hover { color: var(--color-interactive); }

  .breadcrumb:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
    border-radius: var(--radius-sm);
  }

  .breadcrumb-root {
    font-weight: var(--font-normal);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
  }

  .breadcrumb-sep {
    color: var(--color-text-muted);
    font-weight: var(--font-normal);
    line-height: 1;
  }

  .breadcrumb-leaf {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  /* ── Meta (status pill + readiness chip) ─────────────────────── */
  .bar-meta {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
  }

  .status-pill {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    border-radius: var(--radius-full, 9999px);
    border: var(--border-width) var(--border-style) var(--color-border);
    background: var(--color-surface-secondary, var(--color-surface));
    color: var(--color-text-secondary);
  }

  .status-dot {
    width: var(--space-2);
    height: var(--space-2);
    border-radius: var(--radius-full, 9999px);
    background-color: currentColor;
  }

  .status-pill[data-status='published'] {
    color: var(--color-success-700);
    background: var(--color-success-50);
    border-color: color-mix(in srgb, var(--color-success-500) 30%, transparent);
  }
  .status-pill[data-status='draft'] {
    color: var(--color-warning-700);
    background: var(--color-warning-50);
    border-color: color-mix(in srgb, var(--color-warning-500) 30%, transparent);
  }
  .status-pill[data-status='archived'] {
    color: var(--color-text-secondary);
    background: var(--color-surface-secondary);
  }

  .ready-chip {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-3);
    font-family: var(--font-mono);
    font-feature-settings: 'tnum', 'zero';
    font-variant-numeric: tabular-nums slashed-zero;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-full, 9999px);
    background: var(--color-surface);
    transition: color var(--duration-normal) var(--ease-out),
                border-color var(--duration-normal) var(--ease-out);
  }

  .ready-chip[data-ready] {
    color: var(--color-interactive);
    border-color: color-mix(in srgb, var(--color-interactive) 40%, transparent);
    background: color-mix(in srgb, var(--color-interactive) 6%, var(--color-surface));
  }

  .ready-numerator { font-weight: var(--font-semibold); }
  .ready-denominator { opacity: var(--opacity-60, 0.6); }
  .ready-sep { opacity: var(--opacity-60, 0.6); }

  .ready-label {
    margin-left: var(--space-1);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
  }

  @media (--below-sm) {
    .ready-label { display: none; }
  }

  /* ── Actions ─────────────────────────────────────────────────── */
  .bar-actions {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    justify-content: flex-end;
  }
</style>
