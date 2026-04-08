<!--
  @component Creator Studio Content Edit Page

  Renders the content form in edit mode with existing content data.
-->
<script lang="ts">
  import type { PageData } from './$types';
  import * as m from '$paraglide/messages';
  import { ErrorBoundary } from '$lib/components/ui';
  import ContentForm from '$lib/components/studio/ContentForm.svelte';

  let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>{m.studio_content_form_edit_title()} - {data.content.title} | My Studio</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<ErrorBoundary>
  <ContentForm
    content={data.content}
    organizationId={data.organizationId}
    orgSlug={data.orgSlug}
    creatorUsername={data.creator?.username}
    mediaItems={data.mediaItems}
  />
</ErrorBoundary>
