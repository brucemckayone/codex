<!-- Stands in for ContentEditor: says it is mounted, and on which read. -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { mounts } from './probe-log';

  const { content }: { content: { title: string } } = $props();
  mounts.push(`editor:${untrack(() => content.title)}`);
</script>

<div data-probe="editor">{content.title}</div>
