<!--
  @component NewContentPage

  Page wrapper for creating new content. Passes organizationId
  and available media items to the ContentForm component.
-->
<script lang="ts">
  import type { PageData } from './$types';
  import ContentForm from '$lib/components/studio/ContentForm.svelte';

  let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>New Content | Studio</title>
</svelte:head>

<ContentForm organizationId={data.organizationId} orgSlug={data.orgSlug} mediaItems={data.mediaItems} />
