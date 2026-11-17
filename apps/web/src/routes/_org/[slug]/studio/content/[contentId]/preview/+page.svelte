<!--
  @component OrgStudioContentPreviewPage

  The org studio's preview of a piece as visitors will see it
  (Codex-a6ofh.2.11), a draft too. The shared ContentPreview reads the piece
  itself, client-side like the edit page.
-->
<script lang="ts">
  import { page } from '$app/state';
  import ContentPreview from '$lib/components/studio/editor/ContentPreview.svelte';

  let { data } = $props();
</script>

<ContentPreview
  contentId={page.params.contentId}
  titleSuffix={data.org.name}
  authorName={data.studioUser.name}
/>
