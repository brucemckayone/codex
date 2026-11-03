<!--
  @component NewContentPage

  Page wrapper for creating new content. Passes organizationId to the
  ContentForm, and the media a piece starts with from "Create content from
  this" (`?media=&type=`). The media picker reads the library itself, on open
  (Codex-a6ofh.1.8), so nothing here waits for it.
-->
<script lang="ts">
  import { page } from '$app/state';
  import { Breadcrumb } from '$lib/components/ui/Breadcrumb';
  import ContentForm from '$lib/components/studio/ContentForm.svelte';
  import { readNewContentMedia } from '$lib/components/studio/media-library/library-url';

  let { data } = $props();

  const organizationId = $derived(data.org?.id);
  const orgSlug = $derived(data.org?.slug);

  const breadcrumbs = [
    { label: 'Content', href: '/studio/content' },
    { label: 'New Content' },
  ];

  const initialMedia = $derived(readNewContentMedia(page.url));
</script>

<svelte:head>
  <title>New Content | Studio</title>
</svelte:head>

<div class="new-content-page">
  <Breadcrumb items={breadcrumbs} />
  <ContentForm {organizationId} {orgSlug} {initialMedia} />
</div>

<style>
  .new-content-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
</style>
