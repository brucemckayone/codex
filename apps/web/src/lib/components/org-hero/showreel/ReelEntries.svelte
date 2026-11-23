<!--
  @component ReelEntries

  The Showreel's entries: along the foot on Wide and Name
  (the strip), or beside the words on Corner (the index, with "Explore
  everything"). Each row shows its piece; the one on show carries its
  progress (`--_progress`, the Showreel's). The mouse resting on either
  holds the reel. Hidden on a phone, where the story segments stand in.
-->
<script lang="ts">
  import type { ReelWords } from '$lib/org-hero/showreel/reel-words';
  import * as m from '$paraglide/messages';

  interface Props {
    /** Wide and Name: the strip along the foot; Corner: the index. */
    strip: boolean;
    words: readonly ReelWords[];
    /** The piece on show. */
    shown: number;
    /** A row pressed: show its piece. */
    onpick: (i: number) => void;
    /** The mouse over the strip or the index holds the reel (`hover(true)`), and lets it go. */
    hover: (on: boolean) => (event: PointerEvent) => void;
    exploreHref: string;
  }

  let { strip, words, shown, onpick, hover, exploreHref }: Props = $props();
</script>

{#snippet item(w: ReelWords, i: number, kind: boolean)}
  <li>
    <button type="button" class="reel__item" aria-current={i === shown ? 'true' : undefined} onclick={() => onpick(i)}>
      <span class="reel__n" data-ink="body">{w.number}</span>
      <span class="reel__t" data-ink="body">{w.title}</span>
      {#if kind}<span class="reel__k" data-ink="body">{w.kind}</span>{/if}
      <span class="reel__bar" aria-hidden="true"><i></i></span>
    </button>
  </li>
{/snippet}

{#if strip}
  <ol class="reel__strip" onpointerenter={hover(true)} onpointerleave={hover(false)}>
    {#each words as w, i (i)}{@render item(w, i, false)}{/each}
  </ol>
{:else}
  <nav class="reel__index" aria-label={m.org_hero_reel_label()} onpointerenter={hover(true)} onpointerleave={hover(false)}>
    <ol>
      {#each words as w, i (i)}{@render item(w, i, true)}{/each}
    </ol>
    <a class="reel__all" href={exploreHref} data-ink="body">{m.org_hero_explore_everything()}</a>
  </nav>
{/if}

<style>
  /* The reel's focus ring (Showreel.svelte), on keyboard focus only. A row of the index
     or strip, and the "All" link, have no inline padding (their words sit on
     the box's edges), so their ring stands further off and rounds, clear of
     "01" and "Film". */
  .reel__item:focus-visible,
  .reel__all:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    /* Its own band of the solid scrim under the ring and a little past it:
       a two-tone indicator, so the ring keeps 3:1 over any frame. */
    box-shadow: 0 0 0 calc(var(--space-0-5) + var(--border-width-thick) + var(--space-0-5)) var(--_scrim);
  }

  .reel__item:focus-visible,
  .reel__all:focus-visible {
    outline-offset: var(--space-1-5);
    border-radius: var(--radius-sm);
    box-shadow: 0 0 0 calc(var(--space-1-5) + var(--border-width-thick) + var(--space-0-5)) var(--_scrim);
  }

  .reel__index {
    grid-area: 3 / 2;
  }

  .reel__index {
    padding-top: calc(var(--space-9) + var(--space-3-5));
  }

  .reel__index .reel__item {
    position: relative;
    display: grid;
    grid-template-columns: var(--space-9) minmax(0, 1fr) auto;
    gap: var(--space-2);
    align-items: baseline;
    width: 100%;
    padding: var(--space-3) 0;
    border: none;
    border-top: var(--border-width) solid var(--_line);
    background: none;
    color: var(--_ink-soft);
    font-size: var(--text-base);
    text-align: start;
    cursor: pointer;
  }

  .reel__index li:last-child .reel__item {
    border-bottom: var(--border-width) solid var(--_line);
  }

  .reel__item[aria-current] {
    color: var(--_ink);
  }

  .reel__n,
  .reel__k {
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .reel__t {
    font-family: var(--font-heading);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .reel__bar {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: var(--space-0-5);
    overflow: hidden;
  }

  /* A piece's progress (the phone's segments take the same in ReelSegments.svelte). */
  .reel__bar i {
    display: block;
    height: 100%;
    background: var(--_ink);
    transform: scaleX(0);
    transform-origin: left;
  }

  [aria-current] > .reel__bar i {
    transform: scaleX(var(--_progress));
  }

  .reel__all {
    display: inline-block;
    margin-top: var(--space-3-5);
    font-size: var(--text-sm);
    color: var(--_ink);
  }

  /* ── Wide and Name: the strip along the foot ── */
  .reel__strip {
    grid-area: 3 / 1;
    align-self: end;
    display: grid;
    grid-auto-columns: minmax(0, 1fr);
    grid-auto-flow: column;
    gap: var(--space-5);
    align-items: end;
  }

  /* Where the pause stands too. On the inner's own: the reel's `ol` margin
     reset (Showreel.svelte) outranks the strip's class. */
  :global(.reel__inner) > .reel__strip {
    margin-bottom: var(--space-9);
  }

  /* The pause's column, the strip's last (the pause is drawn over it). */
  .reel__strip::after {
    content: '';
  }

  .reel__strip .reel__item {
    position: relative;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--space-2-5);
    align-items: baseline;
    width: 100%;
    padding: var(--space-3) 0 0;
    border: none;
    background: none;
    color: var(--_ink-soft);
    font-size: var(--text-sm);
    text-align: start;
    cursor: pointer;
  }

  .reel__strip .reel__bar {
    top: 0;
    bottom: auto;
    background: var(--_line);
  }

  @media (--below-md) {
    .reel__index,
    .reel__strip {
      display: none;
    }
  }
</style>
