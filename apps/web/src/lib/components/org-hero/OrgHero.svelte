<!--
  @component OrgHero

  The org home page's purpose-first hero (round 2 of the org home hero work,
  design pages in docs/handover/org-landing-sources/round2, git-ignored). It
  renders one resolved `HeroOptions` from `$lib/org-hero/hero-config.ts`; it
  decides nothing about defaults or fallbacks itself.

  ── WHY A SPECIFIC PIECE IS A CARD, NOT THE MAIN BUTTON ───────────────────
  Owner, round 1: naming one portal in the main button reads as a hard sell.
  A featured or latest piece sits in a spotlight card (Showcase), a panel
  (Split) or the whole background (Billboard), always with a quiet link. The
  main button stays general: start watching, explore, join, the film, follow.

  ── THE FIT CHECK ──────────────────────────────────────────────────────────
  The hero is `min-height` the chosen height, so nothing it holds can ever be
  clipped, even before hydration. After mount it measures: while it is taller
  than the chosen height it steps type and logo down (to 60%), then hides the
  optional pieces (the small print and proof, then the supporting line and
  search), then raises the height a step. It writes `--_fit`, `data-trim` and
  `data-raise` on its own root directly, so the measuring loop never re-renders.

  ── INK ────────────────────────────────────────────────────────────────────
  Over the org's own ground (gradient, pattern, plain, or a shader that isn't
  painting yet) the hero uses the page's ink. Over a painting shader it uses
  the org's hero ink (the `--brand-hero-*` overrides), and over footage or a
  billboard picture it uses the player's ink on the media scrim.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { preloadPlayerOnIntent } from '$lib/components/player/load-core';
  import { logImageFailure } from '$lib/components/ui/FallbackImage/log-image-failure';
  import { HeroLoopVideo } from '$lib/components/ui/HeroLoopVideo';
  import { PlayIcon, SearchIcon } from '$lib/components/ui/Icon';
  import * as m from '$paraglide/messages';
  import {
    frameShapeFor,
    HERO_ALIGN_ALLOWED,
    heroConsumeLabel,
    type HeroContentKind,
    type HeroOptions,
    type OrgHeroPiece,
  } from '$lib/org-hero/hero-config';
  import type { ReelEntry } from '$lib/org-hero/reel';
  import { coverCropSizes, getThumbnailSrcset } from '$lib/utils/image';
  import Showreel from './showreel/Showreel.svelte';

  interface Props {
    options: HeroOptions;
    name: string;
    description: string;
    logoUrl: string;
    contentKind: HeroContentKind;
    /** The piece the options' `spot` points at, already chosen by the page. */
    spot: OrgHeroPiece | null;
    shelf: readonly OrgHeroPiece[];
    facts: readonly string[];
    hrefs: { explore: string; consume: string; join: string; search: string };
    /** The line under the consume button, or null when there is nothing true to say. */
    consumeNote: string | null;
    /** The intro film, when one can be played. */
    film: {
      duration: string | null;
      /** Small, for the chip. */
      posterUrl: string | null;
      /** Large, for the frame until the loop's first frame. */
      stillUrl: string | null;
      previewUrl: string | null;
    } | null;
    /** The film is playing inside the hero (desktop): the words step aside. */
    filmOpen: boolean;
    /** The film is playing anywhere, the hero or the phone's pop-up: the Showreel holds. */
    filmPlaying: boolean;
    following: boolean;
    followBusy: boolean;
    onfilm: (event: MouseEvent) => void;
    onfollow: () => void;
    /** The film button last pressed, so closing the film returns focus to it. */
    filmChip?: HTMLButtonElement;
    /** The page's in-hero film player, drawn inside the hero's box. */
    filmLayer?: Snippet;
    /** What the Showreel plays (`buildReel`); read only by `comp: 'showreel'`. */
    reel?: readonly ReelEntry[];
  }

  let {
    options: o,
    name,
    description,
    logoUrl,
    contentKind,
    spot,
    shelf,
    facts,
    hrefs,
    consumeNote,
    film,
    filmOpen,
    filmPlaying,
    following,
    followBusy,
    onfilm,
    onfollow,
    filmChip = $bindable(),
    filmLayer,
    reel = [],
  }: Props = $props();

  // The Showreel draws its own hero; resolveHero only picks it with a reel.
  const showreel = $derived(o.comp === 'showreel' && reel.length > 0);
  // Join or Explore sits top right beside Follow (owner, 2026-11-19).
  const reelAction = $derived(
    o.main === 'join'
      ? { href: hrefs.join, label: m.org_hero_join_name({ name }) }
      : o.main === 'explore'
        ? { href: hrefs.explore, label: m.org_hero_explore_everything() }
        : null
  );

  // A picture that fails (deleted, missing variant, CDN hiccup) is dropped, and
  // the hero draws what it would without it: the name where the logo was, the
  // brand's plate in the Showcase frame (a title card in the split panel, which
  // has no caption), the Showcase frame instead of a billboard. Each failure
  // is logged as FallbackImage logs it (`image.fallback_shown`): a picture that
  // quietly vanished looks exactly like a piece that never had one.
  const failed = new SvelteSet<string>();
  const shows = (url: string | null | undefined): url is string => !!url && !failed.has(url);
  function markFailed(event: Event & { currentTarget: HTMLImageElement }) {
    const img = event.currentTarget;
    const src = img.getAttribute('src');
    if (!src) return;
    failed.add(src);
    logImageFailure(img.currentSrc || src);
  }

  const billboard = $derived(o.comp === 'billboard' && shows(spot?.imageUrl));
  // The composition actually drawn: a billboard whose picture failed is drawn
  // as the Showcase frame, with an alignment that frame can take.
  const drawnComp = $derived(o.comp === 'billboard' && !billboard ? 'showcase' : o.comp);
  const drawnAlign = $derived(
    HERO_ALIGN_ALLOWED[drawnComp].includes(o.align) ? o.align : HERO_ALIGN_ALLOWED[drawnComp][0]
  );
  const title = $derived(billboard && spot ? spot.title : name);
  // The last word carries the accent (italic, underline or highlight).
  const titleWords = $derived(title.trim().split(/\s+/));
  const titleHead = $derived(titleWords.slice(0, -1).join(' '));
  const titleLast = $derived(titleWords.at(-1) ?? '');
  const showLogo = $derived(!billboard && o.lead !== 'name' && shows(logoUrl));
  // With the logo leading alone, the name stays in the page for screen readers,
  // and comes back into view if the logo fails.
  const titleHidden = $derived(showLogo && o.lead === 'logo');

  // The org's own film fills the Showcase frame: it loops there silently, and
  // the frame is the press that plays it.
  const filmFrame = $derived(o.comp === 'showcase' && o.spot === 'film' && !!film?.previewUrl);

  // The spotlight frame's shape, when this composition draws one. The film
  // takes the wide frame, whatever its own shape: the loop is cropped to fill
  // it, and the press plays the film whole.
  const frameShape = $derived(
    filmFrame
      ? 'wide'
      : spot && drawnComp === 'showcase'
        ? frameShapeFor(spot.kind)
        : undefined
  );

  // The facts read as one plain sentence ("4 portals, 14 films & recordings,
  // 15 essays and 55 minutes to watch"), not a row of dot-separated labels.
  // At most three, so it stays one line beside the follow button.
  const facts3 = new Intl.ListFormat('en-GB', { type: 'conjunction' });
  const factsSentence = $derived(facts3.format(facts.slice(0, 3)));

  // Each picture offers its sizes, so the browser fetches the file for its box
  // (`$lib/utils/image`). Every one is drawn `object-fit: cover`; a picture
  // that does not record its size is taken as 16:9, a poster's shape.
  const POSTER = 16 / 9;
  // Where a slot changes shape between phone and desktop, each width gets its
  // own crop: one `coverCropSizes` scales every entry by a single ratio.
  const either = (desk: string, phone: string) => `${desk}, ${phone}`;
  const billboardSizes = (url: string) => coverCropSizes('100vw', 16 / 10, url, POSTER);
  const frameSizes = (url: string) =>
    frameShape === 'wide'
      ? either(
          coverCropSizes('(min-width: 48rem) 66vw', 16 / 10, url, POSTER),
          coverCropSizes('100vw', 3 / 4, url, POSTER)
        )
      : coverCropSizes('(min-width: 48rem) 46vw, 100vw', frameShape === 'page' ? 4 / 5 : 3 / 4, url, POSTER);
  const panelSizes = (url: string) => coverCropSizes('(min-width: 48rem) 45vw, 100vw', 4 / 5, url, POSTER);
  // On a desktop Statement the shelf is a wall at the hero's height: a tall
  // first tile (about 23vw) beside one or two (about 19vw), or one across it all.
  const shelfWall = $derived(o.comp === 'statement' && o.proof === 'shelf');
  function shelfSizes(url: string, index: number) {
    const strip = coverCropSizes('(min-width: 48rem) 13rem, 11rem', 4 / 3, url, POSTER);
    if (!shelfWall) return strip;
    const alone = shelf.length === 1;
    const tall = alone || index === 0 || shelf.length === 2;
    const width = alone ? 42 : index === 0 ? 23 : 19;
    return either(
      coverCropSizes(`(min-width: 48rem) ${width}vw`, alone ? 1 : tall ? 1 / 2 : 9 / 10, url, POSTER),
      coverCropSizes('11rem', 4 / 3, url, POSTER)
    );
  }

  const line = $derived(billboard ? (spot?.meta ?? '') : o.line === 'desc' ? description : '');
  const MICRO: Partial<Record<HeroOptions['main'], () => string | null>> = {
    join: m.org_hero_join_note,
    follow: m.org_hero_follow_note,
    consume: () => consumeNote,
  };
  const micro = $derived(o.micro === 'on' ? (MICRO[o.main]?.() ?? null) : null);
  function pressFilm(event: MouseEvent & { currentTarget: HTMLButtonElement }) {
    filmChip = event.currentTarget;
    onfilm(event);
  }
  const filmLabel = $derived(
    film?.duration ? m.org_hero_watch_film_duration({ duration: film.duration }) : m.org_hero_watch_film()
  );
  const showFilmChip = $derived(!billboard && !filmFrame && o.second === 'auto' && o.main !== 'film' && !!film);
  const showExploreGhost = $derived(
    billboard || (o.second === 'auto' && o.main !== 'explore' && !showFilmChip)
  );

  // ── fit check ──
  const HEIGHT_ORDER = ['compact', 'tall', 'full'] as const;
  /** Everything that can change the hero's height, so the check re-runs on it. */
  const layoutKey = $derived(
    [JSON.stringify(o), title, line, micro, facts.join('|'), shelf.length, spot?.title, filmFrame, showLogo, billboard].join('§')
  );

  function fitCheck(node: HTMLElement) {
    void layoutKey;
    let frame = 0;
    const measure = () => {
      delete node.dataset.trim;
      delete node.dataset.raise;
      const over = () => node.offsetHeight > parseFloat(getComputedStyle(node).minHeight) + 1;
      let fit = 1;
      node.style.setProperty('--_fit', '1');
      while (over() && fit > 0.6) {
        fit = Math.round((fit - 0.05) * 100) / 100;
        node.style.setProperty('--_fit', String(fit));
      }
      if (over()) node.dataset.trim = '1';
      if (over()) node.dataset.trim = '2';
      let step = HEIGHT_ORDER.indexOf(o.height);
      while (over() && step < HEIGHT_ORDER.length - 1) {
        step += 1;
        node.dataset.raise = HEIGHT_ORDER[step];
      }
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    let attached = true;
    let viewport = '';
    const resized = () => {
      const next = `${innerWidth}|${getComputedStyle(node).minHeight}`;
      if (next === viewport) return;
      viewport = next;
      schedule();
    };
    schedule();
    void document.fonts?.ready.then(() => {
      if (attached) schedule();
    });
    addEventListener('resize', resized);
    return () => {
      attached = false;
      cancelAnimationFrame(frame);
      removeEventListener('resize', resized);
    };
  }
</script>

{#if showreel}
<Showreel
  {reel}
  options={o}
  {name}
  {description}
  logoUrl={o.lead !== 'name' && shows(logoUrl) ? logoUrl : ''}
  onlogofail={markFailed}
  facts={o.proof === 'facts' ? factsSentence : ''}
  action={reelAction}
  exploreHref={hrefs.explore}
  filmDuration={film?.duration ?? null}
  {following}
  {followBusy}
  {onfollow}
  onfilm={pressFilm}
  {filmOpen}
  {filmPlaying}
  {filmLayer}
/>
{:else}
<section
  class="org-hero"
  data-hero-root
  data-comp={drawnComp}
  data-align={drawnAlign}
  data-height={o.height}
  data-bg={billboard ? 'picture' : o.bg}
  data-veil={o.veil}
  data-ambient={o.ambient}
  data-type={o.type}
  data-accent={o.accent}
  data-entrance={o.entrance}
  data-bstyle={o.bstyle}
  data-logo={o.logo}
  data-frame={frameShape}
  data-proof={o.proof}
  data-media={filmFrame ? 'film' : undefined}
  data-film-open={filmOpen ? '' : undefined}
  aria-label={name}
  {@attach fitCheck}
>
  <div class="org-hero__bg" aria-hidden="true">
    {#if billboard && spot && shows(spot.imageUrl)}
      <img
        onerror={markFailed}
        class="org-hero__bg-media"
        src={spot.imageUrl}
        srcset={getThumbnailSrcset(spot.imageUrl)}
        sizes={billboardSizes(spot.imageUrl)}
        alt=""
        fetchpriority="high"
        decoding="async"
      />
    {:else if o.bg === 'film' && film?.previewUrl}
      <div class="org-hero__bg-media">
        <HeroLoopVideo
          src={film.previewUrl}
          posterUrl={film.stillUrl ?? film.posterUrl}
          posterSrcset={getThumbnailSrcset(film.stillUrl ?? film.posterUrl)}
          posterSizes="100vw"
        />
      </div>
    {/if}
  </div>
  <div class="org-hero__veil" aria-hidden="true"></div>
  {#if o.grain === 'on'}<div class="org-hero__grain" aria-hidden="true"></div>{/if}

  {@render filmLayer?.()}

  <div class="org-hero__inner" inert={filmOpen}>
    <div class="org-hero__words">
      {#if billboard && spot}
        <p class="org-hero__id org-hero__in" style:--_i="0">
          {#if shows(logoUrl)}<img onerror={markFailed} src={logoUrl} alt="" />{/if}
          <span>{name}</span>
        </p>
        <p class="org-hero__kicker org-hero__in" style:--_i="1">{spot.kicker}</p>
      {:else if showLogo}
        <img onerror={markFailed} class="org-hero__logo org-hero__in" style:--_i="1" src={logoUrl} alt="" />
      {/if}

      <h1 class="org-hero__title org-hero__in" class:org-hero__title--hidden={titleHidden} style:--_i="2">
        <!-- Svelte trims whitespace at a block's edge, so the space comes from the expression. -->
        {titleHead ? `${titleHead} ` : ''}<span class="org-hero__accent">{titleLast}</span>
      </h1>

      {#if line}
        <p class="org-hero__line org-hero__in" style:--_i="3">{line}</p>
      {/if}

      {#if o.search === 'on' && !billboard}
        <form class="org-hero__search org-hero__in" style:--_i="4" role="search" action={hrefs.search} method="get">
          <SearchIcon size={18} aria-hidden="true" />
          <input name="q" type="search" placeholder={m.org_hero_search_placeholder({ name })} aria-label={m.org_hero_search_placeholder({ name })} />
        </form>
      {/if}

      <div class="org-hero__actions org-hero__in" style:--_i="5">
        {#if billboard && spot}
          <a class="org-hero__btn org-hero__btn--main" href={spot.href}>{spot.cta}</a>
        {:else if o.main === 'consume'}
          <a class="org-hero__btn org-hero__btn--main" href={hrefs.consume}>{heroConsumeLabel(contentKind)}</a>
        {:else if o.main === 'explore'}
          <a class="org-hero__btn org-hero__btn--main" href={hrefs.explore}>{m.org_hero_explore_everything()}</a>
        {:else if o.main === 'join'}
          <a class="org-hero__btn org-hero__btn--main" href={hrefs.join}>{m.org_hero_join_name({ name })}</a>
        {:else if o.main === 'film' && film}
          <button
            type="button"
            class="org-hero__btn org-hero__btn--main"
            aria-label={filmLabel}
            onclick={pressFilm}
            {@attach preloadPlayerOnIntent}
          >
            <PlayIcon size={16} aria-hidden="true" />
            {m.org_hero_watch_film()}{#if film.duration}<span class="org-hero__dur">{` · ${film.duration}`}</span>{/if}
          </button>
        {:else if o.main === 'follow'}
          <button type="button" class="org-hero__btn org-hero__btn--main" onclick={onfollow} disabled={followBusy}>
            {following ? m.org_following() : m.org_hero_follow_releases()}
          </button>
        {/if}

        {#if showFilmChip && film}
          <button
            type="button"
            class="org-hero__btn org-hero__btn--film"
            onclick={pressFilm}
            aria-label={filmLabel}
            {@attach preloadPlayerOnIntent}
          >
            <span class="org-hero__film-poster" aria-hidden="true">
              {#if shows(film.posterUrl)}<img onerror={markFailed} src={film.posterUrl} srcset={getThumbnailSrcset(film.posterUrl)} sizes="4rem" alt="" decoding="async" />{/if}
              <PlayIcon size={14} />
            </span>
            <span class="org-hero__film-label" aria-hidden="true">{m.org_hero_watch_film()}{#if film.duration}{` · ${film.duration}`}{/if}</span>
          </button>
        {/if}
        {#if showExploreGhost}
          <a class="org-hero__btn org-hero__btn--ghost" href={hrefs.explore}>{m.org_hero_explore_everything()}</a>
        {/if}
      </div>

      {#if micro}
        <p class="org-hero__micro org-hero__in" style:--_i="6">{micro}</p>
      {/if}

      {#if o.proof === 'facts' && facts.length > 0}
        <p class="org-hero__facts org-hero__in" style:--_i="7">
          <span>{factsSentence}</span>
          {#if o.main !== 'follow'}
            <button type="button" class="org-hero__follow" onclick={onfollow} disabled={followBusy}>
              {following ? m.org_following() : m.org_hero_follow_short()}
            </button>
          {/if}
        </p>
      {:else if o.proof === 'shelf' && shelf.length > 0}
        <ul class="org-hero__shelf org-hero__in" style:--_i="7">
          {#each shelf as piece, index (piece.href)}
            <li>
              <a href={piece.href}>
                <span class="org-hero__shelf-thumb">
                  {#if shows(piece.imageUrl)}<img onerror={markFailed} src={piece.imageUrl} srcset={getThumbnailSrcset(piece.imageUrl)} sizes={shelfSizes(piece.imageUrl, index)} alt="" loading="lazy" decoding="async" />{/if}
                </span>
                <span class="org-hero__shelf-text"><b>{piece.title}</b><small>{piece.meta}</small></span>
              </a>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    {#if drawnComp === 'showcase'}
      {#if filmFrame && film?.previewUrl}
        <!-- The org's own film IS the hero's media. It loops silently in the
             frame; the frame is the press that plays it (grown in the hero on a
             desktop, in the pop-up on a phone). -->
        <button
          type="button"
          class="org-hero__frame org-hero__frame--film"
          data-shape="wide"
          onclick={pressFilm}
          aria-label={filmLabel}
          {@attach preloadPlayerOnIntent}
        >
          <span class="org-hero__frame-art" aria-hidden="true">
            <HeroLoopVideo
              src={film.previewUrl}
              posterUrl={film.stillUrl ?? film.posterUrl}
              posterSrcset={getThumbnailSrcset(film.stillUrl ?? film.posterUrl)}
              posterSizes={frameSizes(film.stillUrl ?? film.posterUrl ?? '')}
            />
          </span>
          <span class="org-hero__film-call" aria-hidden="true">
            <span class="org-hero__film-pill">
              <span class="org-hero__film-disc"><PlayIcon size={22} /></span>
              <span class="org-hero__film-words">
                {m.org_hero_watch_film()}{#if film.duration}<span class="org-hero__film-dur">{film.duration}</span>{/if}
              </span>
            </span>
          </span>
        </button>
      {:else if spot}
        <!-- The spotlight is a FRAME shaped by what it holds (arch / wide / page),
             as tall as the hero. One link: the whole frame. -->
        <a class="org-hero__frame" data-shape={frameShape} href={spot.href}>
          <span class="org-hero__frame-art" aria-hidden="true">
            {#if shows(spot.imageUrl)}
              <img
                onerror={markFailed}
                src={spot.imageUrl}
                srcset={getThumbnailSrcset(spot.imageUrl)}
                sizes={frameSizes(spot.imageUrl)}
                alt=""
                decoding="async"
                fetchpriority="high"
              />
            {:else}
              <!-- the brand's own plate: the caption below already names the piece -->
              <span class="org-hero__frame-fallback"></span>
            {/if}
          </span>
          {#if spot.kind === 'video' || spot.kind === 'audio'}
            <span class="org-hero__frame-play" aria-hidden="true"><PlayIcon size={22} /></span>
          {/if}
          <span class="org-hero__frame-caption">
            <span class="org-hero__frame-meta">{spot.meta}</span>
            <span class="org-hero__frame-title">{spot.title}</span>
            {#if spot.line}<span class="org-hero__frame-line">{spot.line}</span>{/if}
            <span class="org-hero__frame-go">{spot.cta}</span>
          </span>
        </a>
      {/if}
    {:else if o.comp === 'split' && spot}
      <a class="org-hero__media" href={spot.href} aria-label={m.org_hero_piece_label({ kicker: spot.kicker, title: spot.title })}>
        {#if shows(spot.imageUrl)}
          <img
            onerror={markFailed}
            src={spot.imageUrl}
            srcset={getThumbnailSrcset(spot.imageUrl)}
            sizes={panelSizes(spot.imageUrl)}
            alt=""
            decoding="async"
            fetchpriority="high"
          />
        {:else}
          <span class="org-hero__frame-fallback" aria-hidden="true">{spot.title}</span>
        {/if}
      </a>
    {/if}
  </div>
</section>
{/if}

<style>
  /* ── root + ink ───────────────────────────────────────────────────────── */
  .org-hero {
    --_fit: 1;
    --_h: 78svh;
    --_tscale: 1.5;
    --_tm: 1;
    --_logo: var(--space-24);
    --_ink: var(--color-text);
    --_ink-strong: var(--color-heading, var(--color-text));
    --_ink-soft: var(--color-text-secondary);
    --_veil: var(--color-background);
    --_glass: color-mix(in srgb, var(--color-background) 64%, transparent);
    --_line: var(--color-border);
    --_btn-bg: var(--color-interactive);
    --_btn-ink: var(--color-on-interactive);
    --_accent: var(--color-interactive);

    position: relative;
    z-index: 2;
    isolation: isolate;
    min-height: var(--_h);
    display: flex;
    flex-direction: column;
    color: var(--_ink);
  }

  /* A shader is painting behind the hero (ShaderHero's `data-live`: a renderer
     has drawn the frame its canvas shows): the org's hero ink, on a dark scrim.
     The full hero colour is for the title (and the button). Body copy is a TINT
     of it into the player's near-white, so a red ink reads as a warm pale line
     instead of red paragraphs, and a white ink (the default) stays white. */
  :global(.org-layout:has(> .shader-hero--fullpage[data-live])) .org-hero[data-bg='shader'] {
    --_ink: color-mix(in oklab, var(--brand-hero-text, var(--color-player-text)) 22%, var(--color-player-text));
    --_ink-strong: var(--brand-hero-title-color, var(--color-player-text));
    --_ink-soft: color-mix(in oklab, var(--brand-hero-text-muted, var(--color-player-text-secondary)) 30%, var(--color-player-text-secondary));
    --_veil: var(--media-scrim, var(--color-neutral-900));
    --_glass: color-mix(in srgb, var(--media-scrim, var(--color-neutral-900)) 55%, transparent);
    --_line: color-mix(in srgb, var(--brand-hero-border-tint, var(--color-player-text)) 24%, transparent);
    --_btn-bg: var(--brand-hero-cta-bg, var(--color-interactive));
    --_btn-ink: var(--brand-hero-cta-text, var(--color-on-interactive));
  }

  /* Footage or a billboard picture: the player's ink. */
  .org-hero[data-bg='film'],
  .org-hero[data-bg='picture'] {
    --_ink: var(--color-player-text);
    --_ink-strong: var(--color-player-text);
    --_ink-soft: var(--color-player-text-secondary);
    --_veil: var(--media-scrim, var(--color-neutral-900));
    --_glass: color-mix(in srgb, var(--media-scrim, var(--color-neutral-900)) 55%, transparent);
    --_line: color-mix(in srgb, var(--color-player-text) 24%, transparent);
  }

  /* ── heights (the fit check may raise one a step via data-raise) ──────── */
  .org-hero[data-height='full'] { --_h: 100svh; }
  .org-hero[data-height='tall'] { --_h: 78svh; }
  .org-hero[data-height='compact'] { --_h: 56svh; }
  .org-hero:global([data-raise='tall']) { --_h: 78svh; }
  .org-hero:global([data-raise='full']) { --_h: 100svh; }

  /* ── background layers ───────────────────────────────────────────────── */
  .org-hero__bg,
  .org-hero__veil,
  .org-hero__grain {
    position: absolute;
    inset: 0;
    z-index: -1;
    pointer-events: none;
  }

  .org-hero__bg {
    overflow: hidden;
    /* fades into the feed below, so an opaque ground has no hard edge */
    mask-image: linear-gradient(to bottom, black 72%, transparent);
  }

  .org-hero[data-bg='gradient'] .org-hero__bg {
    background:
      radial-gradient(70% 90% at 78% 18%, color-mix(in srgb, var(--color-brand-primary) 34%, transparent), transparent 62%),
      radial-gradient(60% 70% at 8% 105%, color-mix(in srgb, var(--color-brand-primary) 18%, transparent), transparent 70%),
      var(--color-background);
  }

  .org-hero[data-bg='pattern'] .org-hero__bg {
    background:
      repeating-radial-gradient(circle at 78% 34%, color-mix(in srgb, var(--color-brand-primary) 26%, transparent) 0 1.5px, transparent 1.5px var(--space-8)),
      var(--color-background);
  }

  .org-hero[data-bg='plain'] .org-hero__bg {
    background: var(--color-background);
  }

  .org-hero__bg-media,
  .org-hero__bg-media :global(video),
  .org-hero__bg-media :global(img) {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .org-hero[data-ambient='drift'] .org-hero__bg-media,
  .org-hero[data-ambient='drift'][data-bg='pattern'] .org-hero__bg {
    animation: org-hero-drift calc(var(--duration-slowest) * 32) var(--ease-in-out) infinite alternate;
  }

  /* The veil is the ground (or the media scrim) at an alpha: it darkens a dark
     brand and lightens a light one with the same rule. Only drawn where the
     hero sits over something other than the org's own ground. */
  .org-hero__veil {
    display: none;
    /* the landing's feed rises over the hero's foot and fades IN across
       --landing-overlap; the veil fades OUT across the same band, or the two
       meet at a hard line */
    mask-image: linear-gradient(to bottom, black calc(100% - var(--landing-overlap, 0px)), transparent);
  }
  .org-hero[data-bg='shader'] .org-hero__veil,
  .org-hero[data-bg='film'] .org-hero__veil,
  .org-hero[data-bg='picture'] .org-hero__veil,
  .org-hero[data-veil='strong'] .org-hero__veil {
    display: block;
  }
  .org-hero[data-veil='auto'] .org-hero__veil {
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--_veil) 8%, transparent) 0%,
      color-mix(in srgb, var(--_veil) 22%, transparent) 42%,
      color-mix(in srgb, var(--_veil) 80%, transparent) 100%
    );
  }
  .org-hero[data-veil='auto'][data-comp='centre'] .org-hero__veil {
    background: radial-gradient(62% 62% at 50% 50%, color-mix(in srgb, var(--_veil) 58%, transparent), color-mix(in srgb, var(--_veil) 20%, transparent));
  }
  .org-hero[data-veil='auto'][data-comp='showcase'] .org-hero__veil,
  .org-hero[data-veil='auto'][data-comp='split'] .org-hero__veil {
    background: linear-gradient(90deg, color-mix(in srgb, var(--_veil) 74%, transparent) 0%, color-mix(in srgb, var(--_veil) 28%, transparent) 58%, color-mix(in srgb, var(--_veil) 10%, transparent) 100%);
  }
  .org-hero[data-veil='auto'][data-align='end'][data-comp='showcase'] .org-hero__veil {
    transform: scaleX(-1);
  }
  .org-hero[data-veil='soft'] .org-hero__veil { background: color-mix(in srgb, var(--_veil) 30%, transparent); }
  .org-hero[data-veil='strong'] .org-hero__veil { background: color-mix(in srgb, var(--_veil) 68%, transparent); }

  .org-hero__grain {
    opacity: var(--opacity-20, 0.2);
    mix-blend-mode: overlay;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  }

  /* ── layout ──────────────────────────────────────────────────────────── */
  .org-hero__inner {
    position: relative;
    flex: 1;
    display: grid;
    gap: var(--space-10);
    width: 100%;
    /* the sections' own container and gutter (.section), so the hero's words
       start on the same line as every heading below them */
    max-width: var(--container-xl);
    margin-inline: auto;
    padding: var(--space-12) var(--space-6) var(--space-10);
    transition: opacity var(--duration-slow) var(--ease-out), transform var(--duration-slow) var(--ease-out);
  }

  .org-hero[data-film-open] .org-hero__inner {
    opacity: 0;
    transform: translateY(var(--space-4));
    pointer-events: none;
  }

  .org-hero__words {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-6);
    max-width: 46rem;
    min-width: 0;
  }

  .org-hero[data-comp='statement'] .org-hero__inner,
  .org-hero[data-comp='billboard'] .org-hero__inner {
    align-content: end;
  }

  .org-hero[data-comp='centre'] .org-hero__inner {
    align-content: center;
    justify-items: center;
  }

  .org-hero[data-comp='split'] .org-hero__inner {
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
    align-items: center;
  }

  .org-hero[data-align='end'][data-comp='split'] .org-hero__media {
    order: -1;
  }

  /* Showcase: the words are grounded bottom-left and the frame stands over the
     other side, as tall as the hero (it is placed, so it never makes the hero
     taller and the fit check only ever measures the words). */
  .org-hero[data-comp='showcase'] .org-hero__inner {
    align-content: end;
    padding-block: var(--space-16) var(--space-12);
  }

  .org-hero[data-comp='showcase'] .org-hero__words {
    max-width: min(40rem, 48%);
  }

  .org-hero[data-comp='showcase'] .org-hero__line {
    max-width: 34ch;
  }

  .org-hero[data-align='end'][data-comp='showcase'] .org-hero__words {
    justify-self: end;
  }

  .org-hero[data-comp='showcase'][data-frame='wide'] { --_tscale: 1.1; }
  .org-hero[data-comp='showcase'][data-frame='wide'] .org-hero__words { max-width: min(36rem, 40%); }

  .org-hero[data-align='center'] .org-hero__words,
  .org-hero[data-comp='centre'] .org-hero__words {
    justify-self: center;
    align-items: center;
    text-align: center;
  }

  .org-hero[data-align='end'][data-comp='statement'] .org-hero__words {
    justify-self: end;
    align-items: flex-end;
    text-align: right;
  }

  .org-hero[data-align='center'] .org-hero__actions,
  .org-hero[data-align='center'] .org-hero__facts,
  .org-hero[data-align='center'] .org-hero__shelf,
  .org-hero[data-comp='centre'] .org-hero__actions,
  .org-hero[data-comp='centre'] .org-hero__facts {
    justify-content: center;
  }

  .org-hero[data-align='end'][data-comp='statement'] .org-hero__actions,
  .org-hero[data-align='end'][data-comp='statement'] .org-hero__facts {
    justify-content: flex-end;
  }

  /* ── words ───────────────────────────────────────────────────────────── */
  .org-hero[data-logo='s'] { --_logo: var(--space-14); }
  .org-hero[data-logo='m'] { --_logo: var(--space-24); }
  .org-hero[data-logo='l'] { --_logo: var(--space-48); }
  .org-hero[data-comp='centre'][data-logo] { --_logo: calc(var(--space-24) * 1.4); }
  .org-hero[data-comp='centre'][data-logo='l'] { --_logo: calc(var(--space-48) * 1.2); }
  .org-hero[data-comp='centre'][data-logo='s'] { --_logo: var(--space-20); }

  .org-hero__logo {
    margin-bottom: var(--space-2);
    height: calc(var(--_logo) * var(--_fit));
    width: auto;
    max-width: 100%;
    object-fit: contain;
  }

  .org-hero__id {
    margin: 0;
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    font-family: var(--font-heading);
    font-size: var(--text-lg);
    color: var(--_ink);
  }

  .org-hero__id img {
    height: var(--space-8);
    width: auto;
  }

  /* sentence case: a kicker says what the piece is, it is not a shouted label */
  .org-hero__kicker {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--_accent);
  }

  .org-hero[data-comp='statement'] { --_tscale: 1.5; }
  .org-hero[data-comp='centre'] { --_tscale: 1; }
  .org-hero[data-comp='centre'][data-logo] .org-hero__title { --_tscale: 1; }
  .org-hero[data-comp='showcase'] { --_tscale: 1.45; }
  .org-hero[data-comp='split'] { --_tscale: 1.1; }
  .org-hero[data-comp='billboard'] { --_tscale: 1.05; }
  .org-hero[data-type='caps'] { --_tm: 0.62; }
  .org-hero[data-type='oversized'] { --_tm: 1.3; }

  /* `.org-hero` first: the global `[data-org-brand] [class*="__title"]` heading
     rule is (0,2,0), the same as a scoped single class, so source order (which
     the dev server varies) decided whether the brand's hero title colour won */
  .org-hero .org-hero__title {
    margin: 0;
    font-family: var(--font-heading);
    font-weight: var(--heading-weight, var(--font-bold));
    font-size: calc(var(--text-display) * var(--_tscale) * var(--_tm) * var(--_fit));
    line-height: var(--leading-display);
    letter-spacing: var(--tracking-tight);
    color: var(--_ink-strong);
    text-wrap: balance;
  }

  .org-hero[data-type='caps'] .org-hero__title {
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    line-height: var(--leading-tight);
  }

  .org-hero[data-type='expressive'] .org-hero__accent {
    font-style: italic;
    color: var(--_accent);
  }

  .org-hero[data-accent='underline'] .org-hero__accent {
    text-decoration: underline;
    text-decoration-color: var(--_accent);
    text-decoration-thickness: 0.07em;
    text-underline-offset: 0.14em;
  }

  .org-hero[data-accent='highlight'] .org-hero__accent {
    background: linear-gradient(transparent 60%, color-mix(in srgb, var(--_accent) 40%, transparent) 60% 92%, transparent 92%);
  }

  .org-hero__title--hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .org-hero__line {
    margin: 0;
    max-width: var(--measure-narrow);
    font-size: calc(var(--text-xl) * max(var(--_fit), 0.85));
    line-height: var(--leading-relaxed);
    color: color-mix(in srgb, var(--_ink) 88%, transparent);
    text-wrap: pretty;
  }

  .org-hero__search {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: min(34rem, 100%);
    min-height: calc(var(--space-12) + var(--space-1));
    padding-inline: var(--space-4);
    border: var(--border-width) var(--border-style) var(--_line);
    border-radius: var(--radius-input);
    background: var(--_glass);
    backdrop-filter: blur(var(--blur-md));
    color: var(--_ink-soft);
  }

  .org-hero__search:focus-within {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }

  .org-hero__search input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    color: var(--_ink);
    font: inherit;
    font-size: var(--text-base);
  }

  .org-hero__search input:focus {
    outline: none;
  }

  /* ── buttons ─────────────────────────────────────────────────────────── */
  .org-hero__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    /* the line and the way in are separate thoughts: a larger step */
    margin-top: var(--space-4);
  }

  .org-hero__btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--space-12);
    padding: 0 var(--space-6);
    border: var(--border-width-thick) var(--border-style) transparent;
    border-radius: var(--radius-button);
    font: inherit;
    font-size: var(--text-base);
    font-weight: var(--font-medium);
    text-decoration: none;
    white-space: nowrap;
    cursor: pointer;
    transition: transform var(--duration-fast) var(--ease-default), box-shadow var(--duration-normal) var(--ease-default), background-color var(--duration-fast) var(--ease-default);
  }

  .org-hero__btn:hover { transform: translateY(-1px); }
  .org-hero__btn:disabled { opacity: var(--opacity-60, 0.6); cursor: default; transform: none; }

  .org-hero__btn:focus-visible,
  .org-hero__follow:focus-visible,
  .org-hero__frame:focus-visible,
  .org-hero__media:focus-visible,
  .org-hero__shelf a:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }

  .org-hero__btn--main {
    background: var(--_btn-bg);
    color: var(--_btn-ink);
    box-shadow: var(--shadow-md);
  }

  .org-hero[data-bstyle='outline'] .org-hero__btn--main {
    background: transparent;
    border-color: var(--_btn-bg);
    color: var(--_ink-strong);
    box-shadow: none;
  }

  .org-hero[data-bstyle='pill'] .org-hero__btn {
    border-radius: var(--radius-full);
  }

  .org-hero[data-bstyle='link'] .org-hero__btn--main {
    background: none;
    box-shadow: none;
    padding-inline: var(--space-1);
    color: var(--_ink-strong);
    text-decoration: underline;
    text-decoration-color: var(--_btn-bg);
    text-decoration-thickness: 2px;
    text-underline-offset: 0.4em;
  }

  .org-hero__btn--ghost,
  .org-hero__btn--film {
    background: color-mix(in srgb, var(--_ink) 10%, transparent);
    border-color: var(--_line);
    color: var(--_ink);
  }

  .org-hero__btn--film {
    padding: var(--space-1) var(--space-5) var(--space-1) var(--space-1);
    gap: var(--space-3);
  }

  .org-hero__film-poster {
    position: relative;
    display: grid;
    place-items: center;
    block-size: calc(var(--space-12) - var(--space-3));
    aspect-ratio: 16 / 9;
    overflow: hidden;
    border-radius: calc(var(--radius-button) - var(--space-1));
    background: var(--color-neutral-900);
    color: var(--color-player-text);
  }

  .org-hero__film-poster img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: var(--opacity-80, 0.8);
  }

  .org-hero__film-poster :global(svg) { position: relative; }

  .org-hero__dur { opacity: var(--opacity-80, 0.8); }

  .org-hero__micro {
    margin: calc(var(--space-2) * -1) 0 0;
    font-size: var(--text-sm);
    color: var(--_ink-soft);
  }

  /* ── proof ───────────────────────────────────────────────────────────── */
  .org-hero__facts {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-4);
    font-size: var(--text-sm);
    color: var(--_ink-soft);
  }

  .org-hero__follow {
    padding: var(--space-1) var(--space-3);
    border: var(--border-width) var(--border-style) var(--_line);
    border-radius: var(--radius-full);
    background: none;
    color: var(--_ink);
    font: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
  }

  /* The shelf: three picture-led tiles, the pictures doing the talking. */
  .org-hero__shelf {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 13rem));
    gap: var(--space-4);
    margin: 0;
    padding: 0;
    list-style: none;
    max-width: 100%;
  }

  .org-hero__shelf a {
    display: grid;
    align-content: start;
    gap: var(--space-3);
    color: var(--_ink);
    text-decoration: none;
  }

  .org-hero__shelf-thumb {
    aspect-ratio: 4 / 3;
    overflow: hidden;
    border-radius: var(--radius-card);
    background: color-mix(in srgb, var(--color-brand-primary) 40%, var(--color-background));
    box-shadow: var(--shadow-lg);
  }

  .org-hero__shelf-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    transition: transform var(--duration-slower) var(--ease-smooth);
  }

  .org-hero__shelf a:hover .org-hero__shelf-thumb img { transform: scale(1.05); }

  .org-hero__shelf-text { display: grid; gap: var(--space-1); min-width: 0; text-align: left; }

  .org-hero__shelf-text b {
    font-family: var(--font-heading);
    font-weight: var(--heading-weight, var(--font-semibold));
    font-size: var(--text-sm);
    line-height: var(--leading-snug);
    color: var(--_ink-strong);
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .org-hero__shelf-text small { font-size: var(--text-xs); color: var(--_ink-soft); }

  /* ── the spotlight frame ─────────────────────────────────────────────────
     The boldest thing in the hero, so everything around it stays quiet. It
     takes the shape of what it holds: a portal is an ARCH (a threshold you step
     through), a film is WIDE footage, an essay or a recording's cover a PAGE.
     Placed with its top and bottom pinned, its height is the hero's and
     aspect-ratio gives its width, capped so the words always keep their half. */
  .org-hero__frame {
    position: absolute;
    /* the base shares the words' baseline (the inner's bottom padding) */
    inset-block: var(--space-10) var(--space-12);
    inset-inline-end: var(--space-6);
    aspect-ratio: 3 / 4;
    max-width: 46%;
    display: block;
    overflow: hidden;
    isolation: isolate;
    border-radius: var(--radius-card);
    background: color-mix(in oklab, var(--color-brand-primary) 32%, var(--_veil));
    box-shadow: var(--shadow-xl);
    color: var(--color-player-text);
    text-decoration: none;
  }

  /* a semicircle top: an oversized radius scales down to half the width */
  .org-hero__frame[data-shape='arch'] {
    border-radius: 100vmax 100vmax var(--radius-card) var(--radius-card);
  }

  .org-hero__frame[data-shape='page'] { aspect-ratio: 4 / 5; }

  .org-hero[data-align='end'][data-comp='showcase'] .org-hero__frame {
    inset-inline: var(--space-6) auto;
  }

  .org-hero__frame-art {
    position: absolute;
    inset: 0;
    z-index: -1;
  }

  .org-hero__frame-art img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    transition: transform var(--duration-slowest) var(--ease-smooth);
  }

  .org-hero__frame:hover .org-hero__frame-art img { transform: scale(1.04); }

  /* The film frame is a button: none of a button's own dress. */
  .org-hero__frame--film {
    padding: 0;
    border: 0;
    font: inherit;
    text-align: inherit;
    cursor: pointer;
  }

  /* ONE call, in the middle of the picture: a glass pill that reads on any
     footage, the brand's play disc inside it. One element, so its centre is
     the centre line the words share. */
  .org-hero__film-call {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: var(--color-player-text);
  }

  .org-hero__film-pill {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-2) var(--space-6) var(--space-2) var(--space-2);
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--media-scrim, var(--color-neutral-900)) 62%, transparent);
    backdrop-filter: blur(var(--blur-md));
    box-shadow: var(--shadow-lg);
    transition: transform var(--duration-normal) var(--ease-default);
  }

  .org-hero__film-disc {
    display: grid;
    place-items: center;
    inline-size: var(--space-14);
    block-size: var(--space-14);
    border-radius: var(--radius-full);
    background: var(--_btn-bg);
    color: var(--_btn-ink);
  }

  .org-hero__film-disc :global(svg) { translate: 6% 0; }

  .org-hero__frame--film:hover .org-hero__film-pill { transform: scale(1.04); }

  .org-hero__film-words {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-2);
    font-size: var(--text-lg);
    font-weight: var(--font-medium);
  }

  .org-hero__film-dur {
    font-size: var(--text-sm);
    font-weight: var(--font-normal);
    color: var(--color-player-text-secondary);
    font-variant-numeric: tabular-nums;
  }

  /* no picture: the brand's own ground; the split panel sets the title on it
     large (the Showcase frame's caption already names the piece) */
  .org-hero__frame-fallback {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    padding: var(--space-10);
    text-align: center;
    font-family: var(--font-heading);
    font-size: var(--text-5xl);
    line-height: var(--leading-tight);
    color: var(--_ink-strong);
    background: radial-gradient(circle at 50% 30%, color-mix(in oklab, var(--color-brand-primary) 55%, transparent), transparent 70%);
  }

  .org-hero__frame-play {
    position: absolute;
    inset: 0 0 auto;
    height: 55%;
    display: grid;
    place-items: center;
  }

  .org-hero__frame-play :global(svg) {
    box-sizing: content-box;
    padding: var(--space-5);
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--media-scrim, var(--color-neutral-900)) 60%, transparent);
    backdrop-filter: blur(var(--blur-md));
  }

  /* the caption sits in the frame's foot, on a fall of the scrim */
  .org-hero__frame-caption {
    position: absolute;
    inset: auto 0 0;
    display: grid;
    justify-items: start;
    gap: var(--space-4);
    padding: var(--space-24) var(--space-8) var(--space-8);
    background: linear-gradient(
      to top,
      color-mix(in srgb, var(--media-scrim, var(--color-neutral-900)) 92%, transparent),
      color-mix(in srgb, var(--media-scrim, var(--color-neutral-900)) 70%, transparent) 55%,
      transparent
    );
  }

  .org-hero__frame-meta {
    font-size: var(--text-sm);
    color: var(--color-player-text-secondary);
  }

  .org-hero .org-hero__frame-title {
    font-family: var(--font-heading);
    font-weight: var(--heading-weight, var(--font-semibold));
    font-size: calc(var(--text-4xl) * var(--_fit));
    line-height: var(--leading-display);
    letter-spacing: var(--tracking-tight);
    color: var(--_ink-strong);
    text-wrap: balance;
  }

  .org-hero__frame-line {
    max-width: 38ch;
    font-size: var(--text-base);
    line-height: var(--leading-relaxed);
    color: var(--color-player-text-secondary);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .org-hero__frame-go {
    margin-top: var(--space-2);
    padding: var(--space-2) var(--space-5);
    border: var(--border-width) var(--border-style) color-mix(in srgb, var(--color-player-text) 45%, transparent);
    border-radius: var(--radius-button);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-player-text);
    transition: background-color var(--duration-normal) var(--ease-default), border-color var(--duration-normal) var(--ease-default);
  }

  .org-hero__frame:hover .org-hero__frame-go {
    background: color-mix(in srgb, var(--color-player-text) 14%, transparent);
    border-color: var(--color-player-text);
  }

  .org-hero__media {
    position: relative;
    align-self: stretch;
    min-height: 60%;
    overflow: hidden;
    border-radius: calc(var(--radius-card) * 1.5);
  }

  .org-hero__media img { width: 100%; height: 100%; object-fit: cover; display: block; }

  @media (--breakpoint-md) {
    /* FOOTAGE BLEEDS. No box and no margin: the film fills the hero's far side
       top to bottom and out to the page edge, and dissolves into the ground
       under the words, so it reads as the scene the words stand in. The inner
       steps out of being the frame's containing block so the frame can reach
       the section's edges; the words stay in the container's grid. */
    .org-hero[data-comp='showcase'][data-frame='wide'] .org-hero__inner { position: static; }
    .org-hero[data-comp='showcase'][data-frame='wide'] .org-hero__words { position: relative; z-index: 1; }
    /* the film: the words centre on the hero's height, and so does the film's
       call, so the two halves share one horizontal axis */
    .org-hero[data-media='film'] .org-hero__inner {
      align-content: center;
      padding-block: var(--space-16);
    }
    /* the call sits in the middle of the picture's VISIBLE part (the mask
       dissolves the frame's first 42%) */
    .org-hero__frame--film .org-hero__film-call { inset-inline-start: 42%; }
    .org-hero__frame[data-shape='wide'] {
      inset: 0 0 0 auto;
      width: 66%;
      max-width: none;
      aspect-ratio: auto;
      border-radius: 0;
      box-shadow: none;
      background: none;
    }
    .org-hero__frame[data-shape='wide'] .org-hero__frame-art {
      mask-image:
        linear-gradient(to right, transparent, black 42%),
        linear-gradient(to top, transparent, black 22%);
      mask-composite: intersect;
    }
    /* the scrim rides inside the masked art, so it dissolves with the picture
       instead of drawing a dark band across the ground under the words */
    .org-hero__frame[data-shape='wide'] .org-hero__frame-art::after {
      content: '';
      position: absolute;
      inset: 0;
      background:
        linear-gradient(
          to top,
          color-mix(in srgb, var(--media-scrim, var(--color-neutral-900)) 88%, transparent),
          color-mix(in srgb, var(--media-scrim, var(--color-neutral-900)) 30%, transparent) 45%,
          transparent 70%
        ),
        color-mix(in srgb, var(--media-scrim, var(--color-neutral-900)) 18%, transparent);
    }
    .org-hero__frame[data-shape='wide'] .org-hero__frame-play { inset: 0 0 40% 30%; height: auto; }
    .org-hero__frame[data-shape='wide'] .org-hero__frame-play :global(svg) {
      width: var(--space-8);
      height: var(--space-8);
      padding: var(--space-8);
    }
    .org-hero__frame[data-shape='wide'] .org-hero__frame-caption {
      inset: auto var(--space-10) var(--space-12) auto;
      width: min(30rem, 72%);
      padding: 0;
      background: none;
    }

    /* A STATEMENT'S SHELF IS A WALL. The latest pieces stand over the hero's
       far side as one mosaic, as tall as the hero: the first large, the next
       two stacked beside it. Placed, so it never makes the hero taller and the
       fit check never trims it away. */
    .org-hero[data-comp='statement'][data-proof='shelf'] .org-hero__words { max-width: min(46rem, 52%); }
    .org-hero[data-comp='statement'][data-proof='shelf'] .org-hero__shelf,
    .org-hero:global([data-trim])[data-comp='statement'][data-proof='shelf'] .org-hero__shelf {
      position: absolute;
      inset-block: var(--space-10) var(--space-12);
      inset-inline-end: var(--space-6);
      width: 42%;
      display: grid;
      grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
      grid-template-rows: repeat(2, minmax(0, 1fr));
      gap: var(--space-3);
    }
    .org-hero[data-align='end'][data-comp='statement'][data-proof='shelf'] .org-hero__shelf {
      inset-inline: var(--space-6) auto;
    }
    .org-hero[data-comp='statement'][data-proof='shelf'] .org-hero__shelf li:first-child { grid-row: span 2; }
    .org-hero[data-comp='statement'][data-proof='shelf'] .org-hero__shelf li:only-child { grid-column: span 2; }
    .org-hero[data-comp='statement'][data-proof='shelf'] .org-hero__shelf li:first-child:nth-last-child(2) ~ li { grid-row: span 2; }
    .org-hero[data-comp='statement'][data-proof='shelf'] .org-hero__shelf a {
      position: relative;
      height: 100%;
      overflow: hidden;
      isolation: isolate;
      border-radius: var(--radius-card);
      align-content: end;
      padding: var(--space-5);
    }
    .org-hero[data-comp='statement'][data-proof='shelf'] .org-hero__shelf-thumb {
      position: absolute;
      inset: 0;
      z-index: -1;
      aspect-ratio: auto;
      border-radius: 0;
      box-shadow: none;
    }
    .org-hero[data-comp='statement'][data-proof='shelf'] .org-hero__shelf-thumb::after {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(to top, color-mix(in srgb, var(--media-scrim, var(--color-neutral-900)) 85%, transparent), transparent 55%);
    }
    .org-hero[data-comp='statement'][data-proof='shelf'] .org-hero__shelf-text b {
      font-size: var(--text-lg);
      color: var(--color-player-text);
    }
    .org-hero[data-comp='statement'][data-proof='shelf'] .org-hero__shelf li:first-child .org-hero__shelf-text b {
      font-size: var(--text-2xl);
    }
    .org-hero[data-comp='statement'][data-proof='shelf'] .org-hero__shelf-text small {
      color: var(--color-player-text-secondary);
    }
  }

  /* ── fit check trims ─────────────────────────────────────────────────── */
  .org-hero:global([data-trim]) .org-hero__micro,
  .org-hero:global([data-trim]) .org-hero__facts,
  .org-hero:global([data-trim]) .org-hero__shelf { display: none; }
  .org-hero:global([data-trim='2']) .org-hero__line,
  .org-hero:global([data-trim='2']) .org-hero__search { display: none; }

  /* ── entrance ────────────────────────────────────────────────────────── */
  .org-hero[data-entrance='rise'] .org-hero__in,
  .org-hero[data-entrance='reveal'] .org-hero__in:not(.org-hero__title) {
    animation: org-hero-rise var(--duration-slowest) var(--ease-smooth) backwards;
    animation-delay: calc(var(--_i, 0) * var(--duration-fast) * 0.6);
  }
  .org-hero[data-entrance='reveal'] .org-hero__title {
    animation: org-hero-reveal var(--duration-slowest) var(--ease-smooth) backwards;
  }
  .org-hero[data-entrance='fade'] .org-hero__in {
    animation: org-hero-fade var(--duration-slowest) var(--ease-out) backwards;
    animation-delay: calc(var(--_i, 0) * var(--duration-fast) * 0.4);
  }
  .org-hero[data-entrance] .org-hero__media {
    animation: org-hero-fade var(--duration-slowest) var(--ease-out) backwards;
    animation-delay: var(--duration-normal);
  }
  /* The one orchestrated moment: the frame opens upward from its base, the
     picture settles into it, then its caption arrives. */
  .org-hero[data-entrance] .org-hero__frame {
    animation: org-hero-open calc(var(--duration-slowest) * 1.6) var(--ease-smooth) backwards;
  }
  .org-hero[data-entrance] .org-hero__frame-art img {
    animation: org-hero-settle calc(var(--duration-slowest) * 3) var(--ease-out) backwards;
  }
  .org-hero[data-entrance] .org-hero__frame-caption {
    animation: org-hero-fade var(--duration-slowest) var(--ease-out) backwards;
    animation-delay: var(--duration-slowest);
  }
  .org-hero[data-entrance='none'] .org-hero__in,
  .org-hero[data-entrance='none'] .org-hero__frame,
  .org-hero[data-entrance='none'] .org-hero__frame-art img,
  .org-hero[data-entrance='none'] .org-hero__frame-caption,
  .org-hero[data-entrance='none'] .org-hero__media,
  .org-hero[data-film-open] .org-hero__in {
    animation: none;
  }

  @keyframes org-hero-open { from { clip-path: inset(100% 0 0 0); } to { clip-path: inset(0); } }
  @keyframes org-hero-settle { from { transform: scale(1.12); } }
  @keyframes org-hero-rise { from { opacity: 0; transform: translateY(var(--space-4)); } }
  @keyframes org-hero-reveal { from { clip-path: inset(0 0 100% 0); transform: translateY(var(--space-3)); } to { clip-path: inset(0 0 -10% 0); } }
  @keyframes org-hero-fade { from { opacity: 0; } }
  @keyframes org-hero-drift { from { transform: scale(1.04); } to { transform: scale(1.12) translate(-2%, -1.5%); } }

  /* ── phone ───────────────────────────────────────────────────────────── */
  @media (--below-md) {
    .org-hero[data-height='full'],
    .org-hero:global([data-raise='full']) { --_h: calc(100svh - var(--space-16)); }
    .org-hero[data-height='tall'],
    .org-hero:global([data-raise='tall']) { --_h: 72svh; }
    .org-hero[data-height='compact'] { --_h: 52svh; }

    .org-hero[data-comp] { --_tscale: 0.82; }
    /* the film leads on a phone: a whole screen, so the film AND a readable
       name both fit without the fit check shrinking the name to a caption */
    .org-hero[data-media='film'],
    .org-hero[data-media='film']:global([data-raise]) { --_h: calc(100svh - var(--space-16)); }
    .org-hero[data-comp='statement'] { --_tscale: 0.95; }

    .org-hero__inner {
      grid-template-columns: minmax(0, 1fr) !important;
      align-content: end;
      gap: var(--space-5);
      padding: var(--space-6) var(--space-4) var(--space-8);
    }

    .org-hero[data-comp='centre'] .org-hero__inner { align-content: center; }

    .org-hero[data-comp='showcase'] .org-hero__words,
    .org-hero[data-comp='split'] .org-hero__words,
    .org-hero[data-comp='statement'] .org-hero__words {
      justify-self: stretch;
      align-items: flex-start;
      text-align: left;
    }

    .org-hero[data-comp='statement'] .org-hero__actions,
    .org-hero[data-comp='statement'] .org-hero__facts {
      justify-content: flex-start;
    }

    .org-hero__actions { flex-wrap: nowrap; }
    .org-hero__btn--main { flex: 1; justify-content: center; min-width: 0; }
    .org-hero[data-bstyle='link'] .org-hero__btn--main { flex: none; }
    .org-hero__btn--film { padding: var(--space-1); }
    .org-hero__film-label,
    .org-hero__btn--ghost { display: none; }

    /* Phone showcase: the frame leads, the words follow beneath it. The frame
       is the picture here, so the logo (already in the header) steps aside. */
    .org-hero[data-comp='showcase'] .org-hero__inner {
      align-content: space-between;
      padding-block: var(--space-4) var(--space-8);
    }
    /* with a frame, it takes every row the words don't need: no dead gap */
    .org-hero[data-comp='showcase'][data-frame] .org-hero__inner {
      grid-template-rows: minmax(calc(var(--_h) * 0.5), 1fr) auto;
      align-content: stretch;
    }
    /* [data-frame] matches the desktop wide-frame rules' specificity, which
       would otherwise squeeze the words to 38% on a phone */
    .org-hero[data-comp='showcase'] .org-hero__words,
    .org-hero[data-comp='showcase'][data-frame] .org-hero__words { max-width: none; }
    .org-hero[data-comp='showcase'][data-frame] { --_tscale: 0.82; }
    .org-hero[data-comp='showcase'] .org-hero__logo { display: none; }
    .org-hero[data-comp='showcase'] .org-hero__line {
      display: -webkit-box;
      -webkit-line-clamp: 4;
      line-clamp: 4;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .org-hero__frame,
    .org-hero[data-align='end'][data-comp='showcase'] .org-hero__frame {
      position: relative;
      inset: auto;
      order: -1;
      width: 100%;
      max-width: none;
      /* stretches in its grid row (see the inner above) */
      height: auto;
      aspect-ratio: auto;
      max-height: none;
    }
    /* footage runs edge to edge and dissolves into the ground under it */
    .org-hero__frame[data-shape='wide'] .org-hero__frame-art {
      mask-image: linear-gradient(to top, transparent, black 32%);
    }
    .org-hero__frame--film .org-hero__frame-art::after {
      content: '';
      position: absolute;
      inset: 0;
      background: color-mix(in srgb, var(--media-scrim, var(--color-neutral-900)) 18%, transparent);
    }
    .org-hero__frame--film { box-shadow: none; background: none; }
    .org-hero__frame[data-shape='wide'] {
      width: calc(100% + var(--space-4) * 2);
      margin-inline: calc(var(--space-4) * -1);
      border-radius: 0;
    }
    /* on a phone the frame carries only its title and the way in, so the
       picture stays the picture */
    .org-hero__frame-caption {
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: end;
      padding: var(--space-12) var(--space-4) var(--space-4);
    }
    .org-hero__frame-meta,
    .org-hero__frame-line { display: none; }
    .org-hero .org-hero__frame-title { font-size: var(--text-xl); }
    .org-hero__frame-go { margin-top: 0; padding: var(--space-2) var(--space-3); }

    .org-hero[data-comp='split'] .org-hero__inner {
      padding-top: 0;
      align-content: start;
    }
    .org-hero[data-comp='split'] .org-hero__media {
      order: -1 !important;
      height: 40svh;
      margin-inline: calc(var(--space-4) * -1);
      border-radius: 0;
    }

    .org-hero[data-comp='showcase'] .org-hero__shelf { display: none; }
    /* a real swipe row: the tile that peeks says "more", not "clipped" */
    .org-hero__shelf {
      display: flex;
      overflow-x: auto;
      scroll-snap-type: x mandatory;
      margin-inline: calc(var(--space-4) * -1);
      padding-inline: var(--space-4);
      scroll-padding-inline: var(--space-4);
      scrollbar-width: none;
    }
    .org-hero__shelf li { flex: 0 0 11rem; scroll-snap-align: start; }
  }
</style>
