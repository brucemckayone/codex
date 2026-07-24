<!--
  @component JourneySalesPage

  Public journey sales page (SPEC §8.2). The awaited `coursePage` drives the SEO
  head + JSON-LD (rendered synchronously — never gated on streamed data), and
  `JourneyRenderer` renders the page's sections with per-page brand overrides.
  The streamed `sellPreview` promise is threaded straight through to the renderer
  where the intro/reel sections `{#await}` it behind poster skeletons.
-->
<script lang="ts">
  import { extractPlainText } from '@codex/validation';
  import { StructuredData } from '$lib/components/seo';
  import { JourneyRenderer } from '$lib/page-builder/render';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const course = $derived(data.coursePage.course);

  const description = $derived(
    course.lede
      ? extractPlainText(course.lede)
      : `${course.title} — a guided course.`
  );

  // Course/Product JSON-LD for rich results. Price (when sold standalone) is
  // GBP, in major units per schema.org convention.
  const structuredData = $derived({
    '@context': 'https://schema.org',
    '@type': 'Course',
    name: course.title,
    description,
    ...(course.priceCents !== null
      ? {
          offers: {
            '@type': 'Offer',
            price: (course.priceCents / 100).toFixed(2),
            priceCurrency: 'GBP',
          },
        }
      : {}),
  });
</script>

<svelte:head>
  <title>{course.title}</title>
  <meta name="description" content={description} />
  <meta property="og:title" content={course.title} />
  <meta property="og:description" content={description} />
  <meta property="og:type" content="website" />
</svelte:head>

<StructuredData data={structuredData} />

<JourneyRenderer coursePage={data.coursePage} sellPreview={data.sellPreview} />
