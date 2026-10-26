<script lang="ts">
  import { invalidate } from '$app/navigation';
  import StudioMediaPage from '$lib/components/studio/StudioMediaPage.svelte';

  let { data } = $props();
</script>

<!--
  This route DOES have a +page.server.ts load: invalidating its dependency
  re-runs it alone and refreshes data.mediaItems. invalidateAll() would re-run
  every layout's load too, and the live status channel refreshes on every
  finished upload. (The org studio media route has no server load and passes
  mediaQuery.refresh() instead.)
-->
<StudioMediaPage
  {data}
  studioName="My Studio"
  onRefresh={() => invalidate('app:studio-media')}
/>
