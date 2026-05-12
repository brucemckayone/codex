<!--
  @component StickyToolbar

  Pins its children to the top of the viewport while scrolling. When the
  sentinel above scrolls out of view, the bar earns elevation: a hairline
  border, a soft shadow, and a 6px gradient fade beneath that vignettes
  the scroll edge.

  The glass background extends edge-to-edge (full viewport width) via a
  ::before pseudo so the bar reads as a continuous surface even when its
  parent is constrained by a max-width container.

  Composition: place this as a direct child of the content container that
  scrolls. Children render inline as usual; the primitive only controls
  the surrounding chrome.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    children: Snippet;
    /** Optional class hook on the inner row for spacing/layout tweaks. */
    class?: string;
  }

  const { children, class: className = '' }: Props = $props();

  let stuck = $state(false);
  let sentinel = $state<HTMLDivElement | null>(null);

  $effect(() => {
    if (!sentinel) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        stuck = !entry.isIntersecting;
      },
      { threshold: [1] }
    );
    obs.observe(sentinel);
    return () => obs.disconnect();
  });
</script>

<div class="sticky-toolbar__sentinel" aria-hidden="true" bind:this={sentinel}></div>

<div
  class="sticky-toolbar {className}"
  data-stuck={stuck ? 'true' : 'false'}
>
  {@render children()}
</div>

<style>
  /* 1px sentinel placed immediately above the bar. Negative bottom margin
     keeps it from introducing visible vertical space. When it leaves the
     viewport (i.e. scroll has pushed it off-screen), the bar is pinned. */
  .sticky-toolbar__sentinel {
    height: 1px;
    width: 100%;
    pointer-events: none;
    margin-bottom: calc(-1 * var(--space-1));
  }

  .sticky-toolbar {
    position: sticky;
    top: 0;
    z-index: var(--z-sticky);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3) var(--space-4);
    padding-block: var(--space-3);
    /* The bar itself is transparent — paint travels through ::before so we
       can full-bleed the surface beyond the parent container. */
    background: transparent;
    transition:
      box-shadow var(--duration-fast) var(--ease-out),
      border-color var(--duration-fast) var(--ease-out);
  }

  /* Full-bleed glass surface. inset-inline: calc(50% - 50vw) extends to
     the viewport edges regardless of parent container width. z-index: -1
     keeps it behind the bar's flex children. */
  .sticky-toolbar::before {
    content: '';
    position: absolute;
    inset-block: 0;
    inset-inline: calc(50% - 50vw);
    z-index: -1;
    background: color-mix(in oklab, var(--color-surface) 88%, transparent);
    backdrop-filter: blur(var(--blur-md));
    -webkit-backdrop-filter: blur(var(--blur-md));
    border-bottom: var(--border-width) var(--border-style) transparent;
    transition:
      border-color var(--duration-fast) var(--ease-out),
      box-shadow var(--duration-fast) var(--ease-out),
      opacity var(--duration-fast) var(--ease-out);
    opacity: 0;
  }

  /* 6px gradient fade beneath the bar, paints into the scroll body and
     vignettes incoming cards as they scroll under the glass surface. */
  .sticky-toolbar::after {
    content: '';
    position: absolute;
    top: 100%;
    inset-inline: calc(50% - 50vw);
    height: var(--space-1-5);
    background: linear-gradient(
      to bottom,
      color-mix(in oklab, var(--color-text) 6%, transparent),
      transparent
    );
    pointer-events: none;
    opacity: 0;
    transition: opacity var(--duration-fast) var(--ease-out);
  }

  .sticky-toolbar[data-stuck='true']::before {
    opacity: 1;
    border-bottom-color: var(--color-border-subtle);
    box-shadow: var(--shadow-sm);
  }

  .sticky-toolbar[data-stuck='true']::after {
    opacity: 1;
  }

  /* Reduced motion: drop the fade-in, snap to pinned state instantly. */
  @media (prefers-reduced-motion: reduce) {
    .sticky-toolbar,
    .sticky-toolbar::before,
    .sticky-toolbar::after {
      transition: none;
    }
  }
</style>
