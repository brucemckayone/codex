<!--
  @component NewContentPage (Creator Studio)

  Page wrapper for creating new personal content. Passes organizationId=null
  and available media items to the ContentForm component.
-->
<script lang="ts">
  import type { PageData } from './$types';
  import ContentForm from '$lib/components/studio/ContentForm.svelte';

  let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>New Content | My Studio</title>
</svelte:head>

<ContentForm organizationId={data.organizationId} orgSlug={data.orgSlug} mediaItems={data.mediaItems} />
