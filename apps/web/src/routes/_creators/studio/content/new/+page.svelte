<!--
  @component NewContentPage (Creator Studio)

  Page wrapper for creating new personal content. Passes organizationId=null,
  and the media a piece starts with from "Create content from this"
  (`?media=&type=`, Codex-a6ofh.1.8).
-->
<script lang="ts">
  import { page } from '$app/state';
  import ContentForm from '$lib/components/studio/ContentForm.svelte';
  import { readNewContentMedia } from '$lib/components/studio/media-library/library-url';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const initialMedia = $derived(readNewContentMedia(page.url));
</script>

<svelte:head>
  <title>New Content | My Studio</title>
</svelte:head>

<ContentForm
  organizationId={data.organizationId}
  orgSlug={data.orgSlug}
  creatorUsername={data.creator?.username}
  {initialMedia}
/>
