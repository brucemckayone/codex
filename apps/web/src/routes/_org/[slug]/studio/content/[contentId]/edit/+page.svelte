<!--
  @component Studio Content Edit Page

  Renders the content form in edit mode with existing content data.
  Content, organization ID, and slug are passed from server load and URL params.
-->
<script lang="ts">
  import type { PageData } from './$types';
  import * as m from '$paraglide/messages';
  import { page } from '$app/state';
  import { ErrorBoundary } from '$lib/components/ui';
  import { Breadcrumb } from '$lib/components/ui/Breadcrumb';
  import ContentForm from '$lib/components/studio/ContentForm.svelte';

  let { data }: { data: PageData } = $props();

  const orgSlug = $derived(page.params.slug);

  const breadcrumbs = $derived([
    { label: 'Content', href: '/studio/content' },
    { label: data.content.title },
  ]);
</script>

<svelte:head>
  <title>{m.studio_content_form_edit_title()} - {data.content.title} | {orgSlug}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="edit-page">
  <Breadcrumb items={breadcrumbs} />

  <ErrorBoundary>
    <ContentForm
      content={data.content}
      organizationId={data.organizationId}
      orgSlug={data.orgSlug}
      mediaItems={data.mediaItems}
    />
  </ErrorBoundary>
</div>

<style>
  .edit-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
</style>
