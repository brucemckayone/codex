<!--
  @component ChangeToggle

  The `toggle` layout: a switch over one panel that flips between where the
  visitor is now and where they will be — the WAI-ARIA tabs pattern. Until
  the page's script runs it IS the `columns` layout, so a visitor without
  JavaScript reads both sides.

  The tabs are shorter than the columns they replace, so the swap waits until
  the section is still ahead of the visitor (below the viewport): nothing they
  are looking at re-lays out. A still preview (the canvas, thumbnails) swaps
  at once. Both panels share one grid cell, so the stage is always as tall as
  the taller side and flipping never changes the section's height.

  With only one side written there is nothing to flip, so it stays columns.
-->
<script lang="ts">
  import type { Attachment } from 'svelte/attachments';
  import { CheckIcon } from '$lib/components/ui/Icon';
  import type { ColourSchemeId } from '../../model/ids';
  import type { BlockEdit } from '../../model/types';
  import { SIDES, type Side, type SideLabels, type SideLines } from './change';
  import ChangeColumns from './ChangeColumns.svelte';
  import { TRANSFORMATION_COPY } from './copy';

  interface Props {
    lines: SideLines;
    labels: SideLabels;
    anchor: string;
    featured: ColourSchemeId;
    edit: BlockEdit | null;
  }

  const { lines, labels, anchor, featured, edit }: Props = $props();

  let ready = $state(false);
  let selected = $state<Side>('before');
  const tabs = $derived(ready && lines.before.length > 0 && lines.after.length > 0);
  const tabId = (side: Side) => `${anchor}-tab-${side}`;
  const panelId = (side: Side) => `${anchor}-panel-${side}`;

  /** Hands the section to the tabs once re-laying it out moves nothing in view. */
  const whenAhead: Attachment<HTMLElement> = (root) => {
    if (typeof IntersectionObserver === 'undefined') return;
    const still = root.closest('[data-lp-still]') !== null;
    const observer = new IntersectionObserver(([entry]) => {
      if (still || (!entry.isIntersecting && entry.boundingClientRect.top > 0)) {
        ready = true;
        observer.disconnect();
      }
    });
    observer.observe(root);
    return () => observer.disconnect();
  };

  const KEYS: Record<string, (index: number) => number> = {
    ArrowRight: (index) => (index + 1) % SIDES.length,
    ArrowLeft: (index) => (index - 1 + SIDES.length) % SIDES.length,
    Home: () => 0,
    End: () => SIDES.length - 1,
  };

  /** Automatic activation: the arrow keys move the selection with the focus. */
  function step(event: KeyboardEvent, side: Side) {
    const move = KEYS[event.key];
    if (!move) return;
    event.preventDefault();
    selected = SIDES[move(SIDES.indexOf(side))];
    document.getElementById(tabId(selected))?.focus();
  }
</script>

<div class="tf-toggle" data-tabs={tabs ? '' : undefined} {@attach whenAhead}>
  {#if tabs}
    <div class="tf-toggle__switch" role="tablist" aria-label={TRANSFORMATION_COPY.switch}>
      {#each SIDES as side (side)}
        <button
          type="button"
          role="tab"
          class="tf-toggle__tab"
          id={tabId(side)}
          aria-selected={selected === side}
          aria-controls={panelId(side)}
          tabindex={selected === side ? 0 : -1}
          onclick={() => (selected = side)}
          onkeydown={(event) => step(event, side)}
        >
          {labels[side] ?? TRANSFORMATION_COPY[side]}
        </button>
      {/each}
    </div>
    <div class="tf-toggle__stage">
      {#each SIDES as side (side)}
        <div
          class="tf-toggle__panel"
          data-side={side}
          data-lp-scheme={side === 'after' ? featured : undefined}
          role="tabpanel"
          id={panelId(side)}
          aria-labelledby={tabId(side)}
          tabindex="0"
          hidden={selected !== side}
        >
          <ul>
            {#each lines[side] as line, index (index)}
              <li>
                <span class="tf-toggle__mark" aria-hidden="true">
                  {#if side === 'after'}<CheckIcon size="1em" />{/if}
                </span>
                <span>{line}</span>
              </li>
            {/each}
          </ul>
        </div>
      {/each}
    </div>
  {:else}
    <ChangeColumns {lines} {labels} {anchor} {featured} {edit} />
  {/if}
</div>

<style>
  .tf-toggle[data-tabs] {
    --_pad: clamp(var(--space-5), var(--space-3) + 2cqi, var(--space-10));
    display: grid;
    justify-items: start;
    gap: var(--space-5);
  }

  /* ── the switch ────────────────────────────────────────────────────────── */
  .tf-toggle__switch {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
    gap: var(--space-1);
    max-inline-size: 100%;
    padding: var(--space-1);
    border-radius: calc(var(--lp-radius-button) + var(--space-1));
    box-shadow: inset 0 0 0 var(--lp-border) var(--lp-button-line);
  }

  .tf-toggle__tab {
    min-block-size: var(--tap-target-min);
    padding: var(--space-2) var(--space-5);
    border-radius: var(--lp-radius-button);
    color: var(--lp-ink);
    font-family: var(--lp-font-body);
    font-size: var(--lp-button-size);
    font-weight: var(--lp-button-weight);
    letter-spacing: var(--lp-button-tracking);
    line-height: var(--lp-leading-title);
    text-wrap: balance;
  }

  .tf-toggle__tab[aria-selected='true'] {
    background: var(--lp-button-bg);
    color: var(--lp-button-ink);
  }

  @media (hover: hover) {
    .tf-toggle__tab[aria-selected='false']:hover {
      text-decoration: underline;
      text-decoration-thickness: var(--border-width);
      text-underline-offset: var(--lp-underline-offset);
    }
  }

  /* ── the stage: both panels in one cell, so it is as tall as the taller ── */
  .tf-toggle__stage {
    display: grid;
    justify-self: stretch;
  }

  .tf-toggle__panel {
    grid-area: 1 / 1;
    display: grid;
    align-content: start;
    padding: var(--_pad);
    border-radius: var(--lp-radius-card);
    box-shadow: inset 0 0 0 var(--lp-border) var(--lp-line);
  }

  /* The panel not shown keeps its place, so the stage never resizes. */
  .tf-toggle__panel[hidden] {
    display: grid;
    visibility: hidden;
  }

  .tf-toggle__panel[data-side='after'] {
    background: var(--lp-bg);
    box-shadow: none;
    color: var(--lp-ink);
  }

  ul {
    display: grid;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* base.css spaces every `li` but the last; the lines carry their own. */
  li {
    display: grid;
    grid-template-columns: 1em minmax(0, 1fr);
    align-items: start;
    gap: var(--space-3);
    margin: 0;
    padding-block: var(--space-4);
    border-block-start: var(--lp-border) var(--border-style) var(--lp-line);
    font-size: var(--lp-size-title);
    line-height: var(--lp-leading-title);
    text-wrap: pretty;
  }

  li:first-child {
    padding-block-start: 0;
    border-block-start: none;
  }

  li:last-child {
    padding-block-end: 0;
  }

  .tf-toggle__panel[data-side='before'] li {
    color: var(--lp-ink-soft);
    font-family: var(--lp-font-body);
  }

  /* The change is told in type as well as colour: the after lines take the
     display face. */
  .tf-toggle__panel[data-side='after'] li {
    font-family: var(--lp-font-display);
    font-weight: var(--lp-weight-title);
    font-synthesis: none;
    letter-spacing: var(--lp-tracking-title);
  }

  /* Both marks sit on the FIRST line, however the line wraps. */
  .tf-toggle__mark {
    display: inline-flex;
    margin-block-start: calc((1lh - 1em) / 2);
    color: var(--lp-accent);
  }

  .tf-toggle__panel[data-side='before'] .tf-toggle__mark {
    align-self: start;
    margin-block-start: calc(0.5lh - var(--border-width-thick) / 2);
    inline-size: 0.6em;
    block-size: var(--border-width-thick);
    background: var(--lp-ink-soft);
  }

  /* A phone: the switch spans the column, one half per side. */
  @container (max-width: 30rem) {
    .tf-toggle__switch {
      justify-self: stretch;
    }
  }

  /* The flip crossfades; the panel leaving keeps its place until it has
     faded, then drops out of reach. */
  @media (prefers-reduced-motion: no-preference) {
    :global(.lp:not([data-lp-still])) .tf-toggle__tab {
      transition: var(--transition-colors);
    }

    :global(.lp:not([data-lp-still])) .tf-toggle__panel {
      transition:
        opacity var(--duration-slow) var(--ease-out),
        visibility 0s;
    }

    :global(.lp:not([data-lp-still])) .tf-toggle__panel[hidden] {
      opacity: 0;
      transition:
        opacity var(--duration-slow) var(--ease-out),
        visibility 0s linear var(--duration-slow);
    }
  }
</style>
