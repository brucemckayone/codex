<!--
  @component RevenueSplitPie

  Stacked horizontal bar visualising revenue-share splits between the org/owner
  residual and any number of creator slices. Used in both the owner surface
  (full visibility) and the creator surface (self-visible, peers anonymised).

  The whole bar is the POST-PLATFORM pool: 100% is what's left after Codex's
  fee, the unit every share is agreed in (Codex-2hxff.20 AGR-11). It used to
  start with a hard-coded 10% "Platform fee" slice and draw each share against
  the whole sale, so a 30% creator looked like 30% of a sale when they got
  27%, and two valid shares adding to 95% of the pool were flagged as over
  budget. There is no fee slice, so a changed fee cannot make the bar wrong,
  and the warning shows only once the shares pass 100%.

  Despite the name (kept for parity with the epic plan), the component is a
  stacked bar — better for many slices and far more accessible than a radial
  pie. Each draggable boundary acts as a `role="slider"` widget. Numeric inputs
  alongside each unlocked slice stay in sync with drag.

  All values are basis points internally (0-10000) and displayed as percent.
  Colors are CSS custom-property references — never hex literals — so org
  branding flows through unchanged.

  Props mirror the WP-6 spec in Codex-tg3p6.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import * as m from '$paraglide/messages';
  import {
    BP_MAX,
    BP_STEP,
    BP_STEP_LARGE,
    type RevenueSplitMode,
    type RevenueSplitSlice,
  } from './types';

  interface Props {
    /** `owner` = full visibility; `creator` = self + anonymised peers. */
    mode: RevenueSplitMode;
    /** Ordered slices of the post-platform pool, in basis points of it. */
    slices: RevenueSplitSlice[];
    /** Fires only when the user produces a value distinct from current props. */
    onChange?: (next: RevenueSplitSlice[]) => void;
    /** Read-only renders the bar without handles or inputs. */
    readOnly?: boolean;
    /**
     * Whether the viewer can amend an agreement, so the over-100% warning
     * tells them to. Defaults to owner mode; a creator, or an admin on the
     * owner's page, gets the first sentence only.
     */
    canAmend?: boolean;
    /** Optional class forwarded to the root element (composition seam per R13). */
    class?: string;
  }

  const {
    mode,
    slices,
    onChange,
    readOnly = false,
    canAmend,
    class: className,
  }: Props = $props();

  // -- Derived state ---------------------------------------------------------

  /** Sum of the slices, in basis points of the post-platform pool. */
  const sliceTotalBp = $derived(
    slices.reduce((sum, s) => sum + s.percent, 0)
  );

  /** The whole pool: what's left after Codex's fee. */
  const availableBp = BP_MAX;

  /** True when slices over-allocate (sum > 100% of the pool). */
  const isOverAllocated = $derived(sliceTotalBp > availableBp);

  /** True when slices under-allocate (sum < 100% of the pool). */
  const isUnderAllocated = $derived(sliceTotalBp < availableBp);

  const showAmendHint = $derived(canAmend ?? mode === 'owner');

  /**
   * How far past the pool the shares go, rounded UP to a tenth of a percent
   * (10 bp). `formatPercent` prints one decimal, so 3334 × 3 = 10 002 bp
   * would otherwise read "100.0% …, 0.0% more than there is". The total the
   * warning quotes is the pool plus this, so the two figures agree.
   */
  const BP_TENTH = 10;
  const overBp = $derived(
    Math.ceil((sliceTotalBp - availableBp) / BP_TENTH) * BP_TENTH
  );

  // -- SR live-region (debounced) -------------------------------------------

  let liveMessage = $state('');
  let liveTimer: ReturnType<typeof setTimeout> | null = null;

  function announce(message: string) {
    if (liveTimer) clearTimeout(liveTimer);
    liveTimer = setTimeout(() => {
      liveMessage = message;
    }, 200);
  }

  $effect(() => {
    return () => {
      if (liveTimer) clearTimeout(liveTimer);
    };
  });

  // -- Helpers ---------------------------------------------------------------

  function bpToPercent(bp: number): number {
    return bp / 100;
  }

  function formatPercent(bp: number): string {
    const pct = bpToPercent(bp);
    return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(1)}%`;
  }

  /**
   * In creator mode an anonymous slice NEVER shows its `label`, even if a
   * caller put a peer's name there. One slice standing for several peers is
   * named from its `peerCount` ("Other creators (2)"); it used to read
   * "Other creator 2", a per-peer numbering that made two people sound like
   * one.
   */
  function displayLabel(slice: RevenueSplitSlice, index: number): string {
    if (mode === 'creator' && slice.anonymous) {
      return slice.peerCount !== undefined
        ? m.agreement_split_other_creators({ count: String(slice.peerCount) })
        : m.agreement_split_other_creator_numbered({
            number: String(index + 1),
          });
    }
    return slice.label;
  }

  /**
   * Replace one slice and emit. Idempotent: skips the callback when the next
   * value equals the current one (per feedback_melt_controlled_components).
   */
  function emitSliceChange(sliceId: string, nextPercent: number) {
    const current = slices.find((s) => s.id === sliceId);
    if (!current) return;
    if (current.percent === nextPercent) return;
    const next = slices.map((s) =>
      s.id === sliceId ? { ...s, percent: nextPercent } : s
    );
    onChange?.(next);
    announce(
      `${displayLabel(current, slices.indexOf(current))} now ${formatPercent(nextPercent)}`
    );
  }

  /**
   * Max a single slice can grow to without exceeding the available budget.
   */
  function maxForSlice(sliceId: string): number {
    const others = slices
      .filter((s) => s.id !== sliceId)
      .reduce((sum, s) => sum + s.percent, 0);
    return Math.max(0, availableBp - others);
  }

  // -- Keyboard handling -----------------------------------------------------

  function onHandleKeyDown(event: KeyboardEvent, slice: RevenueSplitSlice) {
    if (slice.locked || readOnly) return;
    const isIncrement = event.key === 'ArrowRight' || event.key === 'ArrowUp';
    const isDecrement = event.key === 'ArrowLeft' || event.key === 'ArrowDown';
    const isHome = event.key === 'Home';
    const isEnd = event.key === 'End';
    if (!isIncrement && !isDecrement && !isHome && !isEnd) return;
    event.preventDefault();
    const step = event.shiftKey ? BP_STEP_LARGE : BP_STEP;
    const max = maxForSlice(slice.id);
    let next = slice.percent;
    if (isIncrement) next = Math.min(max, slice.percent + step);
    else if (isDecrement) next = Math.max(0, slice.percent - step);
    else if (isHome) next = 0;
    else if (isEnd) next = max;
    emitSliceChange(slice.id, next);
  }

  // -- Pointer drag handling -------------------------------------------------

  let barEl: HTMLDivElement | undefined = $state();
  let activeDragId: string | null = $state(null);

  function onHandlePointerDown(event: PointerEvent, slice: RevenueSplitSlice) {
    if (slice.locked || readOnly || !barEl) return;
    if (event.button !== 0) return;
    activeDragId = slice.id;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function onHandlePointerMove(event: PointerEvent, slice: RevenueSplitSlice) {
    if (activeDragId !== slice.id || !barEl) return;
    const rect = barEl.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.min(
      1,
      Math.max(0, (event.clientX - rect.left) / rect.width)
    );
    // The handle sits at the trailing boundary of `slice`. Its new cumulative
    // position controls the slice's value:
    //   sliceBp = cumulativeBp - sum(earlier slices)
    const cumulativeBp = Math.round(ratio * BP_MAX);
    const earlierSliceBp = slices
      .slice(0, slices.indexOf(slice))
      .reduce((sum, s) => sum + s.percent, 0);
    const wantedSliceBp = cumulativeBp - earlierSliceBp;
    const max = maxForSlice(slice.id);
    const clamped = Math.min(max, Math.max(0, wantedSliceBp));
    // Snap to nearest BP_STEP for predictable values.
    const snapped = Math.round(clamped / BP_STEP) * BP_STEP;
    emitSliceChange(slice.id, snapped);
  }

  function onHandlePointerUp(event: PointerEvent, slice: RevenueSplitSlice) {
    if (activeDragId !== slice.id) return;
    activeDragId = null;
    try {
      (event.currentTarget as HTMLElement).releasePointerCapture(
        event.pointerId
      );
    } catch {
      // Pointer may already be released; ignore.
    }
  }

  // -- Numeric input handling -----------------------------------------------

  async function onPercentInput(
    event: Event,
    slice: RevenueSplitSlice
  ) {
    if (slice.locked || readOnly) return;
    const target = event.currentTarget as HTMLInputElement;
    const raw = Number(target.value);
    if (!Number.isFinite(raw)) return;
    const clampedPct = Math.min(100, Math.max(0, raw));
    const bp = Math.round(clampedPct * 100);
    const max = maxForSlice(slice.id);
    const next = Math.min(max, bp);
    emitSliceChange(slice.id, next);
    if (next !== bp) {
      await tick();
      target.value = String(bpToPercent(next));
    }
  }
</script>

<div
  class="revenue-split-pie {className ?? ''}"
  data-mode={mode}
  data-state={isOverAllocated ? 'over' : isUnderAllocated ? 'under' : 'balanced'}
>
  <p class="revenue-split-pie__basis">{m.agreement_split_basis()}</p>

  <div
    class="revenue-split-pie__bar"
    role="presentation"
    bind:this={barEl}
  >
    {#each slices as slice, index (slice.id)}
      {@const widthPct = bpToPercent(slice.percent)}
      <div
        class="revenue-split-pie__slice"
        data-locked={slice.locked ? 'true' : 'false'}
        style="--slice-width: {widthPct}%; --slice-color: {slice.color};"
        title="{displayLabel(slice, index)}: {formatPercent(slice.percent)}"
      >
        <span class="revenue-split-pie__slice-fill"></span>
      </div>
    {/each}

    <!-- Handles sit at the trailing boundary of each slice. -->
    {#each slices as slice, index (`handle-${slice.id}`)}
      {@const cumulativeBp = slices
        .slice(0, index + 1)
        .reduce((sum, s) => sum + s.percent, 0)}
      {@const handlePct = bpToPercent(cumulativeBp)}
      {@const max = maxForSlice(slice.id)}
      {@const interactive = !slice.locked && !readOnly}
      <div
        class="revenue-split-pie__handle"
        data-interactive={interactive ? 'true' : 'false'}
        data-dragging={activeDragId === slice.id ? 'true' : 'false'}
        style="--handle-pos: {handlePct}%;"
        role="slider"
        tabindex={interactive ? 0 : -1}
        aria-label="{displayLabel(slice, index)} share"
        aria-valuemin="0"
        aria-valuemax={bpToPercent(max)}
        aria-valuenow={bpToPercent(slice.percent)}
        aria-valuetext={formatPercent(slice.percent)}
        aria-disabled={interactive ? undefined : 'true'}
        onkeydown={(e) => onHandleKeyDown(e, slice)}
        onpointerdown={(e) => onHandlePointerDown(e, slice)}
        onpointermove={(e) => onHandlePointerMove(e, slice)}
        onpointerup={(e) => onHandlePointerUp(e, slice)}
        onpointercancel={(e) => onHandlePointerUp(e, slice)}
      >
        <span class="revenue-split-pie__handle-grip" aria-hidden="true"></span>
      </div>
    {/each}
  </div>

  <ul class="revenue-split-pie__legend">
    {#each slices as slice, sliceIndex (slice.id)}
      <li
        class="revenue-split-pie__legend-item"
        data-locked={slice.locked ? 'true' : 'false'}
      >
        <span
          class="revenue-split-pie__legend-swatch"
          style="--swatch-color: {slice.color};"
          aria-hidden="true"
        ></span>
        <span class="revenue-split-pie__legend-label">
          {displayLabel(slice, sliceIndex)}
        </span>
        {#if readOnly || slice.locked}
          <span class="revenue-split-pie__legend-value">
            {formatPercent(slice.percent)}
          </span>
        {:else}
          <label
            class="revenue-split-pie__legend-input"
            aria-label="{displayLabel(slice, sliceIndex)} share percent"
          >
            <input
              type="number"
              min="0"
              max={bpToPercent(maxForSlice(slice.id))}
              step="1"
              value={bpToPercent(slice.percent)}
              oninput={(e) => onPercentInput(e, slice)}
            />
            <span aria-hidden="true">%</span>
          </label>
        {/if}
      </li>
    {/each}
  </ul>

  <!-- A safety net: the server refuses an accept that would pass 100%
       (agreements.md §Negotiating), so only data older than that check can
       get here. -->
  {#if isOverAllocated}
    <p class="revenue-split-pie__warning" role="status">
      {m.agreement_split_over({
        total: formatPercent(availableBp + overBp),
        over: formatPercent(overBp),
      })}
      {#if showAmendHint}{m.agreement_split_over_amend()}{/if}
    </p>
  {/if}

  <span
    class="revenue-split-pie__sr-live"
    aria-live="polite"
    aria-atomic="true"
  >
    {liveMessage}
  </span>
</div>

<style>
  .revenue-split-pie {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    container-type: inline-size;
    container-name: revenue-split-pie;
  }

  .revenue-split-pie__basis {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  /* -- Bar ---------------------------------------------------------------- */

  .revenue-split-pie__bar {
    position: relative;
    display: flex;
    width: 100%;
    height: var(--space-8);
    background: var(--color-surface-secondary);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
    touch-action: none;
  }

  .revenue-split-pie[data-state='over'] .revenue-split-pie__bar {
    border-color: var(--color-error);
    box-shadow: 0 0 0 var(--border-width) var(--color-status-error-border);
  }

  .revenue-split-pie__slice {
    position: relative;
    height: 100%;
    width: var(--slice-width, 0%);
    min-width: 0;
    flex-shrink: 0;
  }

  .revenue-split-pie__slice-fill {
    display: block;
    width: 100%;
    height: 100%;
    background: var(--slice-color, var(--color-surface-tertiary));
    transition: background-color var(--transition-colors, 180ms ease);
  }

  .revenue-split-pie__slice[data-locked='true'] .revenue-split-pie__slice-fill {
    /* Locked slices read as system-set, not user-owned. */
    background-image: linear-gradient(
      135deg,
      var(--slice-color, var(--color-text-muted)) 0%,
      var(--slice-color, var(--color-text-muted)) 50%,
      oklch(from var(--slice-color, var(--color-text-muted)) calc(l + 0.05) c h) 50%,
      oklch(from var(--slice-color, var(--color-text-muted)) calc(l + 0.05) c h) 100%
    );
    background-size: var(--space-3) var(--space-3);
  }

  /* -- Handles ------------------------------------------------------------ */

  .revenue-split-pie__handle {
    position: absolute;
    inset-block: 0;
    inset-inline-start: var(--handle-pos, 0%);
    transform: translateX(-50%);
    width: var(--space-4);
    display: grid;
    place-items: center;
    background: transparent;
    border: none;
    padding: 0;
  }

  .revenue-split-pie__handle[data-interactive='true'] {
    cursor: ew-resize;
  }

  .revenue-split-pie__handle[data-interactive='false'] {
    pointer-events: none;
    opacity: 0;
  }

  .revenue-split-pie__handle-grip {
    display: block;
    width: var(--border-width-thick, 2px);
    height: 60%;
    background: var(--color-surface);
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-sm);
    transition:
      transform var(--transition-colors, 180ms ease),
      background-color var(--transition-colors, 180ms ease);
  }

  .revenue-split-pie__handle[data-interactive='true']:hover
    .revenue-split-pie__handle-grip,
  .revenue-split-pie__handle[data-dragging='true']
    .revenue-split-pie__handle-grip {
    background: var(--color-interactive);
    transform: scaleY(1.05);
  }

  .revenue-split-pie__handle:focus-visible {
    outline: none;
  }

  .revenue-split-pie__handle:focus-visible .revenue-split-pie__handle-grip {
    outline: var(--border-width-thick, 2px) solid var(--color-focus);
    outline-offset: 2px;
  }

  /* -- Legend ------------------------------------------------------------- */

  .revenue-split-pie__legend {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  @container revenue-split-pie (min-width: 32rem) {
    .revenue-split-pie__legend {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--space-3);
    }
  }

  @container revenue-split-pie (min-width: 48rem) {
    .revenue-split-pie__legend {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }

  .revenue-split-pie__legend-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2);
    background: var(--color-surface);
    border: var(--border-width) solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .revenue-split-pie__legend-item[data-locked='true'] {
    background: var(--color-surface-secondary);
    color: var(--color-text-secondary);
  }

  .revenue-split-pie__legend-swatch {
    flex-shrink: 0;
    width: var(--space-3);
    height: var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--swatch-color, var(--color-surface-tertiary));
    border: var(--border-width) solid var(--color-border-subtle);
  }

  .revenue-split-pie__legend-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .revenue-split-pie__legend-value {
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .revenue-split-pie__legend-input {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .revenue-split-pie__legend-input input {
    width: var(--space-12);
    padding: var(--space-1) var(--space-2);
    background: var(--color-surface);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-sm);
    color: var(--color-text);
    font: inherit;
    text-align: end;
  }

  .revenue-split-pie__legend-input input:focus-visible {
    outline: var(--border-width-thick, 2px) solid var(--color-focus);
    outline-offset: 2px;
    border-color: var(--color-border-focus);
  }

  .revenue-split-pie__legend-input input:disabled {
    background: var(--color-surface-secondary);
    color: var(--color-text-muted);
    cursor: not-allowed;
  }

  /* -- Warning state ------------------------------------------------------ */

  /* The status triple, not the raw --color-error-50/-700/-200 steps: those
     are fixed light-mode values, so the -50 tint turned into the brightest
     box on a dark page. See styles/themes/status.css. */
  .revenue-split-pie__warning {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    background: var(--color-status-error-surface);
    color: var(--color-status-error-text);
    border: var(--border-width) solid var(--color-status-error-border);
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
  }

  /* -- Screen-reader live region ----------------------------------------- */

  .revenue-split-pie__sr-live {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  /* -- Reduced motion ----------------------------------------------------- */

  @media (prefers-reduced-motion: reduce) {
    .revenue-split-pie__slice-fill,
    .revenue-split-pie__handle-grip {
      transition: none;
    }
  }
</style>
