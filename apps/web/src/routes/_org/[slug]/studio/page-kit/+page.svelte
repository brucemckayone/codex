<!--
  @component PageKitPreview (dev route)

  The whole page kit on one page: every section type in the Style's order,
  rendered through the real `PageRenderer` with sample content, a sample
  offer in any state and one of four sample brands applied as PAGE brand
  overrides (the production mechanism). Every control is also a query
  parameter, so a screenshot is reproducible from its URL:

    ?style=bold|clean|soft|cinematic   ?brand=0..3|org   ?theme=light|dark
    ?offer=buy|sub|tiers|enrolled|unavailable|unknown    ?media=off
    ?only=<type>&layout=<id>&scheme=<id>&spacing=<id>    ?img=1..6
    ?edit=1 (inline-edit attributes on)   ?chrome=0 (hide the studio chrome)
-->
<script lang="ts">
  import { dev } from '$app/environment';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { BrandTokenOverrides } from '$lib/page-builder';
  import {
    COLOUR_SCHEME_IDS,
    isColourSchemeId,
    isLayoutOf,
    isPageStyleId,
    isSectionSpacingId,
    isSectionTypeId,
    type KitPage,
    PAGE_STYLE_IDS,
    PageRenderer,
    SAMPLE_OFFER_STATES,
    type SampleOfferState,
    SECTION_LAYOUTS,
    SECTION_SPACING_IDS,
    SECTION_TYPE_IDS,
    sampleContext,
    samplePage,
  } from '$lib/page-builder/kit';

  /** The local dev-cdn (`workers/dev-cdn`) that serves the seeded sample
   *  images; there is no deployed copy, so production shows the kit's
   *  designed empty media instead. */
  const LOCAL_CDN = 'http://localhost:4100';

  const BRANDS: readonly { id: string; label: string; overrides: BrandTokenOverrides | null }[] = [
    {
      id: '0',
      label: 'Vermilion, Archivo Black',
      overrides: {
        primaryColor: '#E4572E',
        secondaryColor: '#1D4E89',
        fontHeading: 'Archivo Black',
        fontBody: 'DM Sans',
      },
    },
    {
      id: '1',
      label: 'Pale apricot, Playfair',
      overrides: {
        primaryColor: '#F7D9B9',
        backgroundColor: '#FBF7F1',
        fontHeading: 'Playfair Display',
        fontBody: 'Source Sans 3',
      },
    },
    {
      id: '2',
      label: 'Ink navy, Space Grotesk',
      overrides: {
        primaryColor: '#1B2A41',
        secondaryColor: '#C9A227',
        fontHeading: 'Space Grotesk',
        fontBody: 'Inter',
      },
    },
    {
      id: '3',
      label: 'Teal, Syne',
      overrides: {
        primaryColor: '#0D9488',
        secondaryColor: '#F59E0B',
        fontHeading: 'Syne',
        fontBody: 'Manrope',
      },
    },
    { id: 'org', label: 'Organisation brand', overrides: null },
  ];

  const params = $derived(page.url.searchParams);
  const param = (key: string) => params.get(key) ?? '';

  const style = $derived.by(() => {
    const value = param('style');
    return isPageStyleId(value) ? value : 'bold';
  });
  const brand = $derived(BRANDS.find((b) => b.id === param('brand')) ?? BRANDS[0]);
  const theme = $derived(param('theme') === 'dark' ? 'dark' : 'light');
  const offer = $derived(
    (SAMPLE_OFFER_STATES as readonly string[]).includes(param('offer'))
      ? (param('offer') as SampleOfferState)
      : 'buy'
  );
  const only = $derived.by(() => {
    const value = param('only');
    return isSectionTypeId(value) ? value : null;
  });
  const image = $derived(`${LOCAL_CDN}/page-kit/img${/^[1-6]$/.test(param('img')) ? param('img') : '3'}.jpg`);
  const withMedia = $derived(dev && param('media') !== 'off');
  const editing = $derived(param('edit') === '1');
  const chrome = $derived(param('chrome') !== '0');

  const kitPage: KitPage = $derived.by(() => {
    const sample = only ? samplePage(style, [only]) : samplePage(style);
    if (!only) return sample;
    const layout = param('layout');
    const scheme = param('scheme');
    const spacing = param('spacing');
    return {
      ...sample,
      sections: sample.sections.map((section) => ({
        ...section,
        variant: isLayoutOf(section.type, layout) ? layout : undefined,
        design: {
          scheme: isColourSchemeId(scheme) ? scheme : undefined,
          spacing: isSectionSpacingId(spacing) ? spacing : undefined,
        },
      })),
    };
  });

  const context = $derived(
    sampleContext({
      offer,
      media: withMedia ? { heroImageUrl: image, guidePortraitUrl: image } : {},
      // Reuses the SAME dev-cdn base as the hero/portrait stills above, so a
      // page-image block (`resolvePageImageUrl`) previews here too instead of
      // rendering its designed empty state on every gallery load.
      mediaBaseUrl: LOCAL_CDN,
    })
  );

  // `?edit=1` turns the inline-edit attributes on so they can be checked by
  // eye; the gallery has no page to write to, so a commit goes nowhere.
  const edit = $derived(editing ? { commit: () => {} } : null);

  function set(key: string, value: string) {
    const url = new URL(page.url);
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
    if (key === 'only') url.searchParams.delete('layout');
    void goto(url, { replaceState: true, noScroll: true, keepFocus: true });
  }
</script>

<svelte:head>
  <title>Page kit preview</title>
</svelte:head>

<div class="kit-preview" data-studio-fullbleed data-chrome={chrome ? undefined : 'off'}>
  {#if chrome}
    <form class="kit-preview__bar" aria-label="Preview controls">
      <label>
        Style
        <select value={style} onchange={(e) => set('style', e.currentTarget.value)}>
          {#each PAGE_STYLE_IDS as id (id)}<option value={id}>{id}</option>{/each}
        </select>
      </label>
      <label>
        Brand
        <select value={brand.id} onchange={(e) => set('brand', e.currentTarget.value)}>
          {#each BRANDS as b (b.id)}<option value={b.id}>{b.label}</option>{/each}
        </select>
      </label>
      <label>
        Theme
        <select value={theme} onchange={(e) => set('theme', e.currentTarget.value)}>
          <option value="light">light</option>
          <option value="dark">dark</option>
        </select>
      </label>
      <label>
        Offer
        <select value={offer} onchange={(e) => set('offer', e.currentTarget.value)}>
          {#each SAMPLE_OFFER_STATES as id (id)}<option value={id}>{id}</option>{/each}
        </select>
      </label>
      <label>
        Section
        <select value={only ?? ''} onchange={(e) => set('only', e.currentTarget.value)}>
          <option value="">All sections</option>
          {#each SECTION_TYPE_IDS as id (id)}<option value={id}>{id}</option>{/each}
        </select>
      </label>
      {#if only}
        <label>
          Layout
          <select value={param('layout')} onchange={(e) => set('layout', e.currentTarget.value)}>
            <option value="">Style default</option>
            {#each SECTION_LAYOUTS[only] as id (id)}<option value={id}>{id}</option>{/each}
          </select>
        </label>
        <label>
          Colour
          <select value={param('scheme')} onchange={(e) => set('scheme', e.currentTarget.value)}>
            <option value="">Style default</option>
            {#each COLOUR_SCHEME_IDS as id (id)}<option value={id}>{id}</option>{/each}
          </select>
        </label>
        <label>
          Spacing
          <select value={param('spacing')} onchange={(e) => set('spacing', e.currentTarget.value)}>
            <option value="">regular</option>
            {#each SECTION_SPACING_IDS as id (id)}<option value={id}>{id}</option>{/each}
          </select>
        </label>
      {/if}
    </form>
  {/if}

  <PageRenderer
    page={kitPage}
    {context}
    brandOverrides={brand.overrides}
    {theme}
    {edit}
  />
</div>

<style>
  .kit-preview {
    /* The studio has no mobile bottom nav for the floating bar to clear.
       A length, not `--space-0` (a unitless 0 is invalid inside `calc()` sums). */
    --lp-nav-clearance: 0px;
    min-block-size: 100vh;
  }

  /* Screenshot mode: the page at the full window width, as a visitor sees it. */
  :global(.studio-layout:has(> .studio-layout__main > .kit-preview[data-chrome='off'])) {
    grid-template-columns: 1fr;
    grid-template-rows: 1fr;
  }

  :global(
      .studio-layout:has(> .studio-layout__main > .kit-preview[data-chrome='off'])
        > :is(.studio-layout__rail, .studio-topbar)
    ) {
    display: none;
  }

  :global(.studio-layout:has(> .studio-layout__main > .kit-preview[data-chrome='off'])) > :global(.studio-layout__main) {
    grid-column: 1;
    grid-row: 1;
  }

  .kit-preview__bar {
    position: sticky;
    top: 0;
    z-index: var(--z-sticky);
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
    padding: var(--space-2) var(--space-4);
    background: var(--color-surface);
    border-block-end: var(--border-width) var(--border-style) var(--color-border);
    font-size: var(--text-sm);
  }

  .kit-preview__bar label {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-text-secondary);
  }

  .kit-preview__bar select {
    min-block-size: var(--space-8);
    padding-inline: var(--space-2);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text);
  }

  .kit-preview__bar select:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset);
  }
</style>
