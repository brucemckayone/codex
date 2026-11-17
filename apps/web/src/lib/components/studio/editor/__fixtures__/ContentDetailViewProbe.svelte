<!-- Stands in for ContentDetailView in the studio preview: shows what it was handed, and plays the player handed in. -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  const {
    content,
    contentBodyHtml = null,
    hasAccess,
    streamingUrl = null,
    preview = false,
    player,
    creatorName,
    titleSuffix,
  }: {
    content: { id: string; title: string };
    contentBodyHtml?: string | null;
    hasAccess: boolean;
    streamingUrl?: string | null;
    preview?: boolean;
    player?: Snippet;
    creatorName: string;
    titleSuffix: string;
  } = $props();
</script>

<div
  data-probe="visitor-page"
  data-title={content.title}
  data-access={String(hasAccess)}
  data-stream={streamingUrl ?? ''}
  data-preview={String(preview)}
  data-has-player={String(player !== undefined)}
  data-creator={creatorName}
  data-suffix={titleSuffix}
>
  {#if player}{@render player()}{/if}
  <div data-probe="body">{contentBodyHtml ?? ''}</div>
</div>
