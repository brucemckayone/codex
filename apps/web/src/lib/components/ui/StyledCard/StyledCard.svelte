<!--
  @component StyledCard

  The card styles' one card (Codex-7104r, plan D3). Every kind (video, audio,
  article, portal) in every layout (tile, row, featured) is this one markup,
  the card-styles gallery's, with its block class `.card` renamed `.sc`. An
  org's card style is a stylesheet scoped under `[data-card-style=<id>]`
  that hides, reorders or restyles these parts with CSS only.

  It decides nothing about content: `card` is final copy, made by the
  adapters in `$lib/card-styles/adapters.ts` from ContentCard's or
  JourneyEntryCard's props.

  ── ONE LINK ─────────────────────────────────────────────────────────────
  The title's `.sc__link` (an `<a>`, or a `<button>` for a card that opens
  something in place) is THE action; base.css stretches its `::after` over
  the card. It stretches over its containing block, so nothing between the
  link and `article.sc` may become one: no `position`, `filter`,
  `backdrop-filter` or `transform` on an ancestor of the link.

  `actions` (the library's own controls) and `accessAction` (a paused card's
  way back, D7) are separate destinations, so they are real controls in
  `.sc__controls`, raised above the stretched link. No style knows that
  class, so none hides it.

  ── DIALS ────────────────────────────────────────────────────────────────
  `vars` (the org's dial values, `--card-*`) go INLINE on `article.sc`, the
  only place that beats each style's own `[data-card-style=x] .sc { … }`
  defaults.
-->
<script lang="ts">
  import '$lib/styles/card-styles/base.css';
  import type { CardStyle } from '@codex/validation';
  import type { Snippet } from 'svelte';
  import * as m from '$paraglide/messages';
  import type { CardModel } from '$lib/card-styles/card-model';
  import { ArrowRightIcon, PauseIcon, PlayIcon } from '$lib/components/ui/Icon';

  interface Props {
    card: CardModel;
    style: CardStyle;
    /** The org's dial values for `style`: custom properties (`--card-*`). */
    vars?: Readonly<Record<string, string>>;
    /** The caller's own controls, drawn above the card's link. */
    actions?: Snippet;
    /** A paused card's way back (D7), drawn above the card's link. */
    accessAction?: { href: string; label: string };
    /**
     * The title's heading level in the page's outline: 3 under a section's
     * h2 (rails, grids), 2 where the cells sit straight under the page's h1
     * (the creators page), as each Today card already does.
     */
    headingLevel?: 2 | 3;
  }

  const {
    card,
    style,
    vars = {},
    actions,
    accessAction,
    headingLevel = 3,
  }: Props = $props();

  const uid = $props.id();
  const titleId = `${uid}-title`;

  /** More practices than this draw one bar, with a tick per practice. */
  const MAX_SEGMENTS = 16;
  const WAVE_BARS = 28;

  /**
   * A dial reaches the page as `name: value` text, so only a `--card-*` name
   * with a value that cannot close the declaration is written. The values
   * are checked against the dial registry on read (resolve.ts); this keeps
   * one more property from riding along if that ever slips.
   */
  const DIAL_NAME = /^--card-[a-z0-9-]+$/;
  const UNSAFE_VALUE = /[;{}<>]/;
  const varsStyle = $derived(
    Object.entries(vars)
      .filter(
        ([name, value]) =>
          DIAL_NAME.test(name) &&
          typeof value === 'string' &&
          value !== '' &&
          !UNSAFE_VALUE.test(value)
      )
      .map(([name, value]) => `${name}: ${value}`)
      .join('; ') || undefined
  );

  /** A stable waveform per title (FNV-1a), as AudioWaveform seeds by id. */
  function waveHeights(seed: string, bars: number): string[] {
    let hash = 2166136261;
    for (const ch of seed) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
    const heights: string[] = [];
    for (let i = 0; i < bars; i++) {
      hash = Math.imul(hash ^ i, 16777619);
      const swell = Math.sin((Math.PI * (i + 0.5)) / bars) ** 0.5;
      heights.push((0.25 + (((hash >>> 0) % 1000) / 1000) * 0.75 * swell).toFixed(2));
    }
    return heights;
  }

  const action = $derived(card.action);
  const glyph = $derived(
    card.kind === 'video' ? 'play' : card.kind === 'audio' ? 'wave' : 'initial'
  );
  const initial = $derived(card.title.trim().charAt(0).toUpperCase());
  const wave = $derived(glyph === 'wave' ? waveHeights(card.title, WAVE_BARS) : []);
  const meta = $derived(card.meta ?? []);

  const percent = $derived(
    card.progress
      ? Number.isFinite(card.progress.percent)
        ? Math.max(0, Math.min(100, Math.round(card.progress.percent)))
        : 0
      : null
  );
  const total = $derived(
    card.progress?.total && card.progress.total > 0
      ? Math.round(card.progress.total)
      : 0
  );
  const done = $derived(
    Math.max(0, Math.min(total, Math.floor(card.progress?.done ?? 0)))
  );
  const segmented = $derived(total > 0 && total <= MAX_SEGMENTS);
  const segments = $derived(Array.from({ length: segmented ? total : 0 }, (_, i) => i));
  const previewStages = $derived(
    !card.progress && card.preview && card.preview.stages > 0
      ? Math.round(card.preview.stages)
      : 0
  );
  const previewSegments = $derived(Array.from({ length: previewStages }, (_, i) => i));
  const progressLabel = $derived(m.card_progress_label({ title: card.title }));
</script>

<div class="sc-scope" data-card-style={style}>
  <article
    class="sc"
    data-kind={card.kind}
    data-layout={card.layout}
    data-access={card.access}
    data-owned={card.owned ? '' : undefined}
    data-dimmed={card.dimmed ? '' : undefined}
    data-progress={percent ?? undefined}
    data-complete={percent === 100 ? '' : undefined}
    data-noimage={card.image ? undefined : ''}
    style={varsStyle}
  >
    <div class="sc__media" data-ground="image" style:--card-img-ratio={card.image?.ratio}>
      {#if card.image}
        <img
          class="sc__backdrop"
          src={card.image.src}
          srcset={card.image.srcset}
          sizes={card.image.sizes}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
        />
        <img
          class="sc__img"
          src={card.image.src}
          srcset={card.image.srcset}
          sizes={card.image.sizes}
          alt=""
          loading="lazy"
          decoding="async"
        />
      {/if}
      <span class="sc__glyph" data-glyph={glyph} aria-hidden="true">
        {#if glyph === 'play'}
          <PlayIcon fill="currentColor" />
        {:else if glyph === 'wave'}
          <span class="sc__wave">
            {#each wave as height, i (i)}
              <i style:--h={height}></i>
            {/each}
          </span>
          <PlayIcon fill="currentColor" />
        {:else}
          <b>{initial}</b>
        {/if}
      </span>
    </div>

    {#if card.badge}
      <span class="sc__badge">
        {#if card.badge.paused}
          <PauseIcon fill="currentColor" />
        {/if}
        {card.badge.label}
      </span>
    {/if}

    <div class="sc__body">
      <p class="sc__kicker">{card.kicker}</p>
      <svelte:element this={`h${headingLevel}`} class="sc__title" id={titleId}>
        {#if 'href' in action}
          <a class="sc__link" href={action.href}>{card.title}</a>
        {:else}
          <button
            type="button"
            class="sc__link"
            onclick={action.onclick}
            aria-label={action.ariaLabel}
            aria-haspopup={action.hasPopup}
          >
            {card.title}
          </button>
        {/if}
      </svelte:element>

      {#if card.desc}
        <p class="sc__desc">{card.desc}</p>
      {/if}

      {#if meta.length > 0}
        <p class="sc__meta">
          {#each meta as item, i (i)}
            <span data-m={item.key}>
              {#if item.key === 'creator'}
                <span class="sc__avatar" aria-hidden="true">{item.text.charAt(0).toUpperCase()}</span>
                <span>{item.text}</span>
              {:else}
                {item.text}
              {/if}
            </span>
          {/each}
        </p>
      {/if}

      {#if card.note}
        <p class="sc__note">{card.note}</p>
      {/if}

      {#if card.progress && segmented}
        <div
          class="sc__track"
          style:--n={total}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label={progressLabel}
        >
          {#each segments as i (i)}
            {#if i < done}
              <span class="sc__seg" data-on data-graphic="fill" data-graphic-label="practice done"></span>
            {:else}
              <span
                class="sc__seg"
                data-current={i === done ? '' : undefined}
                data-graphic="border"
                data-graphic-label="practice to do"
              ></span>
            {/if}
          {/each}
        </div>
      {:else if card.progress}
        <div
          class="sc__track"
          data-bar
          data-ticks={total > 0 ? '' : undefined}
          style:--n={total > 0 ? total : undefined}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label={progressLabel}
        >
          <span data-graphic="fill" data-graphic-label="progress fill" style:inline-size="{percent}%"></span>
        </div>
      {:else if previewStages > 0}
        <div class="sc__track" data-preview style:--n={previewStages} aria-hidden="true">
          {#each previewSegments as i (i)}
            <span class="sc__seg"></span>
          {/each}
        </div>
      {/if}

      <div class="sc__foot">
        {#if card.price}
          <span class="sc__price">{card.price}</span>
        {/if}
        {#if card.progress?.label}
          <span class="sc__status">{card.progress.label}</span>
        {/if}
        <span class="sc__cta">
          <span class="sc__cta-label">{card.cta}</span>
          <ArrowRightIcon />
        </span>
      </div>

      {#if accessAction || actions}
        <div class="sc__controls">
          {#if accessAction}
            <a class="sc__access" href={accessAction.href} aria-describedby={titleId}>
              {accessAction.label}
            </a>
          {/if}
          {#if actions}
            {@render actions()}
          {/if}
        </div>
      {/if}
    </div>
  </article>
</div>

<style>
  /* The wrapper carries the style's scope, and it is a REAL box: the page's
     cell sizes the card through its own child (`.creators__cell > *
     { inline-size: 100% }`), and a `display: contents` box ignores that.
     The article itself cannot size from its content (base.css makes it an
     inline-size container, whose intrinsic width is zero), so it fills this
     one-cell grid in both axes: the cell's width, and the rail track's
     height for equal-height rails. No position or filter here, so the
     stretched link's containing block stays the article. */
  .sc-scope {
    display: grid;
    min-inline-size: 0;
  }

  /* A button as the card's one action reads as its title, as the link does.
     Zero specificity, so a style's title rules still win. */
  /* base.css resets an h3 title's margin; an h2 title (headingLevel 2)
     gets the same zero-specificity reset, so every style's title rules win. */
  :where(h2.sc__title) {
    margin: 0;
  }

  :where(button.sc__link) {
    appearance: none;
    margin: 0;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    letter-spacing: inherit;
    text-align: inherit;
    text-transform: inherit;
    cursor: pointer;
  }

  /* Above the stretched link (z 1) and any style's z-2 chrome, as a sibling
     of the link's ancestors, never one of them. */
  .sc__controls {
    position: relative;
    z-index: 3;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .sc__access {
    display: inline-flex;
    align-items: center;
    min-block-size: var(--space-6);
    padding-inline: var(--space-3);
    border: var(--border-width) var(--border-style) currentColor;
    border-radius: var(--radius-full);
    color: inherit;
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    line-height: var(--leading-tight);
    text-decoration: none;
  }

  @media (hover: hover) {
    .sc__access:hover {
      background: color-mix(in oklab, currentColor 12%, transparent);
    }
  }

  .sc__access:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset);
  }
</style>
