<!-- Test probe (Codex-2hxff.28): hands back the counts query a page would use. -->
<script lang="ts">
  import { useQueueCounts } from '../queue-counts';

  const { onCounts }: { onCounts: (query: unknown) => void } = $props();

  // Once, at mount: what a page gets is decided then.
  // svelte-ignore state_referenced_locally
  onCounts(useQueueCounts());
</script>
