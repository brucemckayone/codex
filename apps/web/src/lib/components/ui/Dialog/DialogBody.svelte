<script lang="ts">
  import { getContext, type Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    children: Snippet;
  }

  const { children, class: className, ...restProps }: Props = $props();
  // Set by Dialog.Content; absent when Body is mounted on its own.
  const layout = getContext<
    { current: 'dialog' | 'drawer' | 'floating'; flush: boolean } | undefined
  >('DIALOG_LAYOUT');
</script>

<div
  {...restProps}
  class="dialog-body {className ?? ''}"
  data-layout={layout?.current}
  data-flush={layout?.flush ? '' : undefined}
>
  {@render children()}
</div>

<style>
  .dialog-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-6);
    overflow-y: auto;
    /* The page behind is scroll-locked: a scroll that reaches the end stops
       here rather than chaining out (FilterDrawer set this on its own). */
    overscroll-behavior-y: contain;
    flex: 1;
    min-height: 0;
  }

  /* A child keeps its own height and Body scrolls instead. A flex column
     that overflows shrinks a child to its automatic minimum: below the
     height of a fixed-height Button, and zero for anything that clips, as a
     Skeleton does (MediaPicker's "Show more" drew 21px of 32). Zero
     specificity, so a child that means to flex (an inner scroller's
     `flex: 1; min-height: 0`) wins with any rule of its own. In a drawer the
     children are the panel's flex items, and this holds there too. */
  :where(.dialog-body) > :global(*) {
    flex-shrink: 0;
  }

  /* Flush: a bare box that still takes the rest of the panel and scrolls.
     Before the drawer rule, which outranks it at the same specificity. */
  .dialog-body[data-flush] {
    display: block;
    padding: 0;
  }

  /* In a drawer the whole panel scrolls and spaces its children, so Body
     adds no box of its own: its children are the panel's. (A floating
     drawer scrolls Body, as a dialog does.) */
  .dialog-body[data-layout='drawer'] {
    display: contents;
  }
</style>
