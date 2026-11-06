<!-- Stands in for ContentEditor: says it is mounted, at which step, and on which read. -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { mounts } from './probe-log';

  const { content, step = 'write' }: { content: { title: string }; step?: 'write' | 'publish' } = $props();
  const name = untrack(() => (step === 'publish' ? 'publish' : 'editor'));
  mounts.push(`${name}:${untrack(() => content.title)}`);
</script>

<div data-probe={name}>{content.title}</div>
