<!--
  @component Creator Studio Content Edit Page

  A draft opens in the shared content editor's Write step (Codex-a6ofh.2.3).
  Step 2 (`?step=publish`) is today's form until the Publish step replaces it
  (Codex-a6ofh.2.4), and so is a piece that has been live, whose changes wait
  for Update (Codex-a6ofh.2.5).
-->
<script lang="ts">
  import { page } from '$app/state';
  import type { PageData } from './$types';
  import * as m from '$paraglide/messages';
  import { ErrorBoundary } from '$lib/components/ui';
  import ContentForm from '$lib/components/studio/ContentForm.svelte';
  import ContentEditor from '$lib/components/studio/editor/ContentEditor.svelte';
  import { writingType } from '$lib/components/studio/editor/editor-url';

  let { data }: { data: PageData } = $props();

  // The load runs again on each change of step (it reads `?step`), so step
  // 2's form seeds itself from the piece as the Write step left it.
  const writeType = $derived(writingType(data.content, page.url));
</script>

<svelte:head>
  <title>{m.studio_content_form_edit_title()} - {data.content.title} | My Studio</title>
  <meta name="robots" content="noindex" />
</svelte:head>

{#if writeType}
  <ContentEditor
    content={data.content}
    contentType={writeType}
    organizationId={data.organizationId}
    authorName={data.content.creator?.name ?? data.creator?.name ?? data.studioUser.name}
  />
{:else}
  <ErrorBoundary>
    <ContentForm
      content={data.content}
      organizationId={data.organizationId}
      orgSlug={data.orgSlug}
      creatorUsername={data.creator?.username}
    />
  </ErrorBoundary>
{/if}
