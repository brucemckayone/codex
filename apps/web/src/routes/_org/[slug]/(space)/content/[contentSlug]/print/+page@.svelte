<!--
  An org's leaving article, printed (Codex-a6ofh.6.5). `@` resets to the root
  layout: no org header, menus or footer on the page or the paper.
-->
<script lang="ts">
  import ArticlePrintView from '$lib/components/content/ArticlePrintView.svelte';
  import type { PageData } from './$types';

  const { data }: { data: PageData } = $props();
</script>

<ArticlePrintView
  title={data.title}
  creatorName={data.creatorName}
  html={data.bodyHtml}
  bodyUnavailable={data.bodyUnavailable}
/>
