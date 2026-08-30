<!--
  @component SectionSkeleton

  Generic loading placeholder for a STREAMED section payload (shell+stream). Used
  as the `{#await}` pending branch when a section is waiting on the streamed
  sell-preview media. Token-driven; the shimmer collapses under
  prefers-reduced-motion via the shared `Skeleton` primitive.

  @prop {'media' | 'text'} [shape='media'] - Placeholder silhouette
  @prop {string} [label='Loading preview'] - sr-only status label
  @prop {string} [aspect] - Explicit `aspect-ratio` for `shape='media'`
-->
<script lang="ts">
  import { Skeleton } from '$lib/components/ui/Skeleton';

  interface Props {
    shape?: 'media' | 'text';
    label?: string;
    /**
     * An explicit `aspect-ratio` for `shape='media'` (e.g. `'21 / 9'`), for a host
     * OUTSIDE the journey surface that knows its own media shape. Inside a journey
     * section nothing needs to pass it — see the `aspect-ratio` declaration below
     * for why the axis value is inherited instead.
     *
     * `shape='text'` has no aspect and ignores this (`Codex-ae2ea` is scoped to
     * the media silhouette).
     */
    aspect?: string;
  }

  const { shape = 'media', label = 'Loading preview', aspect }: Props = $props();
</script>

<div
  class="section-skeleton"
  aria-hidden="true"
  data-shape={shape}
  style={aspect ? `--section-skeleton-aspect: ${aspect}` : undefined}
>
  {#if shape === 'media'}
    <Skeleton width="100%" height="100%" />
  {:else}
    <Skeleton width="60%" height="var(--text-2xl)" />
    <Skeleton width="90%" height="var(--text-base)" />
    <Skeleton width="75%" height="var(--text-base)" />
  {/if}
</div>
<span class="sr-only" role="status">{label}…</span>

<style>
  .section-skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    width: 100%;
  }

  .section-skeleton[data-shape='media'] {
    /*
      THREE TERMS, IN PRECEDENCE ORDER, and the middle one is the fix (Codex-ae2ea).

      It was a hardcoded `16 / 9` while the `media` design axis renders the box it
      stands in at `21 / 9` under `bleed`, `4 / 5` under `mask` and `3 / 2` under
      `inset` — so the placeholder was a different SHAPE from the content it stood
      for, on every value of the axis but two.

      `--jp-media-aspect` is declared per `data-jp-media` value on `.jp-sec`
      (`journey-design.css`), and this element is always a descendant of one, so it
      INHERITS the axis its host resolved. That makes every journey-section caller
      correct with zero caller changes — and it cannot drift, because there is no
      second copy of the value to keep in step.

      NO LAYOUT SHIFT WAS EVER INVOLVED, contrary to the bead: `.iv__media` sets
      its own `aspect-ratio: var(--jp-media-aspect)`, so the section's height is
      axis-correct in both the pending and resolved states. The defect was purely
      that the shimmer sat centred inside a taller or shorter box with dead space
      around it.

      The `aspect` prop is first so a host outside the journey surface can state a
      shape; the `16 / 9` tail preserves today's behaviour for a host that provides
      neither.
    */
    aspect-ratio: var(
      --section-skeleton-aspect,
      var(--jp-media-aspect, 16 / 9)
    );
    border-radius: var(--radius-card);
    overflow: hidden;
  }

  .sr-only {
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
</style>
