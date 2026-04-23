<!--
  @component ContentCard

  Unified content card for all contexts: browse grids, library lists, featured
  sections, compact sidebars, and continue-watching carousels.

  @prop {'grid' | 'list' | 'featured' | 'compact' | 'resume'} variant - Layout variant
  @prop {'default' | 'row'} layout - Layout mode override. 'row' is an
        additive horizontal-row treatment currently used by `contentType='audio'`
        cards to read as a music-app playlist row (album art left, title +
        waveform strip + meta stacked right). Leaves other variants/content
        types untouched so existing callers keep their vertical-tile look.
  @prop {string} id - Unique content identifier
  @prop {string} title - Content title
  @prop {string} thumbnail - Thumbnail image URL
  @prop {string} description - Content description (shown in 'featured' variant only)
  @prop {'video' | 'audio' | 'article'} contentType - Type of content
  @prop {number} duration - Duration in seconds
  @prop {{ username?; displayName?; avatar? }} creator - Creator info (shown in grid/featured)
  @prop {Snippet} actions - Custom action buttons
  @prop {string} href - Link URL
  @prop {boolean} loading - Show skeleton loading state
  @prop {object | null} progress - Playback progress data
  @prop {{ amount; currency } | null} price - Price info (null = hidden, 0 = Free)
  @prop {boolean} purchased - Whether user has purchased this content
  @prop {boolean} included - Whether user's subscription/membership covers this content
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import * as m from '$paraglide/messages';
  import { getThumbnailSrcset, DEFAULT_SIZES } from '$lib/utils/image';
  import { formatDuration, formatDurationHuman } from '$lib/utils/format';
  import { calculateProgressPercent } from '$lib/utils/progress';
  import { Avatar, AvatarImage, AvatarFallback } from '../Avatar';
  import { Skeleton } from '../Skeleton';
  import { PriceBadge } from '../PriceBadge';
  import { PlayIcon, MusicIcon, FileTextIcon } from '$lib/components/ui/Icon';
  import { extractPlainText } from '@codex/validation';
  import AudioWaveform from './AudioWaveform.svelte';

  /**
   * Format a duration (in seconds) as a human-readable reading-time label
   * — `"5 min read"`, `"1 hr 10 min read"`, `"1 hr read"`. Returns an empty
   * string for falsy input so callers can `{#if readTime}` guard.
   *
   * Local to ContentCard rather than shared from `$lib/utils/format`
   * because `formatDurationHuman` returns terse `5m` / `1h 5m` forms that
   * read as playback duration, not reading time. Article cards benefit
   * from the verbose `min read` suffix — it signals intent.
   */
  function formatReadTime(seconds: number | null | undefined): string {
    if (!seconds || seconds <= 0) return '';
    const totalMinutes = Math.max(1, Math.round(seconds / 60));
    if (totalMinutes < 60) return `${totalMinutes} min read`;
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    if (mins === 0) return `${hours} hr read`;
    return `${hours} hr ${mins} min read`;
  }

  interface Props extends HTMLAttributes<HTMLDivElement> {
    variant?: 'grid' | 'list' | 'featured' | 'compact' | 'resume';
    /**
     * Additive layout mode. 'row' swaps the card to a horizontal treatment
     * (album art on the left, title + waveform strip + meta stacked on the
     * right). Currently only audio uses it — callers must opt in explicitly
     * so existing grid/list/compact usages keep the vertical-tile shape.
     */
    layout?: 'default' | 'row';
    id: string;
    title: string;
    thumbnail?: string | null;
    description?: string | null;
    contentType?: 'video' | 'audio' | 'article';
    duration?: number | null;
    creator?: {
      username?: string;
      displayName?: string;
      avatar?: string | null;
    };
    actions?: Snippet;
    href?: string;
    loading?: boolean;
    progress?: {
      positionSeconds?: number;
      durationSeconds?: number;
      completed?: boolean;
      percentComplete?: number;
    } | null;
    price?: {
      amount: number;
      currency: string;
    } | null;
    purchased?: boolean;
    included?: boolean;
    /** Content-level access strategy from DB (forwarded to PriceBadge) */
    contentAccessType?: 'free' | 'paid' | 'followers' | 'subscribers' | 'team' | null;
    /** Whether the user follows this org (contextualizes followers badge) */
    isFollower?: boolean;
    /** Resolved tier name for subscriber-gated content */
    tierName?: string | null;
    /** Content category (shown as overlay tag on thumbnail) */
    category?: string | null;
    /**
     * Subscription-backed access state for library surfaces (Codex-k7ppt).
     *
     * Only library/continue-watching consumers set this. Browse grids leave
     * it undefined and get the existing visual treatment.
     *
     *   'active'     — no change
     *   'cancelling' — corner 'Ends {date}' badge, card still fully accessible
     *   'past_due'   — dimmed card + hover CTA 'Payment failed — update payment'
     *   'revoked'    — dimmed card + hover CTA 'Subscription ended — reactivate'
     */
    accessState?: 'active' | 'cancelling' | 'past_due' | 'revoked';
    /** ISO period-end date, paired with accessState='cancelling' for the badge copy. */
    accessStatePeriodEnd?: string | null;
    /** Destination for the reactivate/update-payment affordance. Defaults to /account/subscriptions. */
    accessStateActionHref?: string;
    /**
     * Forces the thumbnail to a single uniform aspect ratio, overriding the
     * per-content-type defaults (audio 1:1, article 3:2, video 16:9). Set
     * true on mixed-type carousels (Free samples, per-category) so a row of
     * cards reads as one rhythm instead of a jagged mix of tile shapes.
     * Pure-type sections leave this undefined and keep natural ratios.
     */
    normalizeRatio?: boolean;
  }

  const {
    variant = 'grid',
    layout = 'default',
    id,
    title,
    thumbnail,
    description,
    contentType = 'video',
    duration,
    creator,
    actions,
    href = '#',
    loading = false,
    progress = null,
    price = null,
    purchased = false,
    included = false,
    contentAccessType = null,
    isFollower = false,
    tierName = null,
    category = null,
    accessState = 'active',
    accessStatePeriodEnd = null,
    accessStateActionHref = '/account/subscriptions',
    normalizeRatio = false,
    class: className,
    ...rest
  }: Props = $props();

  const titleId = $derived(`cc-title-${id}`);
  const profileHref = $derived(creator?.username ? `/@${creator.username}` : '#');
  const progressPercent = $derived(calculateProgressPercent(progress));
  const hasProgress = $derived(progress != null && (progress.completed || progressPercent > 0));
  const isCompleted = $derived(progress?.completed ?? false);

  const resumeTime = $derived(formatDuration(progress?.positionSeconds ?? 0));

  // Audio-row layout: horizontal ("music playlist row") treatment. Only
  // activates when the caller explicitly opts in via `layout='row'` AND
  // the content is audio, so grid/list/compact audio callers are unaffected.
  const isAudioRow = $derived(layout === 'row' && contentType === 'audio');

  const isArticle = $derived(contentType === 'article');

  // Audio-row renders a compact creator · duration meta inline, so the
  // stacked creator row/avatar is suppressed to avoid duplication. Articles
  // render a compact text byline in the meta row, so we suppress the avatar
  // row there too.
  const showCreator = $derived(
    (variant === 'grid' || variant === 'featured') && !isAudioRow && !isArticle
  );
  // Description lives under the title in vertical tiles. For audio-row the
  // waveform + meta already fill that slot. Articles are text-led and
  // always carry an excerpt regardless of variant so readers can judge
  // each card before clicking.
  const showDescription = $derived(
    !!description && !isAudioRow && (variant === 'featured' || variant === 'grid' || isArticle)
  );
  const showPriceBadge = $derived(
    variant !== 'compact' && variant !== 'resume' &&
    (price != null || purchased || included || contentAccessType != null)
  );
  const showResumeInfo = $derived(variant === 'resume');

  // ── Article editorial treatment ──────────────────────────────────────
  // Every article card — in every surface — carries the same triad:
  //   • ARTICLE · Category head-line above the title
  //   • plain-text excerpt (160-char cap, matches ArticleEditorial)
  //   • byline (creator name) + read-time meta line
  // Keeps parity with ArticleEditorial secondary rows while letting the
  // shared card primitive express the same editorial intent.
  const articleExcerpt = $derived.by(() => {
    if (!isArticle || !description) return '';
    const plain = extractPlainText(description);
    return plain.length > 160 ? plain.slice(0, 157).trimEnd() + '…' : plain;
  });
  const articleReadTime = $derived(isArticle ? formatReadTime(duration) : '');
  const articleByline = $derived(
    isArticle ? (creator?.displayName ?? creator?.username ?? '') : ''
  );
  const showArticleMeta = $derived(isArticle && (!!articleByline || !!articleReadTime));

  // ── Media-type kind-line ─────────────────────────────────────────────
  // `TYPE · Category` small-caps head-line shown above the title on every
  // non-compact, non-resume, non-audio-row, non-featured card. Generalises
  // the article-only treatment so audio and video cards carry the same
  // typographic signal (parity). Palette stays neutral — no coloured pill,
  // no per-type accent colour (R12 neutrality; see
  // feedback_neutral_card_palette.md).
  const kindTypeLabel = $derived.by(() => {
    if (contentType === 'audio') return 'AUDIO';
    if (contentType === 'video') return 'VIDEO';
    if (contentType === 'article') return 'ARTICLE';
    return '';
  });
  const kindLabel = $derived(
    kindTypeLabel ? (category ? `${kindTypeLabel} \u00B7 ${category}` : kindTypeLabel) : ''
  );
  // Featured variant already carries full metadata in its overlay body
  // (description + creator), so suppressing the kind-line avoids visual
  // duplication against the eyebrow-style hierarchy already in play.
  // Audio-row has its own `.cc__audio-meta` treatment. Compact + resume
  // deliberately strip non-essential copy.
  const showKindLine = $derived(
    !!kindTypeLabel &&
      variant !== 'compact' &&
      variant !== 'resume' &&
      variant !== 'featured' &&
      !isAudioRow
  );

  // ── Access-state decoration (Codex-k7ppt) ─────────────────────────────
  // Cancelling: card stays fully interactive; small corner badge.
  // past_due / revoked: card is dimmed + hover CTA overlay.
  const isDimmed = $derived(
    accessState === 'past_due' || accessState === 'revoked'
  );
  const accessCtaLabel = $derived(
    accessState === 'past_due'
      ? m.library_access_payment_failed()
      : accessState === 'revoked'
        ? m.library_access_subscription_ended()
        : ''
  );
  // Format the period-end date for the 'Ends {date}' badge using the
  // user's locale. Short form keeps the badge compact.
  const cancellingBadgeText = $derived.by(() => {
    if (accessState !== 'cancelling' || !accessStatePeriodEnd) return '';
    const d = new Date(accessStatePeriodEnd);
    if (Number.isNaN(d.getTime())) return '';
    const formatted = d.toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
    });
    return m.library_access_ends_on({ date: formatted });
  });
</script>

<article
  class="cc {className ?? ''}"
  class:cc--loading={loading}
  class:cc--access-dimmed={isDimmed}
  class:cc--audio-row={isAudioRow}
  data-variant={variant}
  data-layout={layout !== 'default' ? layout : undefined}
  data-content-type={contentType || undefined}
  data-normalize-ratio={normalizeRatio || undefined}
  data-access-state={accessState !== 'active' ? accessState : undefined}
  aria-labelledby={!loading ? titleId : undefined}
  {...rest}
>
  {#if loading}
    <div class="cc__thumb cc__thumb--skeleton">
      <Skeleton width="100%" height="100%" />
    </div>
    <div class="cc__body">
      <Skeleton width="75%" height="1.25rem" />
      <Skeleton width="50%" height="1rem" />
      <Skeleton width="60%" height="1rem" />
    </div>
  {:else}
    <!-- Full-card click overlay (invisible, not focusable) -->
    <a href={href} class="cc__link" tabindex="-1" aria-hidden="true">
      <span class="sr-only">{m.content_view({ title })}</span>
    </a>

    <!-- Thumbnail -->
    <div class="cc__thumb">
      {#if thumbnail}
        <img
          src={thumbnail}
          srcset={getThumbnailSrcset(thumbnail)}
          sizes={DEFAULT_SIZES}
          alt={m.content_thumbnail_alt({ title })}
          loading="lazy"
          decoding="async"
          class="cc__image"
          onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; (e.currentTarget as HTMLImageElement).nextElementSibling?.classList.remove('hidden'); }}
        />
        <div class="cc__placeholder hidden">
          {#if contentType === 'video'}
            <PlayIcon size={32} />
          {:else if contentType === 'audio'}
            <!-- Audio fallback when the real thumbnail fails to load.
                 A prominent waveform stands in for missing album art so
                 audio cards ALWAYS carry an audio signature — either the
                 real thumbnail, or this waveform tile. -->
            <AudioWaveform {id} variant="thumb" class="cc__thumb-waveform" />
          {:else}
            <FileTextIcon size={32} />
          {/if}
        </div>
      {:else}
        <div class="cc__placeholder">
          {#if contentType === 'video'}
            <PlayIcon size={32} />
          {:else if contentType === 'audio'}
            <!-- Audio with no thumbnail — see the fallback comment above. -->
            <AudioWaveform {id} variant="thumb" class="cc__thumb-waveform" />
          {:else}
            <FileTextIcon size={32} />
          {/if}
        </div>
      {/if}

      <!-- Duration — small editorial caption in bottom-right of the image -->
      {#if duration && variant !== 'resume'}
        <span class="cc__duration" aria-label="{m.content_duration()}: {formatDurationHuman(duration)}">
          {formatDurationHuman(duration)}
        </span>
      {/if}

      <!-- Price badge (top-right) -->
      {#if showPriceBadge}
        <PriceBadge
          amount={price?.amount ?? null}
          currency={price?.currency ?? 'GBP'}
          {purchased}
          {included}
          accessType={contentAccessType}
          {isFollower}
          {tierName}
          class="cc__price-badge"
        />
      {/if}

      <!-- Progress bar (bottom of thumbnail) -->
      {#if hasProgress}
        <div
          class="cc__progress-track"
          role="progressbar"
          aria-valuenow={progressPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Watch progress"
        >
          <div
            class="cc__progress-fill"
            class:cc__progress-fill--completed={isCompleted}
            style="width: {progressPercent}%"
          ></div>
        </div>
      {/if}

      <!-- Access state: cancelling badge (top-left corner of thumbnail) -->
      {#if accessState === 'cancelling' && cancellingBadgeText}
        <span class="cc__access-badge" aria-label={cancellingBadgeText}>
          {cancellingBadgeText}
        </span>
      {/if}
    </div>

    <!-- Access state: hover/tap CTA for past_due / revoked -->
    {#if isDimmed}
      <a
        class="cc__access-cta"
        href={accessStateActionHref}
        data-access-cta={accessState}
      >
        {accessCtaLabel}
      </a>
    {/if}

    <!-- Body -->
    <div class="cc__body">
      {#if showKindLine}
        <!-- Media-type head-line — `AUDIO · Category` / `VIDEO · Category`
             / `ARTICLE · Category`. Small-caps text with a small leading
             icon inheriting currentColor; no coloured pill (R12 neutrality).
             Replaces the generic eyebrow so every catalogue card carries
             a consistent type signal — structural aspect ratio + this
             typographic label — regardless of whether a category is set. -->
        <p class="cc__kind">
          {#if contentType === 'audio'}
            <MusicIcon size={12} class="cc__kind-icon" />
          {:else if contentType === 'video'}
            <PlayIcon size={12} class="cc__kind-icon" />
          {:else if contentType === 'article'}
            <FileTextIcon size={12} class="cc__kind-icon" />
          {/if}
          <span>{kindLabel}</span>
        </p>
      {:else if category && variant !== 'compact' && variant !== 'resume'}
        <p class="cc__eyebrow">{category}</p>
      {/if}
      <h3 class="cc__title" id={titleId}>
        <a href={href}>{title}</a>
      </h3>

      {#if isAudioRow}
        <!-- Decorative waveform strip — signals "this is audio" at a glance.
             Seeded by content id so each row looks distinct but is stable
             across SSR/client hydration (AudioWaveform uses FNV-1a). -->
        <AudioWaveform {id} class="cc__waveform" />

        {#if creator?.displayName || creator?.username || duration}
          <p class="cc__audio-meta">
            {#if creator?.displayName || creator?.username}
              <span class="cc__audio-meta-creator">
                {creator.displayName ?? creator.username}
              </span>
            {/if}
            {#if (creator?.displayName || creator?.username) && duration}
              <span class="cc__audio-meta-sep" aria-hidden="true">·</span>
            {/if}
            {#if duration}
              <span class="cc__audio-meta-duration">{formatDurationHuman(duration)}</span>
            {/if}
          </p>
        {/if}
      {/if}

      {#if showDescription}
        <p class="cc__description">
          {isArticle ? articleExcerpt : extractPlainText(description)}
        </p>
      {/if}

      {#if showArticleMeta}
        <p class="cc__article-meta">
          {#if articleByline}
            <span class="cc__article-byline">{articleByline}</span>
          {/if}
          {#if articleByline && articleReadTime}
            <span class="cc__article-sep" aria-hidden="true">·</span>
          {/if}
          {#if articleReadTime}
            <span class="cc__article-read-time">{articleReadTime}</span>
          {/if}
        </p>
      {/if}

      <!-- Body-level meta line was removed — duration already appears on
           the thumbnail, and the content type is self-evident from the
           title + thumbnail context. Kept the `showMetadata` derivation
           in case future variants want it back. -->

      {#if showResumeInfo}
        <p class="cc__resume-text">{m.library_resume_from({ time: resumeTime })}</p>
        <span class="cc__resume-pill">
          <PlayIcon size={14} />
          {m.library_resume()}
        </span>
      {/if}

      {#if showCreator && creator}
        <div class="cc__creator">
          <a href={profileHref} class="cc__creator-link">
            <Avatar src={creator.avatar} class="cc__creator-avatar">
              <AvatarImage src={creator.avatar} alt={creator.displayName ?? 'Creator'} />
              <AvatarFallback>{creator.displayName?.charAt(0).toUpperCase() ?? '?'}</AvatarFallback>
            </Avatar>
            <span class="cc__creator-name">
              {creator.displayName ?? creator.username ?? '?'}
            </span>
          </a>
        </div>
      {/if}
    </div>

    {#if actions}
      <div class="cc__actions">{@render actions()}</div>
    {/if}
  {/if}
</article>

<style>
  /* ═══════════════════════════════════════════
     BASE CARD
     ═══════════════════════════════════════════ */

  .cc {
    position: relative;
    display: flex;
    flex-direction: column;
    /* Card surface — slightly translucent for depth against blurred backgrounds.
       backdrop-filter removed: parent .content-area already blurs the shader,
       so per-card blur was redundant GPU work (6+ blur layers on landing page). */
    background: color-mix(in srgb, var(--color-surface-card) 96%, transparent);
    border: var(--border-width) var(--border-style) color-mix(in srgb, var(--color-border) 50%, transparent);
    border-radius: var(--radius-xl);
    /* Padding around the thumbnail — creates soft inset image */
    padding: var(--space-2);
    overflow: hidden;
    transition:
      transform var(--duration-slow) var(--ease-smooth),
      box-shadow var(--duration-slow) var(--ease-smooth),
      border-color var(--duration-fast) var(--ease-default);
  }

  .cc:hover,
  .cc:focus-within:has(:focus-visible) {
    border-color: color-mix(in srgb, var(--color-border) 70%, transparent);
    box-shadow: var(--shadow-lg);
    transform: translateY(calc(-1 * var(--space-0-5))) scale(var(--card-hover-scale, 1.02));
    z-index: 2;
  }

  .cc:focus-within:has(:focus-visible) {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .cc--loading {
    pointer-events: none;
  }

  /* Full-card click overlay */
  .cc__link {
    position: absolute;
    inset: 0;
    z-index: 1;
  }

  /* ═══════════════════════════════════════════
     THUMBNAIL
     ═══════════════════════════════════════════ */

  .cc__thumb {
    position: relative;
    aspect-ratio: 16 / 9;
    background: var(--color-surface-secondary);
    overflow: hidden;
    flex-shrink: 0;
    /* Rounded corners on the image — soft inset look */
    border-radius: var(--radius-lg);
  }

  .cc__thumb--skeleton {
    background: var(--color-surface);
    border-radius: var(--radius-lg);
  }

  .cc__image {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform var(--duration-slower) var(--ease-smooth);
  }

  /* Inner image zoom on card hover */
  .cc:hover .cc__image {
    transform: scale(var(--card-image-hover-scale, 1.05));
  }

  /* `.hidden` on a placeholder must win over the default `display: flex`
     below. Original codebase relied on source-order specificity which
     broke once we started rendering full-size content in the placeholder
     — the `.cc__placeholder { display: flex }` below took precedence and
     the hidden placeholder leaked into the layout. Using an attribute
     fallback keeps the specificity match explicit. */
  .cc__placeholder.hidden {
    display: none;
  }

  .cc__placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    color: var(--color-text-muted);
    background: var(--color-surface-secondary);
  }

  /*
    Duration — small editorial caption in the bottom-right of the image.
    Translucent dark scrim + backdrop blur keeps it legible over any
    thumbnail without feeling like a loud SaaS pill.
  */
  .cc__duration {
    position: absolute;
    bottom: var(--space-2);
    right: var(--space-2);
    padding: var(--space-0-5) var(--space-2);
    background: color-mix(in srgb, var(--color-neutral-900) 70%, transparent);
    backdrop-filter: blur(var(--blur-sm));
    -webkit-backdrop-filter: blur(var(--blur-sm));
    color: var(--color-neutral-50);
    font-family: var(--font-body);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    font-variant-numeric: tabular-nums;
    letter-spacing: var(--tracking-normal);
    border-radius: var(--radius-xs);
    line-height: var(--leading-tight);
  }

  /*
    Category eyebrow — small-caps editorial label above the title.
    Replaces the previous glass-scrim overlay on the thumbnail, which
    fought the image. An eyebrow reads as editorial hierarchy (think
    magazine department label) and leaves the photograph clean.
  */
  .cc__eyebrow {
    margin: 0;
    font-family: var(--font-body);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: var(--color-text-tertiary);
    line-height: var(--leading-tight);
  }

  /*
    Media-type kind-line — `AUDIO · Category` / `VIDEO · Category` /
    `ARTICLE · Category` small-caps head-line shown above the title on
    catalogue cards. Matches `.cc__eyebrow` typography but prefixes the
    fixed media-type token so the kind is legible even when no category
    is set (design neutrality — no coloured pill per R12). The leading
    icon inherits `currentColor` so it shares the tertiary text tone.
  */
  .cc__kind {
    margin: 0;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-family: var(--font-body);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: var(--color-text-tertiary);
    line-height: var(--leading-tight);
  }

  :global(.cc__kind-icon) {
    flex-shrink: 0;
  }

  /* PriceBadge position */
  :global(.cc__price-badge) {
    position: absolute;
    top: var(--space-2);
    right: var(--space-2);
    z-index: 1;
  }

  /* ═══════════════════════════════════════════
     ACCESS STATE (Codex-k7ppt)
     Library surfaces decorate the card with a small 'Ends {date}' badge
     when the underlying subscription is cancelling, and dim + expose a
     hover/tap CTA when the subscription is past_due / revoked. Browse
     grids pass no accessState, so none of this renders there.
     ═══════════════════════════════════════════ */

  /* Cancelling badge — top-left so it doesn't collide with the top-right PriceBadge. */
  .cc__access-badge {
    position: absolute;
    top: var(--space-2);
    left: var(--space-2);
    z-index: 2;
    display: inline-flex;
    align-items: center;
    padding: var(--space-0-5) var(--space-2);
    font-family: var(--font-body);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    line-height: var(--leading-tight);
    letter-spacing: var(--tracking-normal);
    color: var(--color-warning-700);
    background: color-mix(in srgb, var(--color-warning-100) 92%, transparent);
    border: var(--border-width) var(--border-style) var(--color-warning-200);
    border-radius: var(--radius-xs);
    backdrop-filter: blur(var(--blur-sm));
    -webkit-backdrop-filter: blur(var(--blur-sm));
  }

  /* Dim the card when the underlying subscription has lapsed.
     Per design: use opacity, NOT colour — keeps the brand palette intact. */
  .cc--access-dimmed .cc__thumb,
  .cc--access-dimmed .cc__body {
    opacity: var(--opacity-60);
  }

  /* Hover/tap CTA — sits above .cc__link so the CTA route wins when the
     card is dimmed. Visible on hover/focus-within (or tap — the CTA has
     pointer-events even when visually hidden, so taps work on touch). */
  .cc__access-cta {
    position: absolute;
    inset: auto 0 0 0;
    z-index: 3;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-2) var(--space-3);
    font-family: var(--font-body);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-normal);
    color: var(--color-text-inverse);
    background: color-mix(in srgb, var(--color-neutral-900) 82%, transparent);
    backdrop-filter: blur(var(--blur-sm));
    -webkit-backdrop-filter: blur(var(--blur-sm));
    text-decoration: none;
    text-align: center;
    opacity: 0;
    transform: translateY(var(--space-1));
    transition:
      opacity var(--duration-fast) var(--ease-default),
      transform var(--duration-fast) var(--ease-default);
    pointer-events: none;
  }

  .cc--access-dimmed:hover .cc__access-cta,
  .cc--access-dimmed:focus-within .cc__access-cta,
  .cc__access-cta:focus-visible {
    opacity: 1;
    transform: translateY(0);
    pointer-events: auto;
  }

  .cc__access-cta:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: calc(-1 * var(--border-width-thick));
  }

  /* On touch devices (no hover), keep the CTA permanently visible so taps
     work — otherwise the user would have to tap through the card link. */
  @media (hover: none) {
    .cc--access-dimmed .cc__access-cta {
      opacity: 1;
      transform: translateY(0);
      pointer-events: auto;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .cc__access-cta {
      transition: opacity var(--duration-fast) var(--ease-default);
      transform: none;
    }
  }

  /* ═══════════════════════════════════════════
     PROGRESS BAR
     ═══════════════════════════════════════════ */

  .cc__progress-track {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: var(--space-1);
    background: var(--color-overlay-light);
  }

  .cc__progress-fill {
    height: 100%;
    background: var(--color-interactive);
    transition: width var(--duration-slow) var(--ease-default);
  }

  .cc__progress-fill--completed {
    background: var(--color-success);
  }

  /* ═══════════════════════════════════════════
     BODY
     ═══════════════════════════════════════════ */

  .cc__body {
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    flex: 1;
  }

  .cc__title {
    margin: 0;
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    line-height: var(--leading-tight);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .cc__title a {
    color: inherit;
    text-decoration: none;
    position: relative;
    z-index: 2;
  }

  .cc__title a:hover {
    color: var(--color-interactive);
  }

  .cc__title a:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-xs);
  }

  .cc__title a:focus:not(:focus-visible) {
    outline: none;
  }

  .cc__description {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: var(--leading-normal);
    /* Hidden by default in grid cards — container query reveals when card is wide enough */
    display: none;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  /* Resume info (resume variant) */
  .cc__resume-text {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .cc__resume-pill {
    display: inline-flex;
    align-items: center;
    align-self: flex-start;
    gap: var(--space-1);
    margin-top: var(--space-0-5);
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-interactive);
    background: transparent;
    border: var(--border-width) var(--border-style) var(--color-interactive);
    border-radius: var(--radius-full);
    transition: background-color var(--duration-fast) var(--ease-default),
                color var(--duration-fast) var(--ease-default);
  }

  .cc:hover .cc__resume-pill {
    background: var(--color-interactive);
    color: var(--color-text-inverse);
  }

  /* Creator row */
  .cc__creator {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: auto;
  }

  .cc__creator-link {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    text-decoration: none;
    position: relative;
    z-index: 2;
  }

  .cc__creator-link:hover .cc__creator-name {
    color: var(--color-interactive);
  }

  .cc__creator-name {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    transition: color var(--duration-fast) var(--ease-default);
  }

  :global(.cc__creator-avatar) {
    height: var(--space-6);
    width: var(--space-6);
    font-size: var(--text-xs);
  }

  .cc__actions {
    padding: 0 var(--space-3) var(--space-3);
  }

  /* ═══════════════════════════════════════════
     VARIANT: LIST
     ═══════════════════════════════════════════ */

  .cc[data-variant='list'] {
    flex-direction: row;
  }

  .cc[data-variant='list'] .cc__thumb {
    /* 180px — composed from space tokens so it scales with density */
    width: calc(var(--space-24) + var(--space-20) + var(--space-1));
    min-width: calc(var(--space-24) + var(--space-20) + var(--space-1));
    aspect-ratio: auto;
  }

  .cc[data-variant='list'] .cc__body {
    flex: 1;
    min-width: 0;
    padding: var(--space-3) var(--space-4);
    gap: var(--space-1);
  }

  @media (--below-sm) {
    .cc[data-variant='list'] {
      flex-direction: column;
    }

    .cc[data-variant='list'] .cc__thumb {
      width: 100%;
      min-width: 0;
    }
  }

  /* ═══════════════════════════════════════════
     VARIANT: FEATURED
     Image-dominant card with glass overlay body.
     The image fills the full card height; body
     overlays the bottom with frosted glass.
     ═══════════════════════════════════════════ */

  .cc[data-variant='featured'] {
    /* Image fills card — body overlays at bottom.
       Floor height composed from space tokens (96 × 3 + 48 + 24 = 360px)
       so the featured card never collapses below a hero-worthy size. */
    display: grid;
    grid-template-rows: 1fr;
    min-height: calc(var(--space-24) * 3 + var(--space-12) + var(--space-6));
  }

  .cc[data-variant='featured'] .cc__link {
    z-index: 3;
  }

  .cc[data-variant='featured'] .cc__thumb {
    grid-row: 1 / -1;
    grid-column: 1;
    aspect-ratio: auto;
    height: 100%;
  }

  .cc[data-variant='featured'] .cc__body {
    grid-row: 1 / -1;
    grid-column: 1;
    align-self: end;
    padding: var(--space-5);
    gap: var(--space-2);
    margin: var(--space-2);
    /* Frosted glass overlay */
    background: color-mix(in srgb, var(--color-surface-card) 75%, transparent);
    backdrop-filter: blur(var(--blur-xl));
    -webkit-backdrop-filter: blur(var(--blur-xl));
    border-radius: var(--radius-lg);
  }

  .cc[data-variant='featured'] .cc__title {
    font-size: var(--text-xl);
    -webkit-line-clamp: 2;
  }

  .cc[data-variant='featured'] .cc__description {
    display: -webkit-box;
  }

  /* ═══════════════════════════════════════════
     VARIANT: COMPACT
     ═══════════════════════════════════════════ */

  .cc[data-variant='compact'] {
    flex-direction: row;
    padding: 0;
    border: none;
    background: transparent;
    backdrop-filter: none;
    box-shadow: none;
    gap: var(--space-3);
  }

  .cc[data-variant='compact']:hover,
  .cc[data-variant='compact']:focus-within:has(:focus-visible) {
    transform: none;
    box-shadow: none;
    border-color: transparent;
  }

  .cc[data-variant='compact'] .cc__thumb {
    /* 160px — 96 + 64, cleanly composed from space tokens */
    width: calc(var(--space-24) + var(--space-16));
    min-width: calc(var(--space-24) + var(--space-16));
    border-radius: var(--radius-md);
  }

  .cc[data-variant='compact'] .cc__body {
    padding: 0;
    gap: var(--space-1);
  }

  .cc[data-variant='compact'] .cc__title {
    font-size: var(--text-sm);
    -webkit-line-clamp: 1;
  }

  /* ═══════════════════════════════════════════
     VARIANT: RESUME (replaces ContinueWatchingCard)
     ═══════════════════════════════════════════ */

  .cc[data-variant='resume'] {
    /* 240–340px — composed from space tokens:
       min: 96×2 + 48 = 240, max: 96×3 + 48 + 4 = 340 */
    min-width: calc(var(--space-24) * 2 + var(--space-12));
    max-width: calc(var(--space-24) * 3 + var(--space-12) + var(--space-1));
    flex-shrink: 0;
    scroll-snap-align: start;
  }

  .cc[data-variant='resume'] .cc__title {
    -webkit-line-clamp: 1;
  }

  .cc[data-variant='resume'] .cc__body {
    gap: var(--space-1);
  }

  /* ═══════════════════════════════════════════
     CONTAINER QUERY RESPONSIVE
     Card adapts to its grid cell size, not viewport.
     Featured 2x2 cards automatically get larger
     text and show description.
     ═══════════════════════════════════════════ */

  @container (min-width: 400px) {
    .cc__title {
      font-size: var(--text-lg);
    }

    .cc__description {
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    /* Articles get a slightly longer excerpt when the card is wide enough
       — three lines fits without crowding the byline row underneath. */
    .cc[data-content-type='article'] .cc__description {
      -webkit-line-clamp: 3;
    }
  }

  @container (min-width: 500px) {
    .cc__body {
      padding: var(--space-4);
      gap: var(--space-2);
    }
  }

  /* ═══════════════════════════════════════════
     CONTENT TYPE DIFFERENTIATION
     Type is signalled STRUCTURALLY — aspect ratio, not colour.
     Section-level layouts (AudioWall mosaic, ArticleEditorial list)
     carry the rest of the type identity. Kept neutral palette across
     all cards so the grid reads as one coherent surface.
     ═══════════════════════════════════════════ */

  /* ── AUDIO: square album-art ratio ────────────────────────── */

  .cc[data-content-type='audio'] .cc__thumb {
    aspect-ratio: 1 / 1;
  }

  /*
    Audio placeholder — when no real thumbnail exists, we render an
    `AudioWaveform variant="thumb"` that fills the 1:1 tile. The waveform
    component handles its own sizing + opacity via its scoped styles, so
    we only need to ensure it stretches to the placeholder bounds.
  */
  .cc[data-content-type='audio'] .cc__placeholder :global(.cc__thumb-waveform) {
    width: 100%;
    height: 100%;
  }

  /* ── ARTICLE: 3:2 editorial crop ──────────────────────────── */

  .cc[data-content-type='article'] .cc__thumb {
    aspect-ratio: 3 / 2;
  }

  /* When no real image — hide the thumb and let text take over. */
  .cc[data-content-type='article'] .cc__thumb:has(.cc__placeholder:not(.hidden)) {
    display: none;
  }

  /* Scale up the article icon — symmetry with audio */
  .cc[data-content-type='article'] .cc__placeholder :global(svg) {
    width: var(--space-12);
    height: var(--space-12);
    opacity: var(--opacity-30);
  }

  /*
    Articles are text-led. The excerpt is always visible — even at sizes
    where the default grid card hides it — so readers can judge each
    card before clicking. Two lines keeps the block from dominating the
    card height; grid cards at ≥400px get three via the cascade below.
  */
  .cc[data-content-type='article'] .cc__description {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    font-size: var(--text-sm);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
  }

  /* Allow the headline to breathe — articles lead with their title */
  .cc[data-content-type='article'] .cc__title {
    -webkit-line-clamp: 3;
  }

  /* list/featured already override aspect-ratio; no article 3:2 bleed needed there */
  .cc[data-variant='list'][data-content-type='article'] .cc__thumb,
  .cc[data-variant='featured'][data-content-type='article'] .cc__thumb {
    aspect-ratio: auto;
    display: block;
  }

  /* ── NORMALIZE RATIO: mixed-type carousel override ──────────
     When a carousel contains items of mixed content types (Free samples,
     per-category), the per-type thumb ratios (audio 1:1, article 3:2,
     video 16:9) create a jagged row. Callers set `normalizeRatio={true}`
     to force every card in the row to 16:9. Wins over per-type rules
     because it uses a more specific selector (includes data-normalize).
     Only applies to the grid variant — list/featured/compact have their
     own aspect handling and shouldn't need to be normalized. */
  .cc[data-normalize-ratio][data-variant='grid'] .cc__thumb {
    aspect-ratio: 16 / 9;
  }

  /* Article thumbs normally disappear when there's no real image; but in
     a normalized mixed row we keep the frame so the rhythm holds. Fill
     with the surface token + the article icon sits centered. */
  .cc[data-normalize-ratio][data-content-type='article'] .cc__thumb:has(.cc__placeholder:not(.hidden)) {
    display: block;
  }

  /*
    Article byline + read-time meta — compact text row with a tertiary
    tone so it sits quietly under the excerpt without competing with the
    title. Mirrors ArticleEditorial's sidebar rows so every article card
    in the app carries the same editorial signals.
  */
  .cc__article-meta {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
    margin: 0;
    font-family: var(--font-body);
    font-size: var(--text-xs);
    line-height: var(--leading-tight);
    color: var(--color-text-tertiary);
  }

  .cc__article-byline {
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
  }

  .cc__article-sep {
    opacity: var(--opacity-50);
  }

  .cc__article-read-time {
    font-variant-numeric: tabular-nums;
  }

  /*
    Non-featured article cards read as editorial tiles, not filled
    rectangles — keeps a page of 20+ article cards from feeling like a
    wall of SaaS panels. Background lifts on hover / focus-visible as a
    soft touch of `--color-text` at 4% (matching the non-featured card
    transparency rule set by the broader design-system feedback).
    Featured variants are promotional surfaces and keep their filled
    glass treatment.
  */
  .cc[data-content-type='article']:not([data-variant='featured']) {
    background: transparent;
    border-color: color-mix(in srgb, var(--color-border) 30%, transparent);
  }

  .cc[data-content-type='article']:not([data-variant='featured']):hover,
  .cc[data-content-type='article']:not([data-variant='featured']):focus-within:has(:focus-visible) {
    background: color-mix(in srgb, var(--color-text) 4%, transparent);
    border-color: color-mix(in srgb, var(--color-border) 60%, transparent);
  }

  /* ═══════════════════════════════════════════
     LAYOUT: AUDIO-ROW (opt-in via `layout='row'` + contentType='audio')
     Horizontal "music playlist row" — album art on the left, title +
     waveform + meta stacked on the right. Transparent by default so the
     row sits lightly on section backgrounds; subtle fill appears on hover.
     ═══════════════════════════════════════════ */

  .cc--audio-row {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    /* Bumped from space-3 to space-4 — gives the larger album art + title
       cluster real breathing room instead of feeling crammed. */
    gap: var(--space-4);
    /* Row padding bumped from space-2 to space-3 — the row is no longer
       compact, so the outer cushion needs to match the taller album art. */
    padding: var(--space-3);
    /* Transparent until hover — matches the card-transparency rule. */
    background: transparent;
    border-color: transparent;
    border-radius: var(--radius-lg);
  }

  .cc--audio-row:hover,
  .cc--audio-row:focus-within:has(:focus-visible) {
    background: color-mix(in srgb, var(--color-surface-card) 70%, transparent);
    border-color: color-mix(in srgb, var(--color-border) 50%, transparent);
    /* Lighter lift than the default card — this is a list item, not a tile.
       No scale(): a playlist row should not bulge like a featured tile. */
    transform: translateY(calc(-1 * var(--space-0-5)));
    box-shadow: var(--shadow-sm);
  }

  /* Album art — square, fixed width. Bumped from space-20 (~80px) to
     space-24 + space-4 (~112px) so the row reads as music-app generous
     instead of compact-list terse. Composed from tokens so it scales
     with org density. */
  .cc--audio-row .cc__thumb {
    width: calc(var(--space-24) + var(--space-4));
    min-width: calc(var(--space-24) + var(--space-4));
    height: calc(var(--space-24) + var(--space-4));
    aspect-ratio: 1 / 1;
    border-radius: var(--radius-md);
    flex-shrink: 0;
  }

  .cc--audio-row .cc__body {
    padding: 0;
    /* Bumped from space-1 to space-2 — the title is now one step larger,
       so the meta/waveform need proportionally more separation. */
    gap: var(--space-2);
    min-width: 0;
  }

  /* Two-line clamp keeps long track titles readable without blowing up
     the row height. Single-line felt too terse during review. Bumped
     one step (base → lg) so the title reads as the primary thing in
     the row, not peer to the meta line. */
  .cc--audio-row .cc__title {
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    -webkit-line-clamp: 2;
  }

  /* Hide the in-thumbnail duration in the row layout — we re-surface
     it inside the waveform/meta cluster where it sits better typed. */
  .cc--audio-row .cc__duration {
    display: none;
  }

  /* Hide the kind-line and eyebrow in the row layout — the album-art +
     waveform thumbnail already signal "this is audio" structurally, and
     an extra `AUDIO · Category` head-line above the title fights the
     playlist-row rhythm. Category is still available via the meta line. */
  .cc--audio-row .cc__kind,
  .cc--audio-row .cc__eyebrow {
    display: none;
  }

  /* Waveform strip — brand-tinted via `color:` (AudioWaveform uses
     currentColor). Slightly taller (space-5 → space-6) to match the
     beefier row height so it doesn't look hair-thin next to the 112px
     album art. */
  :global(.cc--audio-row .cc__waveform) {
    width: 100%;
    /* Fixed height keeps layout stable during SSR/client hydration and
       sidesteps any aspect-ratio maths in the SVG itself. */
    height: var(--space-6);
    color: color-mix(
      in srgb,
      var(--color-interactive) 60%,
      var(--color-player-text-secondary, var(--color-text-secondary))
    );
  }

  /* Thumbnail-fallback waveform — stands in for missing album art. Uses
     a subtle brand tint over the secondary surface so the tile still
     reads as part of the row palette without being identical to the
     inline strip below the title. */
  :global(.cc__thumb-waveform) {
    color: color-mix(
      in srgb,
      var(--color-interactive) 45%,
      var(--color-text-secondary)
    );
  }

  /* Audio thumbnail placeholder — when the fallback waveform renders, we
     want a subtle tinted backdrop (not the flat surface-secondary that
     articles use) so the tile feels like a deliberate audio tile, not a
     missing image. Slightly deeper on hover to echo the row lift. */
  .cc[data-content-type='audio'] .cc__placeholder {
    background: color-mix(in srgb, var(--color-interactive) 6%, var(--color-surface-secondary));
    transition: background-color var(--duration-slow) var(--ease-smooth);
  }

  .cc--audio-row:hover .cc__placeholder,
  .cc--audio-row:focus-within:has(:focus-visible) .cc__placeholder {
    background: color-mix(in srgb, var(--color-interactive) 10%, var(--color-surface-secondary));
  }

  /* Creator · duration meta line. Small, tertiary text; matches the
     visual weight of other meta rows in the card family. */
  .cc--audio-row .cc__audio-meta {
    margin: 0;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: var(--leading-tight);
    /* Avoid wrapping mid-separator — meta reads as one unit. */
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .cc--audio-row .cc__audio-meta-creator {
    font-weight: var(--font-medium);
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .cc--audio-row .cc__audio-meta-sep {
    color: var(--color-text-muted);
  }

  .cc--audio-row .cc__audio-meta-duration {
    font-variant-numeric: tabular-nums;
  }

  /* Don't let audio-row be zoomed/scaled like a featured tile — it's a
     list item, not a hero. */
  .cc--audio-row:hover .cc__image {
    transform: none;
  }

  /* ── Hover animation: inline waveform bars shimmer ───────────────
     On hover / focus-within of the audio row, the inline waveform strip
     animates: each bar scales up slightly on the Y-axis with a staggered
     transition-delay so the wave reads as a single left-to-right pulse
     rather than a hard flash. Gated by `no-preference` — the default bar
     state is scaleY(1) so reduced-motion users see a static waveform.
     Motion tokens inherited from `.waveform__bar` (--duration-slow +
     --ease-smooth) keep this collapse to 0.01ms automatically under
     prefers-reduced-motion: reduce.

     The thumb-fallback waveform lives inside `.cc__placeholder`, which
     is outside the cc__waveform scope, so we target the specific class
     (.cc__waveform) to avoid pulsing the thumbnail bars — the thumbnail
     carries the signature; the inline strip carries the motion. */
  @media (prefers-reduced-motion: no-preference) {
    .cc--audio-row:hover :global(.cc__waveform .waveform__bar),
    .cc--audio-row:focus-within:has(:focus-visible) :global(.cc__waveform .waveform__bar) {
      --_bar-hover-scale: 1.35;
    }
  }

  /* Reduced motion: keep the hover affordance but drop the translate. */
  @media (prefers-reduced-motion: reduce) {
    .cc--audio-row:hover,
    .cc--audio-row:focus-within:has(:focus-visible) {
      transform: none;
    }
  }
</style>
