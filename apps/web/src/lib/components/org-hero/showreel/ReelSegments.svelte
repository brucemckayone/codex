<!--
  @component ReelSegments

  The Showreel's story segments on a phone: one bar per
  piece along the top, the ones shown full, the one on show carrying its
  progress (`--_progress`, the Showreel's). Hidden on a desktop, where the
  index or the strip stands in.
-->
<script lang="ts">
  interface Props {
    /** How many pieces the reel has. */
    count: number;
    /** The piece on show. */
    shown: number;
  }

  let { count, shown }: Props = $props();
</script>

<div class="reel__segs">
  <ol>
    {#each Array.from({ length: count }) as _, i (i)}
      <li data-on={i === shown ? '' : undefined} data-done={i < shown ? '' : undefined}><i></i></li>
    {/each}
  </ol>
</div>

<style>
  /* A piece's progress (the index's and strip's bars take the same in
     ReelEntries.svelte). */
  .reel__segs li i {
    display: block;
    height: 100%;
    background: var(--_ink);
    transform: scaleX(0);
    transform-origin: left;
  }

  /* ── the phone's story segments (hidden on a desktop) ── */
  .reel__segs {
    display: none;
  }

  .reel__segs ol {
    display: flex;
    flex: 1;
    gap: var(--space-1);
  }

  .reel__segs li {
    flex: 1;
    height: var(--space-0-5);
    border-radius: var(--radius-full);
    background: var(--_line);
    overflow: hidden;
  }

  .reel__segs li[data-done] i {
    transform: none;
  }

  .reel__segs li[data-on] i {
    transform: scaleX(var(--_progress));
  }

  @media (--below-md) {
    .reel__segs {
      position: absolute;
      top: var(--space-3);
      left: var(--_gutter);
      right: var(--_gutter);
      display: flex;
      align-items: center;
      gap: var(--space-3);
    }

    /* The pause's place, top right, which the segments' pool covers. */
    .reel__segs::after {
      content: '';
      flex: none;
      width: var(--space-9);
      height: var(--space-9);
    }
  }
</style>
