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
  import ContentForm from '$lib/components/studio/ContentForm.svelte';

  let { data }: { data: PageData } = $props();

  const orgSlug = $derived(page.params.slug);
</script>

<svelte:head>
  <title>{m.studio_content_form_edit_title()} - {data.content.title} | {orgSlug}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<ErrorBoundary>
  <ContentForm
    content={data.content}
    organizationId={data.organizationId}
    orgSlug={data.orgSlug}
  />
</ErrorBoundary>
