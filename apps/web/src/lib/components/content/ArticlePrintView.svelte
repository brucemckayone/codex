<!--
  @component ArticlePrintView

  A leaving article as its owner saves it (Codex-a6ofh.6.5, design D7): a
  clean page with no site header or menus, its title, byline and body, that
  opens the browser's print dialog, where the owner chooses "Save as PDF".
  Nothing new is stored. The org and creator print routes both render it.

  Rendered under the ROOT layout only (a `+page@.svelte` reset), so it reads
  `:root` tokens only, never the org scope's (R12).

  @prop {string} title - The piece's title
  @prop {string} creatorName - The creator's public name, for the byline
  @prop {string | null} html - The body, rendered and sanitised by
    renderContentBody(); null when it did not render
  @prop {boolean} bodyUnavailable - Stored text that did not render: the
    reader is told, and no print dialog opens on a page without it
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import ProseContent from '$lib/components/editor/ProseContent.svelte';
  import { Button } from '$lib/components/ui';
  import * as m from '$paraglide/messages';

  interface Props {
    title: string;
    creatorName: string;
    html: string | null;
    bodyUnavailable: boolean;
  }

  const { title, creatorName, html, bodyUnavailable }: Props = $props();

  function print(): void {
    window.print();
  }

  // The page exists to be printed: open the dialog once it has painted, and
  // only when there is a body to print.
  onMount(() => {
    if (html) print();
  });
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<!-- The landmark the root layout's SkipLink targets: the route-group layouts
     that own it elsewhere do not render here. -->
<main id="main-content" class="print-view">
  <div class="print-view__toolbar">
    <p class="print-view__hint">{m.content_print_hint()}</p>
    {#if html}
      <Button onclick={print}>{m.content_print_save()}</Button>
    {/if}
  </div>

  <header class="print-view__header">
    <h1 class="print-view__title">{title}</h1>
    <p class="print-view__byline">{m.content_print_byline({ name: creatorName })}</p>
  </header>

  {#if html}
    <ProseContent {html} />
  {:else if bodyUnavailable}
    <p class="print-view__unavailable" role="alert">
      {m.content_detail_body_unavailable()}
    </p>
  {/if}
</main>

<style>
  .print-view {
    max-width: var(--container-article);
    margin-inline: auto;
    padding: var(--space-8) var(--space-4) var(--space-16);
    color: var(--color-text);
    background: var(--color-surface);
  }

  .print-view__toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin-block-end: var(--space-8);
    padding: var(--space-3) var(--space-4);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-secondary);
  }

  .print-view__hint {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .print-view__header {
    margin-block-end: var(--space-8);
  }

  .print-view__title {
    margin: 0 0 var(--space-2);
    font-family: var(--font-heading, var(--font-sans));
    font-size: var(--text-3xl);
    font-weight: var(--font-bold);
    line-height: var(--leading-tight);
    letter-spacing: var(--tracking-tight);
    color: var(--color-text);
  }

  .print-view__byline {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .print-view__unavailable {
    color: var(--color-text-secondary);
  }

  /* On paper: the toolbar goes, the page takes the sheet's width and the
     browser's margins, and headings stay with what follows them. */
  @media print {
    .print-view {
      max-width: none;
      padding: 0;
      background: none;
    }

    .print-view__toolbar {
      display: none;
    }

    .print-view__header {
      break-after: avoid;
    }

    .print-view :global(.prose-content) {
      max-width: none;
    }

    .print-view :global(:is(h1, h2, h3, h4)) {
      break-after: avoid;
    }

    .print-view :global(:is(img, figure, pre, blockquote)) {
      break-inside: avoid;
    }
  }
</style>
