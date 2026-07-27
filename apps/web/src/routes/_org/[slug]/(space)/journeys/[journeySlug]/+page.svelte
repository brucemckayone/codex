<!--
  @component JourneySalesPage

  Public journey sales page (SPEC §8.2). The awaited `coursePage` drives the SEO
  head + JSON-LD (rendered synchronously — never gated on streamed data), and
  `JourneyRenderer` renders the page's sections with per-page brand overrides.
  The streamed `sellPreview` promise is threaded straight through to the renderer
  where the intro/reel sections `{#await}` it behind poster skeletons.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { extractPlainText } from '@codex/validation';
  import DraftPreviewBanner from '$lib/components/journeys/DraftPreviewBanner.svelte';
  import { StructuredData } from '$lib/components/seo';
  import { pageBuilder } from '$lib/page-builder/page-builder-store.svelte';
  import { initPagePreviewBridge } from '$lib/page-builder/page-preview-bridge';
  import { JourneyRenderer } from '$lib/page-builder/render';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // Live-preview receiver (Codex-isr02 P0b-2). INERT for real visitors — the
  // bridge attaches no listener unless this page is embedded in the studio
  // builder iframe (window.parent !== window). When embedded, builder edits
  // arrive as `codex:page-preview:v1` messages → pageBuilder.applyPreviewState.
  onMount(() => initPagePreviewBridge());

  // The envelope the renderer draws. Standalone → the SSR `coursePage` as-is.
  // Embedded + a preview message has landed (`pageBuilder.isOpen`) → overlay the
  // builder's live pending sections + brand overrides so edits re-render live.
  const renderCoursePage = $derived(
    pageBuilder.isOpen
      ? {
          ...data.coursePage,
          page: {
            ...data.coursePage.page,
            sections: pageBuilder.sections,
            brandOverrides:
              pageBuilder.pending?.brandOverrides ??
              data.coursePage.page.brandOverrides,
          },
        }
      : data.coursePage
  );

  const course = $derived(data.coursePage.course);

  // Served by the management-gated draft read, not the published one — the ONLY
  // difference between a preview and the live page, and previously invisible
  // (Codex-xzwl5). Only a manager can ever get here (a non-manager 404s), so the
  // builder deep-link is safe to offer.
  const draftPreview = $derived(data.draftPreview === true);
  const builderHref = $derived(
    `/studio/journeys/${data.coursePage.page.id}/page`
  );

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
  <title>{draftPreview ? `Draft · ${course.title}` : course.title}</title>
  <meta name="description" content={description} />
  <meta property="og:title" content={course.title} />
  <meta property="og:description" content={description} />
  <meta property="og:type" content="website" />
  <!-- A draft is manager-only; it must never be indexed or shared as if live. -->
  {#if draftPreview}
    <meta name="robots" content="noindex, nofollow" />
  {/if}
</svelte:head>

{#if draftPreview}
  <DraftPreviewBanner status={data.coursePage.page.status} {builderHref} />
{/if}

<StructuredData data={structuredData} />

<JourneyRenderer
  coursePage={renderCoursePage}
  sellPreview={data.sellPreview}
  enrolled={data.enrolled}
/>
