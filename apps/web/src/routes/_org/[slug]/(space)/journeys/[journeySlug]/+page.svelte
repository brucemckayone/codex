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
  import { page } from '$app/state';
  import DraftPreviewBanner from '$lib/components/journeys/DraftPreviewBanner.svelte';
  import { StructuredData } from '$lib/components/seo';
  import {
    checkoutUrlForPath,
    deriveOfferPathsForPage,
    type OfferBillingInterval,
    type OfferPath,
  } from '$lib/page-builder/offer-paths';
  import { pageBuilder } from '$lib/page-builder/page-builder-store.svelte';
  import { initPagePreviewBridge } from '$lib/page-builder/page-preview-bridge';
  import { JourneyRenderer } from '$lib/page-builder/render';
  import { buildJourneyUrl } from '$lib/utils/subdomain';
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
  // over the derived default. `||` rather than `??` deliberately: a creator who
  // BLANKS the field leaves an empty string behind, and an empty <title> is
  // worse than the derived one.
  const seo = $derived(data.coursePage.page.seo);
  const metaTitle = $derived(seo?.title || course.title);

  // ONE derivation site, and it is deliberately not here (O32).
  // `<meta name="description">` is emitted by the ROOT layout from
  // `data.pageMeta` so that this page OVERRIDES it rather than appending a
  // second tag — `+page.server.ts` is where the string is derived, and its
  // comment records the measurement. `og:description` / `twitter:description`
  // are not duplicated by the root, so they stay below and read that same value.
  const description = $derived(data.pageMeta?.description ?? '');

  // Canonical identity of this page — origin + pathname, deliberately WITHOUT
  // the query string. The builder's View-live link opens `?preview=1` and the
  // load treats ANY `?preview` value as a bypass (`+page.server.ts`), so the URL
  // a creator copies out of that tab addresses the same page under a second
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

  // ── PRICE: ONE SOURCE OF TRUTH, AND IT IS THE OFFER ─────────────────────────
  // Everything below used to price itself from `course.priceCents` while the
  // visible sections priced themselves from `context.offer`. Two sources for one
  // number is a structured-data lie the moment they disagree, and they disagree
  // BY DESIGN: `updateJourneyOffer` NULLs `courses.price_cents` when the one-off
  // path is switched off (`course-journey-service.ts`), while `getCourseOffer`
  // composes `price_cents` + `course_subscription_plans` +
  // `course_tier_access ⋈ subscription_tiers`. So a course sold only by
  // subscription or by tier grant published a `Course` with NO `offers` node to a
  // crawler while the invite section showed the reader a real monthly price — the
  // page and its machine-readable twin contradicting each other, with the price
  // lost from the search result entirely.
  //
  // `deriveOfferPathsForPage` is the SAME derivation the invite cards and the
  // checkout radio list run, so the JSON-LD cannot drift from what the visitor is
  // shown. It reads the AWAITED `data.coursePage.page.sections`, never the
  // builder's live `renderCoursePage`: authored copy may only rename a path (it
  // "may DECORATE a real path … and may create NOTHING" — `offer-paths.ts`), so
  // the prices are identical either way, and structured data has no business
  // re-rendering on a keystroke inside a preview iframe that is `noindex` anyway.
  //
  // Note also what is NOT here any more: `course.priceCents !== null`. With
  // `strictNullChecks: false` that test also passes for an ABSENT field, and
  // `(undefined / 100).toFixed(2)` is the literal string "NaN" — which is what an
  // older worker deployment omitting `priceCents` would have published as a price.
  const offerPaths = $derived(
    deriveOfferPathsForPage(
      data.offer,
      course,
      data.coursePage.page.sections ?? []
    )
  );

  // The checkout each path deep-links to — absolute, because JSON-LD is consumed
  // outside page context. Mirrors `JourneyRenderer`'s own `checkoutUrl`: the PAGE
  // slug, which is the key the checkout route resolves by.
  const checkoutUrl = $derived(
    new URL(
      buildJourneyUrl(
        page.url,
        { slug: data.coursePage.page.slug, id: data.coursePage.page.id },
        { surface: 'checkout' }
      ),
      page.url.origin
    ).href
  );

  /** GBP major units — schema.org's price convention, and never USD. */
  function majorUnits(cents: number): string {
    return (cents / 100).toFixed(2);
  }

  /**
   * UN/CEFACT codes for the two cadences a recurring path bills at. They exist
   * so a subscription price is never published as if it were the whole cost of
   * the course: "£27" and "£27 a month" are different claims, and
   * `priceSpecification` is the only place schema.org can carry the difference.
   */
  const CADENCE_UNIT_CODE: Record<OfferBillingInterval, string> = {
    monthly: 'MON',
    annual: 'ANN',
  };

  function toOfferNode(path: OfferPath): Record<string, unknown> {
    const price = majorUnits(path.priceCents);
    return {
      '@type': 'Offer',
      name: path.name,
      price,
      priceCurrency: 'GBP',
      availability: 'https://schema.org/InStock',
      url: checkoutUrlForPath(checkoutUrl, path.id),
      ...(path.recurring
        ? {
            priceSpecification: {
              '@type': 'UnitPriceSpecification',
              price,
              priceCurrency: 'GBP',
              referenceQuantity: {
                '@type': 'QuantitativeValue',
                value: 1,
                unitCode:
                  CADENCE_UNIT_CODE[path.billingInterval ?? 'monthly'] ?? 'MON',
              },
            },
          }
        : {}),
    };
  }

  /**
   * The one-off path, and only the one-off path, backs `product:price:amount`.
   * Open Graph's product price is a single flat amount with nowhere to state a
   * cadence, so putting a monthly figure there would advertise £27 as the cost of
   * the course. No one-off way in ⇒ no price meta, which is also what this page
   * did before for a course whose `price_cents` is NULL.
   */
  const oneOffPath = $derived(offerPaths.find((p) => p.kind === 'purchase'));

  /** The selling organisation, from the org layout's awaited data. */
  const orgName = $derived(data.org?.name ?? null);

  // Course JSON-LD for rich results.
  //
  // `name` stays the COURSE's title, NOT `metaTitle`, and that split is
  // deliberate: schema.org `name` is the identity of the thing being described,
  // while a meta title is copy written for a search result ("… · a 6-week
  // descent"). The description follows the head, because there both mean the
  // same thing.
  //
  // `offers` is an ARRAY of per-path `Offer` nodes rather than one
  // `AggregateOffer` carrying lowPrice/highPrice. An aggregate has no cadence
  // field, so a course sold at £27 a month OR £49 outright would publish
  // "lowPrice: 27.00" as though that were the price of the course — the exact
  // class of claim this block exists to stop. An array is valid for
  // `Course.offers`, keeps every cadence attached to its own price, and still
  // gives a crawler the whole range. Omitted entirely when the course has no
  // available way in, so a withdrawn course never advertises one.
  const structuredData = $derived({
    '@context': 'https://schema.org',
    '@type': 'Course',
    name: course.title,
    description,
    url: canonicalUrl,
    ...(shareImageUrl ? { image: shareImageUrl } : {}),
    ...(orgName
      ? {
          provider: {
            '@type': 'Organization',
            name: orgName,
            url: page.url.origin,
          },
        }
      : {}),
    ...(offerPaths.length > 0
      ? { offers: offerPaths.map((path) => toOfferNode(path)) }
      : {}),
  });
</script>

<svelte:head>
  <title>{draftPreview ? `Draft · ${metaTitle}` : metaTitle}</title>
  <link rel="canonical" href={canonicalUrl} />
  <meta property="og:title" content={metaTitle} />
  <!--
    NO `<meta name="description">` and NO `og:type` here. The ROOT layout emits
    exactly one of each from `data.pageMeta` (O32); re-adding them would restore
    the duplication, and since a parser takes the FIRST value of a repeated Open
    Graph property, it is the root's generic value that would win — which is
    precisely how `og:type="product"` came to be dead on arrival.
    `og:site_name` is likewise the root's, as `ContentDetailView` relies on too.
  -->
  {#if description}
    <meta property="og:description" content={description} />
  {/if}
  <meta property="og:url" content={canonicalUrl} />
  {#if shareImageUrl}
    <meta property="og:image" content={shareImageUrl} />
  {/if}
  {#if oneOffPath}
    <!-- GBP, in major units — the same convention the JSON-LD Offers use. -->
    <meta
      property="product:price:amount"
      content={majorUnits(oneOffPath.priceCents)}
    />
    <meta property="product:price:currency" content="GBP" />
  {/if}
  <meta
    name="twitter:card"
    content={shareImageUrl ? 'summary_large_image' : 'summary'}
  />
  <meta name="twitter:title" content={metaTitle} />
  {#if description}
    <meta name="twitter:description" content={description} />
  {/if}
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
