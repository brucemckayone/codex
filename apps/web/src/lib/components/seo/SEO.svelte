<!--
  @component SEO

  Renders essential SEO meta tags in svelte:head. Handles title, description,
  Open Graph, canonical URL, and robots directives.

  @prop {string} [title] - Page title
  @prop {string} [description] - Meta description
  @prop {string} [ogImage] - Open Graph image URL
  @prop {string} [ogType='website'] - Open Graph type
  @prop {string} [canonical] - Canonical URL
  @prop {boolean} [noindex=false] - Prevent indexing
  @prop {string} [siteName='Revelations'] - Site name for og:site_name

  @example
  <SEO title="My Page" description="Page description" />
-->
<script lang="ts">
  interface Props {
    title?: string;
    description?: string;
    ogImage?: string;
    ogType?: string;
    canonical?: string;
    noindex?: boolean;
    siteName?: string;
  }

  const {
    title,
    description,
    ogImage,
    ogType = 'website',
    canonical,
    noindex = false,
    siteName = 'Revelations',
  }: Props = $props();

  const fullTitle = $derived(
    title ? `${title} | ${siteName}` : siteName
  );
</script>

<svelte:head>
  <title>{fullTitle}</title>

  {#if description}
    <meta name="description" content={description} />
  {/if}

  {#if noindex}
    <meta name="robots" content="noindex, nofollow" />
  {/if}

  <!-- Open Graph -->
  <meta property="og:title" content={title ?? siteName} />
  {#if description}
    <meta property="og:description" content={description} />
  {/if}
  <meta property="og:type" content={ogType} />
  <meta property="og:site_name" content={siteName} />
  {#if ogImage}
    <meta property="og:image" content={ogImage} />
  {/if}

  <!-- Canonical -->
  {#if canonical}
    <link rel="canonical" href={canonical} />
  {/if}
</svelte:head>
