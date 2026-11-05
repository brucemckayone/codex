<!--
  @component Dialog.Form

  The `<form>` for a dialog whose Body and Footer submit together:
  Dialog.Content > Dialog.Header, Dialog.Form > (Dialog.Toolbar optional,
  Dialog.Body, Dialog.Footer).

  Dialog.Content is a flex column capped at 85vh with `overflow: hidden`, and
  only Dialog.Body scrolls. Any element between the two must pass the column
  down (`flex: 1; min-height: 0`), or the panel clips the footer on a short
  screen. This is that element, so a page never hand-writes the wrapper. In a
  drawer (`variant="drawer"`) the whole panel scrolls instead, and Form, like
  Body, adds no box of its own.

  Submit semantics are the browser's: a handler that calls
  `e.preventDefault()` keeps doing so. Every attribute (`onsubmit`,
  `novalidate`, `id`, `class`, …) passes through to the `<form>`.
-->
<script lang="ts">
  import { getContext, type Snippet } from 'svelte';
  import type { HTMLFormAttributes } from 'svelte/elements';

  interface Props extends HTMLFormAttributes {
    children: Snippet;
  }

  const { children, class: className, ...restProps }: Props = $props();
  // Set by Dialog.Content; absent when Form is mounted on its own.
  const variant = getContext<{ current: 'dialog' | 'drawer' } | undefined>('DIALOG_VARIANT');
</script>

<form class="dialog-form {className ?? ''}" data-variant={variant?.current} {...restProps}>
  {@render children()}
</form>

<style>
  .dialog-form {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .dialog-form[data-variant='drawer'] {
    display: contents;
  }
</style>
