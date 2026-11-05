<!--
  @component Dialog.Footer

  The action row, last in the panel (or in its Dialog.Form).

  @prop {'end' | 'between'} [align='end'] - `end`: actions stacked on a
    phone, right-aligned in a row from sm. `between`: one row at every width,
    the first action at the start and the last at the end (a Clear beside an
    Apply).
-->
<script lang="ts">
  import { getContext, type Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    children: Snippet;
    align?: 'end' | 'between';
  }

  const { children, align = 'end', class: className, ...restProps }: Props = $props();
  // Set by Dialog.Content; absent when Footer is mounted on its own.
  const layout = getContext<
    { current: 'dialog' | 'drawer' | 'floating'; flush: boolean } | undefined
  >('DIALOG_LAYOUT');
</script>

<div
  class="dialog-footer {className ?? ''}"
  data-layout={layout?.current}
  data-align={align}
  data-flush={layout?.flush ? '' : undefined}
  {...restProps}
>
  {@render children()}
</div>

<style>
  .dialog-footer {
    display: flex;
    flex-direction: column-reverse;
    gap: var(--space-2);
    padding: var(--space-4) var(--space-6) var(--space-6);
    border-top: var(--border-width) var(--border-style) var(--color-border-subtle);
    background: var(--color-surface-secondary);
    border-radius: 0 0 var(--radius-modal) var(--radius-modal);
    margin-top: auto;
  }

  /* A drawer's footer is ruled off like its panel edge. */
  .dialog-footer[data-layout='drawer'],
  .dialog-footer[data-layout='floating'] {
    border-top-color: var(--color-border);
  }

  /* On glass the footer is part of the panel, not a tray. */
  .dialog-footer[data-layout='floating'] {
    padding: var(--space-3) var(--space-5);
    background: transparent;
  }

  .dialog-footer[data-align='between'] {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  @media (--breakpoint-sm) {
    .dialog-footer {
      flex-direction: row;
      justify-content: flex-end;
    }
  }

  /* Clear of the home indicator on a phone. */
  @media (--below-sm) {
    .dialog-footer[data-layout='floating'] {
      padding-inline: var(--space-4);
      padding-block-end: max(var(--space-3), env(safe-area-inset-bottom, 0));
    }
  }

  /* Flush: a bare box; the row inside draws its own rule and tray. Last, so
     it wins over every layout and align rule above. */
  .dialog-footer[data-flush] {
    display: block;
    padding: 0;
    border-top: none;
    background: none;
    border-radius: 0;
  }
</style>
