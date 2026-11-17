<!-- Stands in for ContentEditor: says it is mounted, and for which type and step. -->
<script lang="ts">
  const { contentType, step }: { contentType: string; step: string } = $props();
</script>

<div data-probe="editor">{contentType}:{step}</div>
