<!--
  @component ContentDetailPage

  Displays content details including video player (if user has access),
  content metadata, price/purchase CTA, and a purchase form action
  for paid content that redirects to Stripe checkout.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { enhance } from '$app/forms';
  import * as m from '$paraglide/messages';
  import VideoPlayer from '$lib/components/VideoPlayer/VideoPlayer.svelte';
  import { PreviewPlayer, deriveAccessState } from '$lib/components/player';
  import { hydrateIfNeeded } from '$lib/collections';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
    form: { sessionUrl?: string; checkoutError?: string } | null;
  }

  const { data, form }: Props = $props();

  // Seed content collection with this item so navigating away and back
  // finds the metadata already cached — instant title/thumbnail rendering.
  onMount(() => {
    if (data.content) {
      hydrateIfNeeded('content', [data.content]);
    }
  });

  let purchasing = $state(false);

  function formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  }

  function formatPrice(cents: number | null): string {
    if (!cents) return m.content_price_free();
    return `$${(cents / 100).toFixed(2)}`;
  }

  const contentTypeBadge = $derived(
    data.content.contentType === 'video'
      ? m.content_type_video()
      : data.content.contentType === 'audio'
        ? m.content_type_audio()
        : m.content_type_article()
  );

  const creatorName = $derived(data.content.creator?.name ?? data.content.creator?.email ?? '');
  const description = $derived(data.content.description ?? '');
  const thumbnailUrl = $derived(data.content.mediaItem?.thumbnailUrl ?? undefined);
  const duration = $derived(data.content.mediaItem?.durationSeconds ?? 0);
  const priceCents = $derived(data.content.priceCents ?? null);
  const isPaid = $derived(
    data.content.visibility === 'purchased_only' && !!priceCents && priceCents > 0
  );
  const isFree = $derived(
    data.content.visibility === 'public' ||
    (data.content.visibility === 'purchased_only' && (!priceCents || priceCents === 0))
  );
  const needsPurchase = $derived(!data.hasAccess && isPaid);

  const previewUrl = $derived(data.content.mediaItem?.hlsPreviewKey ?? undefined);
  const accessState = $derived(
    deriveAccessState({
      hasAccess: data.hasAccess,
      hasPreview: !!previewUrl,
      isAuthenticated: !!data.user,
    })
  );

  function handlePurchase() {
    purchasing = true;
    return async ({ result, update }: { result: any; update: () => Promise<void> }) => {
      purchasing = false;
      if (result.type === 'success' && result.data?.sessionUrl) {
        // Redirect to Stripe checkout (external domain)
        window.location.href = result.data.sessionUrl;
        return;
      }
      await update();
    };
  }
</script>

<svelte:head>
  <title>{data.content.title} | {data.org?.name ?? 'Codex'}</title>
  <meta property="og:title" content={data.content.title} />
  {#if description}
    <meta name="description" content={description} />
    <meta property="og:description" content={description} />
  {/if}
  <meta property="og:type" content="video.other" />
  {#if thumbnailUrl}
    <meta property="og:image" content={thumbnailUrl} />
  {/if}
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={data.content.title} />
  {#if description}
    <meta name="twitter:description" content={description} />
  {/if}
</svelte:head>

<div class="content-detail">
  <!-- Player / Preview Section -->
  <div class="content-detail__player">
    {#if data.hasAccess && data.streamingUrl}
      <VideoPlayer
        src={data.streamingUrl}
        contentId={data.content.id}
        initialProgress={data.progress?.positionSeconds ?? 0}
        poster={thumbnailUrl}
      />
    {:else if previewUrl && accessState.status === 'preview'}
      <svelte:boundary>
        <PreviewPlayer
          previewUrl={previewUrl}
          poster={thumbnailUrl}
          contentId={data.content.id}
          contentTitle={data.content.title}
          {accessState}
        />
        {#snippet failed(error, reset)}
          <div class="content-detail__preview">
            {#if thumbnailUrl}
              <img
                class="content-detail__preview-image"
                src={thumbnailUrl}
                alt={m.content_thumbnail_alt({ title: data.content.title })}
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
    {:else}
      <div class="content-detail__preview">
        {#if thumbnailUrl}
          <img
            class="content-detail__preview-image"
            src={thumbnailUrl}
            alt={m.content_thumbnail_alt({ title: data.content.title })}
          />
        {/if}
        <div class="content-detail__preview-overlay">
          <div class="content-detail__preview-cta">
            <svg
              class="content-detail__lock-icon"
              xmlns="http://www.w3.org/2000/svg"
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
            <p class="content-detail__cta-text">{m.content_detail_purchase_cta()}</p>
            <p class="content-detail__cta-subtext">{m.content_detail_purchase_cta_description()}</p>
          </div>
        </div>
      </div>
    {/if}
  </div>

  <!-- Content Info Section -->
  <div class="content-detail__info">
    <div class="content-detail__header">
      <h1 class="content-detail__title">{data.content.title}</h1>
      <div class="content-detail__meta">
        <span class="content-detail__badge">{contentTypeBadge}</span>
        {#if duration > 0}
          <span class="content-detail__duration">
            {m.content_duration()}: {formatDuration(duration)}
          </span>
        {/if}
      </div>
    </div>

    {#if creatorName}
      <p class="content-detail__creator">
        {m.content_detail_by_creator({ creator: creatorName })}
      </p>
    {/if}

    {#if data.progress?.completed}
      <span class="content-detail__completed-badge">{m.content_progress_completed()}</span>
    {/if}

    <!-- Purchase Section -->
    {#if needsPurchase}
      <div class="content-detail__purchase">
        <div class="content-detail__price">
          <span class="content-detail__price-amount">{formatPrice(priceCents)}</span>
          <span class="content-detail__price-label">{m.content_detail_purchase_cta_description()}</span>
        </div>

        {#if form?.checkoutError}
          <p class="content-detail__purchase-error" role="alert">{form.checkoutError}</p>
        {/if}

        {#if data.user}
          <form method="POST" action="?/purchase" use:enhance={handlePurchase}>
            <input type="hidden" name="contentId" value={data.content.id} />
            <button
              type="submit"
              class="content-detail__purchase-btn"
              disabled={purchasing}
            >
              {#if purchasing}
                {m.checkout_processing()}
              {:else}
                {m.checkout_purchase_button({ price: formatPrice(priceCents) })}
              {/if}
            </button>
          </form>
        {:else}
          <a href="/login" class="content-detail__purchase-btn content-detail__purchase-btn--link">
            {m.checkout_signin_to_purchase()}
          </a>
        {/if}
      </div>
    {:else if isFree && !data.hasAccess}
      <div class="content-detail__purchase">
        <div class="content-detail__price">
          <span class="content-detail__price-amount content-detail__price-amount--free">{m.content_price_free()}</span>
        </div>
        {#if !data.user}
          <a href="/login" class="content-detail__purchase-btn content-detail__purchase-btn--link">
            {m.checkout_signin_to_purchase()}
          </a>
        {/if}
      </div>
    {/if}

    {#if description}
      <div class="content-detail__description">
        <h2 class="content-detail__description-heading">{m.content_detail_about()}</h2>
        <p>{description}</p>
      </div>
    {/if}
  </div>
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
    background: var(--color-neutral-900);
    aspect-ratio: 16 / 9;
    margin-bottom: var(--space-6);
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
    background: rgba(0, 0, 0, 0.6);
  }

  .content-detail__preview-cta {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    color: #ffffff;
    text-align: center;
    padding: var(--space-6);
  }

  .content-detail__lock-icon {
    opacity: 0.9;
    margin-bottom: var(--space-1);
  }

  .content-detail__cta-text {
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    margin: 0;
  }

  .content-detail__cta-subtext {
    font-size: var(--text-sm);
    opacity: 0.8;
    margin: 0;
    max-width: 280px;
  }

  /* Info Section */
  .content-detail__info {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
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
    line-height: 1.3;
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
    background: var(--color-primary-100);
    color: var(--color-primary-700);
    text-transform: uppercase;
    letter-spacing: 0.05em;
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

  .content-detail__completed-badge {
    display: inline-flex;
    align-items: center;
    padding: var(--space-1) var(--space-2);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    border-radius: var(--radius-sm);
    background: var(--color-success-100, #dcfce7);
    color: var(--color-success-700, #15803d);
    width: fit-content;
  }

  /* Purchase Section */
  .content-detail__purchase {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-5);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
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
    color: var(--color-success-600, #16a34a);
  }

  .content-detail__price-label {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .content-detail__purchase-error {
    font-size: var(--text-sm);
    color: var(--color-error-600, #dc2626);
    margin: 0;
    padding: var(--space-2) var(--space-3);
    background: var(--color-error-50, #fef2f2);
    border-radius: var(--radius-md);
  }

  .content-detail__purchase-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-3) var(--space-6);
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    border-radius: var(--radius-md);
    border: none;
    cursor: pointer;
    transition: var(--transition-colors, background-color 0.15s);
    font-family: inherit;
    background: var(--color-primary-500, #c24129);
    color: #ffffff;
    text-decoration: none;
    width: 100%;
  }

  .content-detail__purchase-btn:hover:not(:disabled) {
    background: var(--color-primary-600, #b23720);
  }

  .content-detail__purchase-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  .content-detail__purchase-btn--link {
    text-align: center;
  }

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
    line-height: 1.7;
    margin: 0;
    white-space: pre-line;
  }

  /* Responsive */
  @media (--breakpoint-md) {
    .content-detail {
      padding: var(--space-6) var(--space-6) var(--space-10);
    }

    .content-detail__title {
      font-size: var(--text-3xl);
    }

    .content-detail__purchase-btn {
      width: auto;
    }
  }

  /* Dark mode */
  :global([data-theme='dark']) .content-detail__badge {
    background: var(--color-primary-900, #1e1b4b);
    color: var(--color-primary-200, #c4b5fd);
  }

  :global([data-theme='dark']) .content-detail__title {
    color: var(--color-text-dark);
  }

  :global([data-theme='dark']) .content-detail__creator,
  :global([data-theme='dark']) .content-detail__duration {
    color: var(--color-text-secondary-dark);
  }

  :global([data-theme='dark']) .content-detail__description-heading {
    color: var(--color-text-dark);
  }

  :global([data-theme='dark']) .content-detail__description p {
    color: var(--color-text-secondary-dark);
  }

  :global([data-theme='dark']) .content-detail__completed-badge {
    background: var(--color-success-900, #14532d);
    color: var(--color-success-200, #bbf7d0);
  }

  :global([data-theme='dark']) .content-detail__purchase {
    background: var(--color-surface-dark, #262626);
    border-color: var(--color-border-dark, #404040);
  }

  :global([data-theme='dark']) .content-detail__price-amount {
    color: var(--color-text-dark);
  }

  :global([data-theme='dark']) .content-detail__price-label {
    color: var(--color-text-secondary-dark);
  }

  :global([data-theme='dark']) .content-detail__purchase-error {
    background: rgba(220, 38, 38, 0.1);
    color: #fca5a5;
  }
</style>
