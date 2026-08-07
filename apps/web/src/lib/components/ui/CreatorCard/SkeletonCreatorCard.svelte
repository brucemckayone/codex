<!--
  @component SkeletonCreatorCard

  Loading placeholder for CreatorCarouselCard, the org landing's contributor
  carousel.

  ## Why the geometry changed

  It used to be a 3rem circle beside two text bars — a 96px horizontal row,
  rendered four-up next to ~500px-tall 4:5 carousel cards. Every landing page
  load therefore jumped roughly 400px the moment the creators promise resolved.
  Reproducing the real card's 4:5 frame plus its two meta lines makes the reserve
  exact, so there is no shift at all.

  The directory at /creators deliberately has no skeleton: its grid is awaited
  server-side because it feeds the page's ItemList schema, so it never renders a
  loading state.
-->
<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import { Skeleton } from '../Skeleton';

  interface Props extends HTMLAttributes<HTMLDivElement> {}

  const { class: className, ...restProps }: Props = $props();
</script>

<div class="skeleton-creator {className ?? ''}" aria-hidden="true" {...restProps}>
  <div class="skeleton-creator__frame">
    <Skeleton width="100%" height="100%" />
  </div>
  <div class="skeleton-creator__meta">
    <!--
      Exactly CreatorCarouselCard's caption box: a name clamped to two lines of
      --text-2xl/--leading-tight, then one --text-xs role line. The card reserves
      both name lines unconditionally, so these two bars reproduce its height for
      any creator, not just short-named ones.

      The trailing `+ var(--space-0-5)` is not a fudge: the card's name carries
      exactly that much `padding-block-end` to seat the hairline underline it
      draws in on hover. Omitting it left a measured 2px shift.
    -->
    <Skeleton
      width="80%"
      height="calc(2 * var(--leading-tight) * var(--text-2xl) + var(--space-0-5))"
    />
    <Skeleton width="45%" height="calc(var(--leading-normal) * var(--text-xs))" />
  </div>
</div>

<style>
  .skeleton-creator {
    display: flex;
    flex-direction: column;
    /* Same gap as CreatorCarouselCard's frame → meta gap. */
    gap: var(--space-3);
  }

  .skeleton-creator__frame {
    aspect-ratio: 4 / 5;
    overflow: hidden;
    border-radius: var(--radius-sm);
  }

  .skeleton-creator__meta {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding-inline: var(--space-1);
  }
</style>
