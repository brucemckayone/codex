<!--
  @component PageKitPreview (dev route)

  The whole page kit on one page: every section type in the Style's order,
  rendered through the real `PageRenderer` with sample content, a sample
  offer in any state and one of four sample brands applied as PAGE brand
  overrides (the production mechanism). Every control is also a query
  parameter, so a screenshot is reproducible from its URL:

    ?style=<any Style id>   ?brand=0..3|org   ?theme=light|dark
    ?offer=buy|sub|tiers|enrolled|unavailable|unknown    ?media=off
    ?only=<type>&layout=<id>&scheme=<id>&spacing=<id>
      (`only` may list types, `only=hero,transformation`, drawn in that order:
      a layout or colour applies to each listed section it fits; `layout` may
      name one per type instead, `layout=benefits:grid,curriculum:timeline`)
    ?dials=colour:muted|vivid,corners:brand|rounder,spacing:compact|spacious,
      drama:calmer|louder,motion:still|gentle
      (the page's dials, 03 X61, X62; any subset, any order)
    ?type=bold|poster|soft|quiet (another Style's Type, 03 X73: drawn on any
      Style, offered or not, so a pair is proven before the allow-list
      offers it)
    ?img=1..6 (the hero's photo; every picture field takes the next ones)
    ?eyebrow=<text> (the hero's eyebrow, which the sample leaves empty: a
      chip on Soft and Poster, so their tallest hero)
    ?focus=<x>,<y> (every sample picture's focal point, in percent)
    ?set=<type>.<key>:<value>,... (a section control on every section of that
      type, `set=text.imageAt:after,faq.openFirst:true`; each block's own
      reading still applies, so an unknown one draws nothing new)
    ?faces=1 (each testimonials section's first written quote gets a photo,
      so the course's own show their initials)   ?marks=1 (each benefit
      takes the kit's marks in turn)
    ?film=<HLS URL> (every clip, the intro, reel, guide and hero, plays this
      stream, so the players can be pressed here: a real local preview, e.g.
      dev-cdn's `{creatorId}/hls/{mediaId}/preview/preview.m3u8`)
    ?edit=1 (inline-edit attributes on)   ?chrome=0 (hide the studio chrome)
-->
<script lang="ts">
  import { dev } from '$app/environment';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { brandEditor } from '$lib/brand-editor';
  import type { BrandTokenOverrides } from '$lib/page-builder';
  import { orgGrounds, orgShader } from '$lib/page-builder/org-grounds';
  import {
    COLOUR_SCHEME_IDS,
    isColourSchemeId,
    isLayoutOf,
    isPageStyleId,
    isSectionSpacingId,
    isSectionTypeId,
    isTypeFacet,
    type KitPage,
    type KitSection,
    PAGE_STYLE_IDS,
    PageRenderer,
    readPageDials,
    SAMPLE_OFFER_STATES,
    type SampleOfferState,
    SECTION_LAYOUTS,
    SECTION_SPACING_IDS,
    SECTION_TYPE_IDS,
    sampleContext,
    samplePage,
  } from '$lib/page-builder/kit';
  import { MARKS } from '$lib/page-builder/kit/model/marks';
  import { type SamplePicture, withSamplePictures } from '$lib/page-builder/kit/model/sample';

  /** The local dev-cdn (`workers/dev-cdn`) that serves the seeded sample
   *  images; there is no deployed copy, so production shows the kit's
   *  designed empty media instead. */
  const LOCAL_CDN = 'http://localhost:4100';

  /** What each of the dev-cdn's six sample photographs (`page-kit/img1-6.jpg`,
   *  copies of `docs/design/mockup-assets` that `db:seed` writes:
   *  `pageKitSamplePhotos` in packages/database/scripts/seed/r2.ts) shows; half
   *  carry a caption, so a gallery shows both kinds of tile. */
  const PHOTOS: readonly { alt: string; caption?: string }[] = [
    { alt: 'Storm clouds over a dark sea, waves breaking on the shore', caption: 'Weather coming in off the sea' },
    { alt: 'A road through an avenue of trees, fading into fog' },
    { alt: 'Someone in a scarf, seen from behind, looking out to sea at sunset', caption: 'Ten quiet minutes, facing the water' },
    { alt: 'Car lights streaking along a curving road at night' },
    { alt: 'A pine forest in morning mist', caption: 'Mist over the pines, first thing' },
    { alt: 'Shirts on hangers along a rail, under a wall calendar' },
  ];

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
  // The org's own backgrounds, so the kit keeps its real ground (03 X48).
  const grounds = $derived(
    orgGrounds(page.data.org, brandEditor.isOpen ? brandEditor.pending : null)
  );
  // The org's moving background, so the hero takes it (03 X50, X51).
  const shader = $derived(
    orgShader(page.data.org, brandEditor.isOpen ? brandEditor.pending : null)
  );
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
  /** The listed types, in order, or null for the whole page. */
  const only = $derived.by(() => {
    const types = param('only').split(',').filter(isSectionTypeId);
    return types.length > 0 ? types : null;
  });
  /** The section the controls edit: the last one listed. */
  const focus = $derived(only?.at(-1) ?? null);
  /** The hero's photo, 1–6. */
  const photo = $derived(/^[1-6]$/.test(param('img')) ? Number(param('img')) : 3);
  const image = $derived(`${LOCAL_CDN}/page-kit/img${photo}.jpg`);
  const withMedia = $derived(dev && param('media') !== 'off');
  const editing = $derived(param('edit') === '1');
  const chrome = $derived(param('chrome') !== '0');

  /** `?focus=64,36`: the point every sample picture is steered by (Codex-61zsk.58). */
  const point = $derived.by(() => {
    const match = /^(\d{1,3}),(\d{1,3})$/.exec(param('focus'));
    return match ? { x: Number(match[1]), y: Number(match[2]) } : undefined;
  });

  /*
   * Every picture field takes the photos in turn, from the one after the
   * hero's. The files are plain JPEGs, not the size variants a real page
   * image has, so each key ends in `#`: `resolvePageImageUrl` appends
   * `/<size>.webp` after it as a fragment the browser never sends, and every
   * size resolves to the one file.
   */
  const pictures: SamplePicture[] = $derived(
    PHOTOS.map((_, index) => {
      const n = ((photo + index) % PHOTOS.length) + 1;
      const { alt, caption } = PHOTOS[n - 1];
      const image = { key: `page-kit/img${n}.jpg#`, alt, ...(point ? { focus: point } : {}) };
      return { image, ...(caption ? { caption } : {}) };
    })
  );

  /** `?set=text.imageAt:after`: each control, by the type it is set on. */
  const controls = $derived.by(() => {
    const byType = new Map<string, Record<string, unknown>>();
    for (const pair of param('set').split(',')) {
      const match = /^([a-z]+)\.([A-Za-z]+):(.+)$/.exec(pair);
      if (!match) continue;
      const [, type, key, value] = match;
      byType.set(type, { ...byType.get(type), [key]: value === 'true' ? true : value });
    }
    return byType;
  });

  /** `?film=<HLS URL>`: the one stream every clip plays, its poster the hero's photo. */
  const clip = $derived.by(() => {
    const playlistUrl = param('film');
    return playlistUrl ? { playlistUrl, posterUrl: image } : null;
  });

  /** `?faces=1`, `?marks=1`: the items' own controls, drawn on the sample (Codex-61zsk.58). */
  const faces = $derived(param('faces') === '1');
  const marks = $derived(param('marks') === '1');

  /** Each entry of a section's `items`, changed by `edit`. */
  function eachItem(
    section: KitSection,
    edit: (entry: Record<string, unknown>, index: number) => Record<string, unknown>
  ): KitSection {
    const items = Array.isArray(section.props.items) ? section.props.items : [];
    return { ...section, props: { ...section.props, items: items.map(edit) } };
  }

  /** `?dials=colour:muted,corners:rounder`: unknown dials and steps are dropped. */
  const dials = $derived(
    readPageDials(Object.fromEntries(param('dials').split(',').map((pair) => pair.split(':'))))
  );

  /** `?type=poster`: an unknown Type is dropped. */
  const proofType = $derived.by(() => {
    const type = param('type');
    return isTypeFacet(type) ? type : undefined;
  });

  /** `?eyebrow=Six weeks, online`: cut to the field's 60 characters. */
  const eyebrow = $derived(param('eyebrow').slice(0, 60));

  const kitPage: KitPage = $derived.by(() => {
    const drawn = only ? samplePage(style, only) : samplePage(style);
    const plain = eyebrow
      ? {
          ...drawn,
          sections: drawn.sections.map((section) =>
            section.type === 'hero' ? { ...section, props: { ...section.props, eyebrow } } : section
          ),
        }
      : drawn;
    const pictured = withMedia ? withSamplePictures(plain, pictures) : plain;
    const controlled = controls.size
      ? {
          ...pictured,
          sections: pictured.sections.map((section) => {
            const set = controls.get(section.type);
            return set ? { ...section, props: { ...section.props, ...set } } : section;
          }),
        }
      : pictured;
    const itemised =
      faces || marks
        ? {
            ...controlled,
            sections: controlled.sections.map((section) =>
              faces && section.type === 'testimonials'
                ? eachItem(section, (entry, index) =>
                    index === 0 ? { ...entry, photo: pictures[0].image } : entry
                  )
                : marks && section.type === 'benefits'
                  ? eachItem(section, (entry, index) => ({
                      ...entry,
                      mark: MARKS[index % MARKS.length],
                    }))
                  : section
            ),
          }
        : controlled;
    const sample = dials ? { ...itemised, design: { ...itemised.design, dials } } : itemised;
    if (!only) return sample;
    const layout = param('layout');
    const scheme = param('scheme');
    const spacing = param('spacing');
    /** The layout named for a type: its own (`type:id`), or the one for all. */
    const layoutFor = (type: string) =>
      layout.includes(':')
        ? layout
            .split(',')
            .find((pair) => pair.startsWith(`${type}:`))
            ?.slice(type.length + 1)
        : layout;
    return {
      ...sample,
      sections: sample.sections.map((section) => {
        const named = layoutFor(section.type);
        return {
          ...section,
          variant: isLayoutOf(section.type, named) ? named : undefined,
          design: {
            scheme: isColourSchemeId(scheme) ? scheme : undefined,
            spacing: isSectionSpacingId(spacing) ? spacing : undefined,
          },
        };
      }),
    };
  });

  const context = $derived(
    sampleContext({
      offer,
      media: withMedia
        ? {
            heroImageUrl: image,
            guidePortraitUrl: image,
            intro: clip,
            reel: clip,
            guideClip: clip,
            heroClip: clip,
          }
        : {},
      // Reuses the SAME dev-cdn base as the hero/portrait stills above, so a
      // page-image block (`resolvePageImageUrl`) previews here too instead of
      // rendering its designed empty state on every gallery load.
      mediaBaseUrl: LOCAL_CDN,
      // The same photographs on the practices, so "What's inside" shows a
      // pictured card, in each Style's frame, beside a kind's tile.
      practicePictures: withMedia
        ? PHOTOS.map((_, index) => `${LOCAL_CDN}/page-kit/img${index + 1}.jpg`)
        : [],
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
        <select value={focus ?? ''} onchange={(e) => set('only', e.currentTarget.value)}>
          <option value="">All sections</option>
          {#each SECTION_TYPE_IDS as id (id)}<option value={id}>{id}</option>{/each}
        </select>
      </label>
      {#if focus}
        <label>
          Layout
          <select value={param('layout')} onchange={(e) => set('layout', e.currentTarget.value)}>
            <option value="">Style default</option>
            {#each SECTION_LAYOUTS[focus] as id (id)}<option value={id}>{id}</option>{/each}
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
    orgGrounds={grounds}
    orgShader={shader}
    {proofType}
  />
</div>

<style>
  .kit-preview {
    /* The studio has no mobile bottom nav for the floating bar to clear.
       A length: a unitless 0 is invalid inside `calc()` sums
       (`token-math.test.ts`). */
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

  /* A Moving background (`atmosphere`) shows the org's shader at its real
     strength. On a live page the org layout clears its own cover for that
     page (`routes/_org/[slug]/+layout.svelte`); here the studio shell lays a
     second 80% cover over the shader, so screenshot mode clears that one on
     the same terms: a shader preset, and a page with a Moving background. */
  :global(
      .org-layout[data-hero-shader-active]
        .studio-layout:has(> .studio-layout__main > .kit-preview[data-chrome='off'] .lp[data-lp-atmosphere])
    ) {
    background: transparent;
  }

  /* Below the page's last section, where a live page has its footer, the
     studio's cover comes back: the shader is only ever seen through a
     section, never raw under a short preview. */
  .kit-preview[data-chrome='off'] {
    display: flex;
    flex-direction: column;
  }

  .kit-preview[data-chrome='off']::after {
    content: '';
    flex: 1;
  }

  :global(.org-layout[data-hero-shader-active])
    .kit-preview[data-chrome='off']:has(:global(.lp[data-lp-atmosphere]))::after {
    background: color-mix(in srgb, var(--color-background) 80%, transparent);
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
