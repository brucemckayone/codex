<script lang="ts">
  import StudioMediaLibrary from '$lib/components/studio/media-library/StudioMediaLibrary.svelte';

  let { data } = $props();
</script>

<!-- Media is personal (decision 1A): the library lists the creator's own
     uploads in every studio, so the org gives it only its name. -->
<StudioMediaLibrary studioName={data.org.name} />
