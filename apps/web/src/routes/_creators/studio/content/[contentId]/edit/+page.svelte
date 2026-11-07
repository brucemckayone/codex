<!--
  @component Creator Studio Content Edit Page

  A draft opens in the shared content editor: Write (Codex-a6ofh.2.3), or
  Publish at `?step=publish` (Codex-a6ofh.2.4). A piece that has been live
  opens its Page and Settings tabs, its changes waiting for Update
  (Codex-a6ofh.2.5). A type the editor does not know keeps the old form.
-->
<script lang="ts">
  import { page } from '$app/state';
  import type { PageData } from './$types';
  import * as m from '$paraglide/messages';
  import { ErrorBoundary } from '$lib/components/ui';
  import ContentForm from '$lib/components/studio/ContentForm.svelte';
  import ContentEditor from '$lib/components/studio/editor/ContentEditor.svelte';
  import { editorView } from '$lib/components/studio/editor/editor-url';

  let { data }: { data: PageData } = $props();

  // The load runs again on each change of step (it reads `?step`), so each
  // step starts from the piece as the other left it.
  const view = $derived(editorView(data.content, page.url));
</script>

<svelte:head>
  <title>{m.studio_content_form_edit_title()} - {data.content.title} | My Studio</title>
  <meta name="robots" content="noindex" />
</svelte:head>

{#if view}
  <ContentEditor
    content={data.content}
    step={view.step}
    liveTab={view.liveTab}
    contentType={view.contentType}
    organizationId={data.organizationId}
    orgSlug={data.orgSlug}
    creatorUsername={data.creator?.username}
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
