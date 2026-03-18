<!--
  @component Studio Content Creation Page

  Renders the content form in create mode.
  Organization ID and slug are passed from server load and URL params.
-->
<script lang="ts">
  import type { PageData } from './$types';
  import * as m from '$paraglide/messages';
  import { page } from '$app/stores';
  import { ErrorBoundary } from '$lib/components/ui';
  import ContentForm from '$lib/components/studio/ContentForm.svelte';

  let { data }: { data: PageData } = $props();

  const orgSlug = $derived($page.params.slug);
</script>

<svelte:head>
  <title>{m.studio_content_form_create_title()} | {orgSlug}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<ErrorBoundary>
  <ContentForm
    organizationId={data.organizationId}
    {orgSlug}
  />
</ErrorBoundary>
