<!--
  @component ContentDetailView

  Shared content detail view used by both org and creator content detail pages.
  Handles player/preview rendering, metadata display, purchase section,
  "What you'll get" benefits, and related content grid.

  The purchase form and creator attribution are passed as snippets to allow
  page-specific customization (form actions, creator link styling).

  @prop {ContentWithRelations} content - The content item with all relations
  @prop {string | null} contentBodyHtml - Rendered HTML for written content body
  @prop {boolean} hasAccess - Whether the current user has full access
  @prop {string | null} streamingUrl - HLS streaming URL (null if no access)
  @prop {object | null} progress - Playback progress data
  @prop {boolean} isAuthenticated - Whether the user is logged in
  @prop {{ sessionUrl?: string; checkoutError?: string } | null} formResult - Form action result
  @prop {boolean} purchasing - Whether a purchase is in flight
  @prop {string} creatorName - Display name for the creator
  @prop {string} titleSuffix - Suffix for the page title
  @prop {Snippet} [creatorAttribution] - Custom creator attribution line
  @prop {Snippet} [purchaseForm] - Purchase form with use:enhance
  @prop {ContentWithRelations[]} [relatedContent] - Related content items
  @prop {(item: ContentWithRelations) => string} [buildRelatedHref] - Href builder for related cards
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import * as m from '$paraglide/messages';
  import VideoPlayer from '$lib/components/VideoPlayer/VideoPlayer.svelte';
  import { AudioPlayer } from '$lib/components/AudioPlayer';
  import { PreviewPlayer, deriveAccessState } from '$lib/components/player';
  import { ContentCard } from '$lib/components/ui/ContentCard';
  import { formatPrice, formatDurationHuman } from '$lib/utils/format';
  import { PriceBadge } from '$lib/components/ui/PriceBadge';
  import { LockIcon, CheckIcon } from '$lib/components/ui/Icon';
  import ProseContent from '$lib/components/editor/ProseContent.svelte';
  import { extractPlainText } from '@codex/validation';
  import type { ContentWithRelations } from '$lib/types';

  /**
   * Extended content type that includes runtime-resolved media fields.
   * The public content API resolves R2 keys to full CDN URLs (thumbnailUrl,
   * hlsPreviewUrl) that don't exist on the base MediaItem schema type.
   */
  type ContentDetail = ContentWithRelations & {
    mediaItem?: (ContentWithRelations['mediaItem'] extends infer M
      ? M extends object
        ? M & { thumbnailUrl?: string | null; hlsPreviewUrl?: string | null }
        : M
      : never) | null;
  };

  interface Props {
    content: ContentDetail;
    contentBodyHtml: string | null;
    hasAccess: boolean;
    streamingUrl: string | null;
    waveformUrl?: string | null;
    progress: {
      positionSeconds: number;
      durationSeconds: number;
      completed: boolean;
    } | null;
    isAuthenticated: boolean;
    formResult: { sessionUrl?: string; checkoutError?: string } | null;
    purchasing: boolean;
    creatorName: string;
    titleSuffix: string;
    /** Whether this content requires a subscription tier */
    requiresSubscription?: boolean;
    /** Whether the user has an active subscription to this org */
    hasSubscription?: boolean;
    /** Whether the user's tier is high enough for this content */
    subscriptionCoversContent?: boolean;
    /** True while the access check is still resolving (skeleton state) */
    accessLoading?: boolean;
    creatorAttribution?: Snippet;
    purchaseForm?: Snippet;
    relatedContent?: ContentDetail[];
    buildRelatedHref?: (item: ContentDetail) => string;
  }

  const {
    content,
    contentBodyHtml,
    hasAccess,
    streamingUrl,
    waveformUrl,
    progress,
    isAuthenticated,
    formResult,
    purchasing,
    creatorName,
    titleSuffix,
    requiresSubscription,
    hasSubscription,
    subscriptionCoversContent,
    accessLoading = false,
    creatorAttribution,
    purchaseForm,
    relatedContent,
    buildRelatedHref,
  }: Props = $props();

  function displayPrice(cents: number | null): string {
    if (!cents) return m.content_price_free();
    return formatPrice(cents);
  }

  const contentTypeBadge = $derived(
    content.contentType === 'video'
      ? m.content_type_video()
      : content.contentType === 'audio'
        ? m.content_type_audio()
        : m.content_type_article()
  );

  const description = $derived(extractPlainText(content.description));
  const thumbnailUrl = $derived(content.mediaItem?.thumbnailUrl ?? undefined);
  const duration = $derived(content.mediaItem?.durationSeconds ?? 0);
  const priceCents = $derived(content.priceCents ?? null);
  const isPaid = $derived(!!priceCents && priceCents > 0);
  const isFree = $derived(!priceCents || priceCents === 0);
  const needsPurchase = $derived(!hasAccess && isPaid && !requiresSubscription);
  const needsSubscription = $derived(
    !hasAccess && requiresSubscription && !subscriptionCoversContent
  );
  const isFollowersOnly = $derived(
    !hasAccess && content.accessType === 'followers'
  );
  const isTeamOnly = $derived(
    !hasAccess && content.accessType === 'team'
  );

  const previewUrl = $derived(content.mediaItem?.hlsPreviewUrl ?? undefined);
  const accessState = $derived(
    deriveAccessState({
      hasAccess,
      hasPreview: !!previewUrl,
      isAuthenticated,
      requiresSubscription,
      hasSubscription,
      subscriptionCoversContent,
    })
  );

  // Content-type-aware primary benefit
  const primaryBenefit = $derived(
    content.contentType === 'video'
      ? m.content_detail_benefit_hd_video()
      : content.contentType === 'audio'
        ? m.content_detail_benefit_hq_audio()
        : m.content_detail_benefit_full_article()
  );

  // Related content filtered by same creator, excluding current item
  const filteredRelated = $derived(
    (relatedContent ?? [])
      .filter(
        (item) =>
          item.id !== content.id && item.creator?.id === content.creator?.id
      )
      .slice(0, 4)
  );
</script>

<svelte:head>
  <title>{content.title} | {titleSuffix}</title>
  <meta property="og:title" content={content.title} />
  {#if description}
    <meta name="description" content={description} />
    <meta property="og:description" content={description} />
  {/if}
  <meta property="og:type" content="video.other" />
  {#if thumbnailUrl}
    <meta property="og:image" content={thumbnailUrl} />
  {/if}
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={content.title} />
  {#if description}
    <meta name="twitter:description" content={description} />
  {/if}
</svelte:head>

<div class="content-detail" data-access={hasAccess ? 'full' : 'preview'}>
  <!-- Player / Preview Section (hidden for written content) -->
  {#if content.contentType !== 'written'}
  <div class="content-detail__player" data-content-type={content.contentType}>
    {#if hasAccess && streamingUrl}
      {#if content.contentType === 'audio'}
        <AudioPlayer
          src={streamingUrl}
          contentId={content.id}
          initialProgress={progress?.positionSeconds ?? 0}
          waveformUrl={waveformUrl}
          poster={thumbnailUrl}
          title={content.title}
          shaderPreset={content.shaderPreset ?? null}
        />
      {:else}
        <VideoPlayer
          src={streamingUrl}
          contentId={content.id}
          initialProgress={progress?.positionSeconds ?? 0}
          poster={thumbnailUrl}
        />
      {/if}
    {:else if previewUrl && accessState.status === 'preview'}
      <svelte:boundary>
        <PreviewPlayer
          previewUrl={previewUrl}
          poster={thumbnailUrl}
          contentId={content.id}
          contentTitle={content.title}
          {accessState}
          autoplay={true}
        />
        {#snippet failed(error, reset)}
          <div class="content-detail__preview">
            {#if thumbnailUrl}
              <img
                class="content-detail__preview-image"
                src={thumbnailUrl}
                alt={m.content_thumbnail_alt({ title: content.title })}
              />
            {/if}
            <div class="content-detail__preview-overlay">
              <div class="content-detail__preview-cta">
                <p class="content-detail__cta-text">{m.content_detail_purchase_cta()}</p>
                <p class="content-detail__cta-subtext">{m.content_detail_purchase_cta_description()}</p>
              </div>
            </div>
          </div>
        {/snippet}
      </svelte:boundary>
    {:else if accessLoading}
      <div class="content-detail__player-skeleton">
        <div class="skeleton skeleton--player"></div>
      </div>
    {:else}
      <div class="content-detail__preview">
        {#if thumbnailUrl}
          <img
            class="content-detail__preview-image"
            src={thumbnailUrl}
            alt={m.content_thumbnail_alt({ title: content.title })}
          />
        {/if}
        <div class="content-detail__preview-overlay">
          <div class="content-detail__preview-cta">
            <LockIcon size={40} class="content-detail__lock-icon" stroke-width="1.5" />
            <p class="content-detail__cta-text">{m.content_detail_purchase_cta()}</p>
            <p class="content-detail__cta-subtext">{m.content_detail_purchase_cta_description()}</p>
          </div>
        </div>
      </div>
    {/if}
  </div>
  {/if}

  <!-- Content Info Section -->
  <div class="content-detail__info">
    <div class="content-detail__header">
      <h1 class="content-detail__title">{content.title}</h1>
      <div class="content-detail__meta">
        <span class="content-detail__badge">{contentTypeBadge}</span>
        {#if duration > 0}
          <span class="content-detail__duration">
            {m.content_duration()}: {formatDurationHuman(duration)}
          </span>
        {/if}
        {#if hasAccess && isPaid}
          <PriceBadge amount={priceCents} purchased={true} />
        {/if}
      </div>
    </div>

    {#if creatorAttribution}
      {@render creatorAttribution()}
    {:else if creatorName}
      <p class="content-detail__creator">
        {m.content_detail_by_creator({ creator: creatorName })}
      </p>
    {/if}

    {#if progress?.completed}
      <span class="content-detail__completed-badge">{m.content_progress_completed()}</span>
    {/if}

    <!-- Team-only Section — only management roles can access -->
    {#if !accessLoading && isTeamOnly}
      <div class="content-detail__purchase">
        <div class="content-detail__price">
          <span class="content-detail__price-amount">{m.team_only_cta_title()}</span>
          <span class="content-detail__price-label">{m.team_only_cta_description()}</span>
        </div>
      </div>
    {/if}

    <!-- Followers-only Section — follow to access -->
    {#if !accessLoading && isFollowersOnly}
      <div class="content-detail__purchase">
        <div class="content-detail__price">
          <span class="content-detail__price-amount">{m.followers_only_cta_title()}</span>
          <span class="content-detail__price-label">{m.followers_only_cta_description()}</span>
        </div>

        {#if isAuthenticated}
          <button class="content-detail__purchase-btn" onclick={() => {
            import('$lib/remote/org.remote').then(({ followOrganization }) => {
              if (content.organizationId) {
                followOrganization(content.organizationId).then(() => {
                  window.location.reload();
                });
              }
            });
          }}>
            {m.org_follow()}
          </button>
        {:else}
          <a href="/login" class="content-detail__purchase-btn content-detail__purchase-btn--link">
            {m.checkout_signin_to_purchase()}
          </a>
        {/if}
      </div>
    {/if}

    <!-- Subscription Section (tier-gated content) — hidden during access loading -->
    {#if !accessLoading && needsSubscription}
      <div class="content-detail__purchase">
        <div class="content-detail__price">
          <span class="content-detail__price-amount">
            {hasSubscription ? m.upgrade_cta_title() : m.subscribe_cta_title()}
          </span>
          <span class="content-detail__price-label">
            {hasSubscription ? m.upgrade_cta_description() : m.subscribe_cta_description()}
          </span>
        </div>

        {#if isAuthenticated}
          <a href="/pricing" class="content-detail__purchase-btn content-detail__purchase-btn--link">
            {hasSubscription ? m.upgrade_cta_title() : m.subscribe_cta_title()}
          </a>
        {:else}
          <a href="/login" class="content-detail__purchase-btn content-detail__purchase-btn--link">
            {m.checkout_signin_to_purchase()}
          </a>
        {/if}

        {#if isPaid}
          <span class="content-detail__or-divider">or purchase for {displayPrice(priceCents)}</span>
          {#if isAuthenticated && purchaseForm}
            {@render purchaseForm()}
          {/if}
        {/if}
      </div>
    {/if}

    <!-- Purchase Section (one-time purchase) — hidden during access loading -->
    {#if !accessLoading && needsPurchase}
      <div class="content-detail__purchase">
        <div class="content-detail__price">
          <span class="content-detail__price-amount">{displayPrice(priceCents)}</span>
          <span class="content-detail__price-label">{m.content_detail_purchase_cta_description()}</span>
        </div>

        {#if formResult?.checkoutError}
          <p class="content-detail__purchase-error" role="alert">{formResult.checkoutError}</p>
        {/if}

        {#if isAuthenticated && purchaseForm}
          {@render purchaseForm()}
        {:else if !isAuthenticated}
          <a href="/login" class="content-detail__purchase-btn content-detail__purchase-btn--link">
            {m.checkout_signin_to_purchase()}
          </a>
        {/if}

        <!-- What you'll get -->
        <div class="content-detail__benefits">
          <h3 class="content-detail__benefits-heading">{m.content_detail_benefits_heading()}</h3>
          <ul class="content-detail__benefits-list">
            <li class="content-detail__benefits-item">
              <CheckIcon size={16} class="content-detail__benefits-icon" />
              <span>{primaryBenefit}</span>
            </li>
            <li class="content-detail__benefits-item">
              <CheckIcon size={16} class="content-detail__benefits-icon" />
              <span>{m.content_detail_benefit_lifetime_access()}</span>
            </li>
            <li class="content-detail__benefits-item">
              <CheckIcon size={16} class="content-detail__benefits-icon" />
              <span>{m.content_detail_benefit_progress_tracking()}</span>
            </li>
            <li class="content-detail__benefits-item">
              <CheckIcon size={16} class="content-detail__benefits-icon" />
              <span>{m.content_detail_benefit_any_device()}</span>
            </li>
          </ul>
        </div>
      </div>
    {:else if !accessLoading && isFree && !hasAccess}
      <div class="content-detail__purchase">
        <div class="content-detail__price">
          <span class="content-detail__price-amount content-detail__price-amount--free">{m.content_price_free()}</span>
        </div>
        {#if !isAuthenticated}
          <a href="/login" class="content-detail__purchase-btn content-detail__purchase-btn--link">
            {m.checkout_signin_to_purchase()}
          </a>
        {/if}

        <!-- What you'll get (free content) -->
        <div class="content-detail__benefits">
          <h3 class="content-detail__benefits-heading">{m.content_detail_benefits_heading()}</h3>
          <ul class="content-detail__benefits-list">
            <li class="content-detail__benefits-item">
              <CheckIcon size={16} class="content-detail__benefits-icon" />
              <span>{primaryBenefit}</span>
            </li>
            <li class="content-detail__benefits-item">
              <CheckIcon size={16} class="content-detail__benefits-icon" />
              <span>{m.content_detail_benefit_lifetime_access()}</span>
            </li>
            <li class="content-detail__benefits-item">
              <CheckIcon size={16} class="content-detail__benefits-icon" />
              <span>{m.content_detail_benefit_progress_tracking()}</span>
            </li>
            <li class="content-detail__benefits-item">
              <CheckIcon size={16} class="content-detail__benefits-icon" />
              <span>{m.content_detail_benefit_any_device()}</span>
            </li>
          </ul>
        </div>
      </div>
    {/if}

    {#if description}
      <div class="content-detail__description">
        <h2 class="content-detail__description-heading">{m.content_detail_about()}</h2>
        <p>{description}</p>
      </div>
    {/if}

    {#if contentBodyHtml}
      {#if hasAccess}
        <div class="content-detail__body">
          <ProseContent html={contentBodyHtml} />
        </div>
      {:else if accessLoading}
        <div class="content-detail__body content-detail__body--locked">
          <div class="content-detail__body-skeleton">
            <div class="skeleton skeleton--body-line"></div>
            <div class="skeleton skeleton--body-line skeleton--body-line--short"></div>
          </div>
        </div>
      {:else}
        <div class="content-detail__body content-detail__body--locked">
          <div class="content-detail__body-lock">
            <LockIcon size={24} class="content-detail__body-lock-icon" />
            <p class="content-detail__body-lock-text">
              {#if needsSubscription}
                {hasSubscription ? m.upgrade_cta_description() : m.subscribe_cta_description()}
              {:else if !isAuthenticated}
                {m.checkout_signin_to_purchase()}
              {:else}
                {m.content_detail_purchase_cta_description()}
              {/if}
            </p>
          </div>
        </div>
      {/if}
    {/if}
  </div>

  <!-- Related Content Section -->
  {#if filteredRelated.length > 0}
    <section class="content-detail__related">
      <h2 class="content-detail__related-heading">
        {m.content_detail_more_from_creator({ creator: creatorName })}
      </h2>
      <div class="content-detail__related-grid">
        {#each filteredRelated as item (item.id)}
          <ContentCard
            id={item.id}
            title={item.title}
            thumbnail={item.mediaItem?.thumbnailUrl}
            description={item.description}
            contentType={item.contentType === 'written' ? 'article' : item.contentType as 'video' | 'audio'}
            duration={item.mediaItem?.durationSeconds}
            href={buildRelatedHref?.(item) ?? `/content/${item.slug ?? item.id}`}
            price={item.priceCents != null
              ? { amount: item.priceCents, currency: 'GBP' }
              : null}
            contentAccessType={item.accessType}
          />
        {/each}
      </div>
    </section>
  {/if}
</div>

<style>
  .content-detail {
    width: 100%;
    max-width: 960px;
    margin: 0 auto;
    padding: var(--space-4) var(--space-4) var(--space-8);
  }

  /* Player / Preview */
  .content-detail__player {
    width: 100%;
    border-radius: var(--radius-lg);
    overflow: hidden;
    background: var(--color-surface-tertiary);
    aspect-ratio: 16 / 9;
    margin-bottom: var(--space-6);
  }

  .content-detail__player[data-content-type='audio'] {
    aspect-ratio: unset;
    background: transparent;
  }

  .content-detail__preview {
    position: relative;
    width: 100%;
    height: 100%;
  }

  .content-detail__preview-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .content-detail__preview-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(
      to top,
      color-mix(in srgb, black 80%, transparent) 0%,
      color-mix(in srgb, black 40%, transparent) 50%,
      color-mix(in srgb, black 20%, transparent) 100%
    );
  }

  .content-detail__preview-cta {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-text-inverse);
    text-align: center;
    padding: var(--space-6);
  }

  :global(.content-detail__lock-icon) {
    opacity: var(--opacity-90);
    margin-bottom: var(--space-1);
    animation: lock-pulse 2s ease-in-out infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.content-detail__lock-icon) {
      animation: none;
    }
  }

  @keyframes lock-pulse {
    0%, 100% { opacity: var(--opacity-90); }
    50% { opacity: var(--opacity-60); }
  }

  .content-detail__cta-text {
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    margin: 0;
  }

  .content-detail__cta-subtext {
    font-size: var(--text-sm);
    opacity: var(--opacity-80);
    margin: 0;
    max-width: 280px;
  }

  /* Info Section */
  .content-detail__info {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  /* Two-state layout: preview state has tighter spacing above purchase card */
  .content-detail[data-access="preview"] .content-detail__purchase {
    margin-top: var(--space-2);
  }

  /* Full-access state: more relaxed spacing */
  .content-detail[data-access="full"] .content-detail__info {
    gap: var(--space-5);
  }

  .content-detail__header {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .content-detail__title {
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    margin: 0;
    line-height: var(--leading-snug);
  }

  .content-detail__meta {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .content-detail__badge {
    display: inline-flex;
    align-items: center;
    padding: var(--space-1) var(--space-2);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    border-radius: var(--radius-sm);
    background: var(--color-brand-primary-subtle);
    color: var(--color-interactive-active);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
  }

  .content-detail__duration {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .content-detail__creator {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin: 0;
  }

  /* Creator link styles (used by creator page snippet) */
  :global(.content-detail__creator-link) {
    color: var(--color-text-secondary);
    text-decoration: none;
    transition: var(--transition-colors);
  }

  :global(.content-detail__creator-link:hover) {
    color: var(--color-interactive);
  }

  .content-detail__completed-badge {
    display: inline-flex;
    align-items: center;
    padding: var(--space-1) var(--space-2);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    border-radius: var(--radius-sm);
    background: var(--color-success-100);
    color: var(--color-success-700);
    width: fit-content;
  }

  /* Purchase Section */
  .content-detail__purchase {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-5);
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
  }

  .content-detail__price {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .content-detail__price-amount {
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
  }

  .content-detail__price-amount--free {
    color: var(--color-success-600);
  }

  .content-detail__price-label {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .content-detail__purchase-error {
    font-size: var(--text-sm);
    color: var(--color-error-600);
    margin: 0;
    padding: var(--space-2) var(--space-3);
    background: var(--color-error-50);
    border-radius: var(--radius-md);
  }

  .content-detail__or-divider {
    display: block;
    text-align: center;
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    padding: var(--space-2) 0;
  }

  :global(.content-detail__purchase-btn) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-3) var(--space-6);
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    border-radius: var(--radius-md);
    border: none;
    cursor: pointer;
    transition: var(--transition-colors);
    font-family: inherit;
    background: var(--color-brand-accent);
    color: var(--color-text-inverse);
    text-decoration: none;
    width: 100%;
  }

  :global(.content-detail__purchase-btn:hover:not(:disabled)) {
    background: var(--color-brand-accent-hover);
  }

  :global(.content-detail__purchase-btn:disabled) {
    opacity: var(--opacity-70);
    cursor: not-allowed;
  }

  .content-detail__purchase-btn--link {
    text-align: center;
  }

  /* Benefits section */
  .content-detail__benefits {
    margin-top: var(--space-4);
    padding-top: var(--space-4);
    border-top: var(--border-width) var(--border-style) var(--color-border);
  }

  .content-detail__benefits-heading {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin: 0 0 var(--space-3);
  }

  .content-detail__benefits-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .content-detail__benefits-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  :global(.content-detail__benefits-icon) {
    color: var(--color-success-600);
    flex-shrink: 0;
  }

  /* Description */
  .content-detail__description {
    margin-top: var(--space-2);
  }

  .content-detail__description-heading {
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin: 0 0 var(--space-2);
  }

  .content-detail__description p {
    font-size: var(--text-base);
    color: var(--color-text-secondary);
    line-height: var(--leading-relaxed);
    margin: 0;
    white-space: pre-line;
  }

  /* Article body (written content) */
  .content-detail__body {
    margin-top: var(--space-4);
    padding-top: var(--space-4);
    border-top: var(--border-width) var(--border-style) var(--color-border);
  }

  .content-detail__body--locked {
    position: relative;
    min-height: var(--space-24);
  }

  .content-detail__body-lock {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    padding: var(--space-8) var(--space-4);
    background: var(--color-surface-secondary);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
    text-align: center;
  }

  :global(.content-detail__body-lock-icon) {
    color: var(--color-text-muted);
    opacity: var(--opacity-70);
  }

  .content-detail__body-lock-text {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin: 0;
    max-width: 320px;
    line-height: var(--leading-relaxed);
  }

  /* Related Content Section */
  .content-detail__related {
    margin-top: var(--space-8);
    padding-top: var(--space-6);
    border-top: var(--border-width) var(--border-style) var(--color-border);
  }

  .content-detail__related-heading {
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin: 0 0 var(--space-4);
  }

  .content-detail__related-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-4);
  }

  @media (--breakpoint-sm) {
    .content-detail__related-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (--breakpoint-lg) {
    .content-detail__related-grid {
      grid-template-columns: repeat(4, 1fr);
    }
  }

  /* Skeleton loading states (access check pending) */
  .content-detail__player-skeleton {
    width: 100%;
    height: 100%;
  }

  .skeleton--player {
    width: 100%;
    height: 100%;
    background: linear-gradient(
      90deg,
      var(--color-surface-secondary) 25%,
      var(--color-surface-tertiary) 50%,
      var(--color-surface-secondary) 75%
    );
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
  }

  .content-detail__body-skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-6) var(--space-4);
  }

  .skeleton--body-line {
    height: var(--text-base);
    border-radius: var(--radius-sm);
    background: linear-gradient(
      90deg,
      var(--color-surface-secondary) 25%,
      var(--color-surface-tertiary) 50%,
      var(--color-surface-secondary) 75%
    );
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
    width: 100%;
  }

  .skeleton--body-line--short {
    width: 60%;
  }

  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  /* Responsive */
  @media (--breakpoint-md) {
    .content-detail {
      padding: var(--space-6) var(--space-6) var(--space-10);
    }

    .content-detail__title {
      font-size: var(--text-3xl);
    }

    :global(.content-detail__purchase-btn) {
      width: auto;
    }
  }
</style>
