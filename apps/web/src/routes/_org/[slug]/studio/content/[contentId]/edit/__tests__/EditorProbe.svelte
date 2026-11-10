<!-- Stands in for ContentEditor: says it is mounted, at which step or live tab, and on which read. -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { mounts } from './probe-log';

  const {
    content,
    step = 'write',
    liveTab = null,
  }: { content: { title: string }; step?: 'write' | 'publish'; liveTab?: 'page' | 'settings' | null } = $props();
  const name = untrack(() => (liveTab ? `live-${liveTab}` : step === 'publish' ? 'publish' : 'editor'));
  mounts.push(`${name}:${untrack(() => content.title)}`);
</script>

<div data-probe={name}>{content.title}</div>
