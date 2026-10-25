<!-- Test harness (Codex-2hxff.28): the /admin layout around a page that reads the counts. -->
<script lang="ts">
  import QueueCountsProbe from '$lib/components/support/__fixtures__/QueueCountsProbe.svelte';
  import AdminLayout from '../+layout.svelte';

  const { onCounts }: { onCounts: (query: unknown) => void } = $props();
</script>

<AdminLayout><QueueCountsProbe {onCounts} /></AdminLayout>
