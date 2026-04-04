<!--
  @component NewContentPage

  Page wrapper for creating new content. Passes organizationId
  and available media items to the ContentForm component.
-->
<script lang="ts">
  import type { PageData } from './$types';
  import { Breadcrumb } from '$lib/components/ui/Breadcrumb';
  import ContentForm from '$lib/components/studio/ContentForm.svelte';

  let { data }: { data: PageData } = $props();

  const breadcrumbs = [
    { label: 'Content', href: '/studio/content' },
    { label: 'New Content' },
  ];
</script>

<svelte:head>
  <title>New Content | Studio</title>
</svelte:head>

<div class="new-content-page">
  <Breadcrumb items={breadcrumbs} />
  <ContentForm organizationId={data.organizationId} orgSlug={data.orgSlug} mediaItems={data.mediaItems} />
</div>

<style>
  .new-content-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
</style>
