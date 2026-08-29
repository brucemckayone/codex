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
  import { page } from '$app/state';
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

  // The page's own SEO bag (the builder's SEO panel writes it) takes precedence
  // over the derived defaults. `||` rather than `??` deliberately: a creator who
  // BLANKS the field leaves an empty string behind, and an empty <title> /
  // description is worse than the derived one.
  const seo = $derived(data.coursePage.page.seo);
  const metaTitle = $derived(seo?.title || course.title);

  const description = $derived(
    seo?.description ||
      (course.lede
        ? extractPlainText(course.lede)
        : `${course.title} — a guided course.`)
  );

  // Canonical identity of this page — origin + pathname, deliberately WITHOUT
  // the query string. The builder's View-live link opens `?preview=1` and the
  // load treats ANY `?preview` value as a bypass (`+page.server.ts:175`), so the
  // URL a creator copies out of that tab addresses the same page under a second
  // address. Canonical consolidates it; `robots` below is the hard signal.
  const canonicalUrl = $derived(`${page.url.origin}${page.url.pathname}`);

  // NEVER INDEXED: a draft (manager-only) or ANY preview URL. The `.has()` test
  // mirrors the load's bypass exactly — `?preview=0` bypasses the redirect, so it
  // must also earn the noindex, or the two would disagree about what a preview is.
  const noIndex = $derived(
    draftPreview || page.url.searchParams.has('preview')
  );

  // The share image. `courses.coverImageKey` resolved to a public CDN URL by the
  // service (`resolveCourseCoverUrl`) and carried on the AWAITED envelope — the
  // hero's `heroImageUrl` could not be used here because it arrives on the
  // STREAMED `sellPreview` promise, which the head has structurally already
  // flushed past. Null → a text-only share card, same as today.
  const shareImageUrl = $derived(course.coverImageUrl ?? null);

  // Course/Product JSON-LD for rich results. Price (when sold standalone) is
  // GBP, in major units per schema.org convention.
  //
  // `name` stays the COURSE's title, NOT `metaTitle`, and that split is
  // deliberate: schema.org `name` is the identity of the thing being described,
  // while a meta title is copy written for a search result ("… · a 6-week
  // descent"). The description follows the head, because there both mean the
  // same thing.
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
  <title>{draftPreview ? `Draft · ${metaTitle}` : metaTitle}</title>
  <link rel="canonical" href={canonicalUrl} />
  <meta name="description" content={description} />
  <meta property="og:title" content={metaTitle} />
  <meta property="og:description" content={description} />
  <!--
    `product`, not `website` — this is a page that sells one thing, and the
    price meta below only makes sense under that vertical. Duplicating the root
    layout's `og:type="website"` (`routes/+layout.svelte:154`) is the house
    pattern: `ContentDetailView` overrides it the same way with
    article/video.other/music.song. `og:site_name` is deliberately NOT re-stated
    here — the root layout owns it, and ContentDetailView relies on that too.
  -->
  <meta property="og:type" content="product" />
  <meta property="og:url" content={canonicalUrl} />
  {#if shareImageUrl}
    <meta property="og:image" content={shareImageUrl} />
  {/if}
  {#if course.priceCents !== null}
    <!-- GBP, in major units — the same convention the JSON-LD Offer above uses. -->
    <meta
      property="product:price:amount"
      content={(course.priceCents / 100).toFixed(2)}
    />
    <meta property="product:price:currency" content="GBP" />
  {/if}
  <meta
    name="twitter:card"
    content={shareImageUrl ? 'summary_large_image' : 'summary'}
  />
  <meta name="twitter:title" content={metaTitle} />
  <meta name="twitter:description" content={description} />
  <!--
    A draft is manager-only, and a `?preview` URL is a second address for the
    canonical page that the builder itself hands the creator (View live opens
    `?preview=1`) — neither may be indexed or ranked as a duplicate.
  -->
  {#if noIndex}
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
  offer={data.offer}
/>
