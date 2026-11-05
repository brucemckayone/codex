<!--
  @component Dialog.Toolbar

  A fixed control bar between Header and Body that never scrolls: a search
  box, type filters. It is `flex: none`, so Dialog.Body still takes the rest
  of the panel and scrolls on its own; a page never hand-writes this bar.

  Part order: Dialog.Header, Dialog.Toolbar (optional), Dialog.Body,
  Dialog.Footer. A Dialog.Form wraps the Toolbar / Body / Footer run.

  @prop {'row' | 'column'} [direction='row'] - `row` wraps its controls on
    one line (a search box and its buttons); `column` stacks them (a search
    box above a row of chips).
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    children: Snippet;
    direction?: 'row' | 'column';
  }

  const { children, direction = 'row', class: className, ...restProps }: Props = $props();
</script>

<div class="dialog-toolbar {className ?? ''}" data-direction={direction} {...restProps}>
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
</style>
