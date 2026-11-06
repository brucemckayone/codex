<!-- Stands in for ContentForm: says it is mounted, and on which read. -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { mounts } from './probe-log';

  const { content }: { content: { title: string } } = $props();
  mounts.push(`form:${untrack(() => content.title)}`);
</script>

<div data-probe="form">{content.title}</div>
