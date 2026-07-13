<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import StudioMediaPage from '$lib/components/studio/StudioMediaPage.svelte';

  let { data } = $props();
</script>

<!--
  This route DOES have a +page.server.ts load, so invalidateAll() re-runs it and
  refreshes data.mediaItems. (The org studio media route has no server load and
  passes mediaQuery.refresh() instead.)
-->
<StudioMediaPage
  {data}
  studioName="My Studio"
  onRefresh={() => invalidateAll()}
/>
