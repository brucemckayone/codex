<!--
  @component Dialog.Toolbar

  A fixed control bar between Header and Body: a search box, type filters.
  It is `flex: none`, so Dialog.Body still takes the rest of the panel and
  scrolls on its own; a page never hand-writes this bar. The bar stops at a
  third of the screen and scrolls past that, so it can never push the
  Footer out.

  Part order: Dialog.Header, Dialog.Toolbar (optional), Dialog.Body,
  Dialog.Footer. A Dialog.Form wraps the Toolbar / Body / Footer run.

  @prop {'row' | 'column'} [direction='row'] - `row` wraps its controls on
    one line (a search box and its buttons); `column` stacks them (a search
    box above a row of chips).
-->
<script lang="ts">
  import { getContext, type Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    children: Snippet;
    direction?: 'row' | 'column';
  }

  const { children, direction = 'row', class: className, ...restProps }: Props = $props();
  // Set by Dialog.Content; absent when Toolbar is mounted on its own.
  const layout = getContext<{ current: 'dialog' | 'drawer' | 'floating'; flush: boolean } | undefined>(
    'DIALOG_LAYOUT'
  );
</script>

<div
  {...restProps}
  class={['dialog-toolbar', className]}
  data-direction={direction}
  data-layout={layout?.current}
  data-flush={layout?.flush ? '' : undefined}
>
  {@render children()}
</div>

<style>
  /* MediaPickerDialog's `.picker-tools`: inset like Header and Body. */
  .dialog-toolbar {
    display: flex;
    flex: none;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-6) var(--space-2);
  }

  .dialog-toolbar[data-direction='column'] {
    flex-direction: column;
    flex-wrap: nowrap;
    align-items: stretch;
  }

  /* A bar can outgrow a short screen, with stacked fields or a row of chips
     wrapped onto many lines, and the Footer below went out of reach
     (Codex-vlphc review G2-L7, G3-L7). The bar stops at a third of the
     screen and scrolls, so Body and Footer keep the rest. A drawer scrolls
     as a whole and needs no second scroller. A scroller clips at its
     padding box, so the bar is pulled up into a top padding of the same
     size, the focus ring's reach (its width and its offset): a field's
     ring at the top edge still shows, and nothing moves. The vh line is
     for an engine without dvh, which drops the dvh one (Safari < 15.4,
     Chrome < 108, Firefox < 101). */
  .dialog-toolbar:not([data-flush], [data-layout='drawer']) {
    --toolbar-ring: calc(var(--border-width-thick) + var(--space-0-5));
    max-height: 33vh;
    max-height: 33dvh;
    overflow-y: auto;
    overscroll-behavior-y: contain;
    margin-top: calc(-1 * var(--toolbar-ring));
    padding-top: var(--toolbar-ring);
  }

  /* Flush: a bare box around the page's own row (a palette's search row). */
  .dialog-toolbar[data-flush] {
    display: block;
    padding: 0;
  }
</style>
