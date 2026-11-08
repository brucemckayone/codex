<!-- Stands in for ContentPreview: shows what the route handed it. -->
<script lang="ts">
  const { contentId, titleSuffix, authorName }: { contentId: string; titleSuffix: string; authorName: string } = $props();
</script>

<div data-probe="preview" data-id={contentId} data-suffix={titleSuffix} data-author={authorName}></div>
