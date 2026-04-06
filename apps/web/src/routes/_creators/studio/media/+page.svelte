<script lang="ts">
  import StudioMediaPage from '$lib/components/studio/StudioMediaPage.svelte';

  let { data } = $props();
</script>

<StudioMediaPage {data} studioName="My Studio" />
