<!--
  @component StructuredData

  Renders JSON-LD structured data in svelte:head for search engine rich results.

  @prop {Record<string, unknown>} data - JSON-LD data object

  @example
  <StructuredData data={{
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "My Org",
    url: "https://example.com"
  }} />
-->
<script lang="ts">
  interface Props {
    data: Record<string, unknown>;
  }

  const { data }: Props = $props();

  const jsonLd = $derived(JSON.stringify(data));
</script>

<svelte:head>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
  {@html `<script type="application/ld+json">${jsonLd}</script>`}
</svelte:head>
