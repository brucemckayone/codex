<!-- Stands in for PublishStep: says it is mounted, and on which piece. -->
<script lang="ts">
  const { content }: { content: { id: string } } = $props();
</script>

<div data-probe="publish-step">{content.id}</div>
