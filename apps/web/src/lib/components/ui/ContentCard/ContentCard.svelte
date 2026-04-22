<!--
  @component ContentCard

  Unified content card for all contexts: browse grids, library lists, featured
  sections, compact sidebars, and continue-watching carousels.

  @prop {'grid' | 'list' | 'featured' | 'compact' | 'resume'} variant - Layout variant
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

  interface Props extends HTMLAttributes<HTMLDivElement> {
    variant?: 'grid' | 'list' | 'featured' | 'compact' | 'resume';
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
  }

  const {
    variant = 'grid',
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
    class: className,
    ...rest
  }: Props = $props();

  const titleId = $derived(`cc-title-${id}`);
  const profileHref = $derived(creator?.username ? `/@${creator.username}` : '#');
  const progressPercent = $derived(calculateProgressPercent(progress));
  const hasProgress = $derived(progress != null && (progress.completed || progressPercent > 0));
  const isCompleted = $derived(progress?.completed ?? false);

  const resumeTime = $derived(formatDuration(progress?.positionSeconds ?? 0));

  const showCreator = $derived(variant === 'grid' || variant === 'featured');
  const showDescription = $derived((variant === 'featured' || variant === 'grid') && !!description);
  const showPriceBadge = $derived(
    variant !== 'compact' && variant !== 'resume' &&
    (price != null || purchased || included || contentAccessType != null)
  );
  const showResumeInfo = $derived(variant === 'resume');

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
  data-variant={variant}
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
            <MusicIcon size={32} />
          {:else}
            <FileTextIcon size={32} />
          {/if}
        </div>
      {:else}
        <div class="cc__placeholder">
          {#if contentType === 'video'}
            <PlayIcon size={32} />
          {:else if contentType === 'audio'}
            <MusicIcon size={32} />
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
      {#if category && variant !== 'compact' && variant !== 'resume'}
        <p class="cc__eyebrow">{category}</p>
      {/if}
      <h3 class="cc__title" id={titleId}>
        <a href={href}>{title}</a>
      </h3>

      {#if showDescription}
        <p class="cc__description">{extractPlainText(description)}</p>
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

  .hidden {
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
  }

  @container (min-width: 500px) {
    .cc__body {
      padding: var(--space-4);
      gap: var(--space-2);
    }
  }
</style>
