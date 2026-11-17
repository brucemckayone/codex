<!--
  @component CreatorStudioContentPreviewPage

  The personal studio's preview of a piece as visitors will see it
  (Codex-a6ofh.2.11), a draft too. The shared ContentPreview reads the piece
  itself; the tab reads as a visitor's would, with the creator's name.
-->
<script lang="ts">
  import { page } from '$app/state';
  import ContentPreview from '$lib/components/studio/editor/ContentPreview.svelte';

  let { data } = $props();
</script>

<ContentPreview
  contentId={page.params.contentId}
  titleSuffix={data.creator.name}
  authorName={data.creator.name}
/>
