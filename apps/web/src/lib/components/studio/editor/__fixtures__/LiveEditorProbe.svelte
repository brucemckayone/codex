<!-- Stands in for LiveEditor: says it is mounted, on which piece, at which tab. -->
<script lang="ts">
  const { content, tab }: { content: { id: string }; tab: string } = $props();
</script>

<div data-probe="live-editor" data-tab={tab}>{content.id}</div>
