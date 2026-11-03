<!--
  @component PriceChangeNote

  How a saved price change is going (Codex-2hxff.85 M3, .86; batch C1 Part B
  page 4): on its tier row in Monetisation › Subscriptions, and under the
  plan's prices in the Offer panel. The words are `priceChangeNotes()`'s.

  The same shape and tokens as PlanGuidanceNote, which sits in the same slot,
  plus the progress bar, the counts and a quiet line. Held people are a count
  only, never names (M3).

  The cost rule: the counts change only on the hourly run, so the note never
  re-reads by itself. Check again and Try again are one read per press, and a
  press while one is out does nothing.

  @prop {PriceNoteView} [view] - The note. Leave out with `failed`.
  @prop {boolean} [failed] - The read failed (P10): the line and Try again.
  @prop {boolean} [busy] - A read is out.
  @prop {string} [name] - The tier, for the buttons' names on a page of rows.
-->
<script lang="ts">
  import {
    AlertTriangleIcon,
    ClockIcon,
    MailIcon,
    PauseIcon,
  } from '$lib/components/ui/Icon';
  import * as m from '$paraglide/messages';
  import type { PriceNoteView } from './price-note-view';

  interface Props {
    view?: PriceNoteView;
    failed?: boolean;
    busy?: boolean;
    name?: string;
    onCheckAgain?: () => void;
    onDismiss?: () => void;
    onTryAgain?: () => void;
    'data-testid'?: string;
  }

  const {
    view,
    failed = false,
    busy = false,
    name,
    onCheckAgain,
    onDismiss,
    onTryAgain,
    'data-testid': testId = 'price-change-note',
  }: Props = $props();

  // P10: the read was refused or timed out. Never "done", never no note.
  const shown = $derived(
    failed
      ? {
          icon: 'alert' as const,
          tone: 'warning' as const,
          lead: null,
          text: m.price_note_load_failed(),
          bar: null,
          counts: [],
          meta: null,
        }
      : view
  );
  const Icon = $derived(
    shown?.icon === 'clock'
      ? ClockIcon
      : shown?.icon === 'pause'
        ? PauseIcon
        : shown?.icon === 'alert'
          ? AlertTriangleIcon
          : MailIcon
  );

  function press(handler: (() => void) | undefined) {
    if (busy) return;
    handler?.();
  }
</script>

{#if shown}
  <div
    class="price-note"
    role="note"
    data-tone={shown.tone === 'warning' ? 'warning' : undefined}
    data-state={failed ? 'failed' : view?.action === 'dismiss' ? 'done' : view?.icon}
    data-testid={testId}
  >
    <span class="price-note__icon" aria-hidden="true"><Icon size="1em" /></span>
    <p class="price-note__text">
      {#if shown.lead}<b>{shown.lead}</b>{' '}{/if}{shown.text}
    </p>
    {#if shown.bar !== null}
      <div
        class="price-note__bar"
        role="progressbar"
        aria-valuenow={shown.bar}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={m.price_note_bar_label()}
      >
        <span style:width="{shown.bar}%"></span>
      </div>
    {/if}
    {#if shown.counts.length > 0}
      <ul class="price-note__counts" data-testid="price-note-counts">
        {#each shown.counts as item (item.label)}
          <li><b>{item.value}</b> {item.label}</li>
        {/each}
      </ul>
    {/if}
    {#if shown.meta}
      <!-- Polite: Check again rewrites this line in place (P6). -->
      <p class="price-note__meta" aria-live="polite" data-testid="price-note-meta">{shown.meta}</p>
    {/if}
    {#if failed}
      <div class="price-note__actions">
        <button
          type="button"
          class="price-note__action"
          aria-busy={busy || undefined}
          onclick={() => press(onTryAgain)}
        >
          {m.price_note_try_again()}
        </button>
      </div>
    {:else if view?.action === 'check' || view?.action === 'dismiss'}
      <!-- One button for both: a Check again that finds the change done
           turns into Dismiss in place, so focus stays on it (W6). -->
      {@const dismiss = view.action === 'dismiss'}
      <div class="price-note__actions">
        <button
          type="button"
          class="price-note__action"
          aria-busy={(!dismiss && busy) || undefined}
          aria-label={name
            ? dismiss
              ? m.price_note_dismiss_aria({ name })
              : m.price_note_check_again_aria({ name })
            : undefined}
          onclick={() => (dismiss ? onDismiss?.() : press(onCheckAgain))}
        >
          {dismiss ? m.price_note_dismiss() : m.price_note_check_again()}
        </button>
      </div>
    {/if}
  </div>
{/if}

<style>
  /* PlanGuidanceNote's tokens and shape at its compact size (the tier row
     and the builder panel are set in --text-xs), plus the warning tone. */
  .price-note {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    column-gap: var(--space-2);
    row-gap: var(--space-1-5);
    align-items: start;
    margin: 0;
    padding: var(--space-2) var(--space-2-5);
    border-radius: var(--radius-md);
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    background-color: var(--color-status-info-surface);
    border: var(--border-width) var(--border-style) var(--color-status-info-border);
    color: var(--color-status-info-text);
  }

  .price-note[data-tone='warning'] {
    background-color: var(--color-status-warning-surface);
    border-color: var(--color-status-warning-border);
    color: var(--color-status-warning-text);
  }

  .price-note__icon {
    display: inline-flex;
    margin-top: var(--space-0-5);
  }

  .price-note__text {
    margin: 0;
    min-width: 0;
    text-wrap: pretty;
  }

  .price-note__text b {
    font-weight: var(--font-semibold);
  }

  .price-note__bar,
  .price-note__counts,
  .price-note__meta,
  .price-note__actions {
    grid-column: 2;
  }

  .price-note__bar {
    height: var(--space-1-5);
    border-radius: var(--radius-full);
    /* No token is a tint of the note's own text colour, which keeps the
       track right in both tones and both themes. */
    background: color-mix(in oklab, currentColor 18%, transparent);
    overflow: hidden;
  }

  .price-note__bar > span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: currentColor;
  }

  .price-note__counts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-4);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .price-note__counts li {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-1);
  }

  .price-note__counts b {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums slashed-zero;
    font-weight: var(--font-semibold);
  }

  .price-note__meta {
    margin: 0;
    text-wrap: pretty;
  }

  .price-note__actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-4);
  }

  .price-note__action {
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    font-weight: var(--font-semibold);
    color: inherit;
    text-decoration: underline;
    text-underline-offset: var(--space-0-5);
    cursor: pointer;
    white-space: nowrap;
  }

  .price-note__action[aria-busy='true'] {
    cursor: progress;
  }

  .price-note__action:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-xs);
  }
</style>
