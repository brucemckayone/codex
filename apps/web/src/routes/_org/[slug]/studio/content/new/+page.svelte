<!--
  @component NewContentPage

  A new piece in the org's studio: the shared content editor (Codex-a6ofh.2.3),
  as `?type=` asks, or with the media from "Create content from this"
  (`?media=&type=`). Opening it makes no row: the first save does.
-->
<script lang="ts">
  import { page } from '$app/state';
  import ContentEditor from '$lib/components/studio/editor/ContentEditor.svelte';
  import { TYPE_WORD } from '$lib/components/studio/editor/canvas-text';
  import { readNewContent } from '$lib/components/studio/editor/editor-url';
  import * as m from '$paraglide/messages';

  let { data } = $props();

  const start = $derived(readNewContent(page.url));
</script>

<svelte:head>
  <title>{m.studio_editor_page_title_new({ type: TYPE_WORD[start.contentType]() })} | Studio</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<ContentEditor
  content={null}
  contentType={start.contentType}
  organizationId={data.org.id}
  initialMediaId={start.mediaId}
  authorName={data.studioUser.name}
/>
