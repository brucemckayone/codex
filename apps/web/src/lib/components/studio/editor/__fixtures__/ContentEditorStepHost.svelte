<!-- Holds the editor at a step a test moves, as a route's props move before its visit turns over. -->
<script lang="ts">
  import type { ContentWithRelations } from '$lib/types';
  import ContentEditor from '../ContentEditor.svelte';

  const { content }: { content: ContentWithRelations } = $props();
  let step = $state<'write' | 'publish'>('write');
</script>

<button type="button" data-next-step onclick={() => (step = 'publish')}>Next step</button>
<ContentEditor {content} contentType="video" organizationId="org-1" authorName="Studio Alpha" {step} />
