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
  import { formatPrice, formatDurationHuman } from '$lib/utils/format';
  import { LockIcon } from '$lib/components/ui/Icon';
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

  function displayPrice(cents: number | null): string {
    if (!cents) return m.content_price_free();
    return formatPrice(cents);
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
  const isPaid = $derived(!!priceCents && priceCents > 0);
  const isFree = $derived(!priceCents || priceCents === 0);
  const needsPurchase = $derived(!data.hasAccess && isPaid);

  const previewUrl = $derived(data.content.mediaItem?.hlsPreviewUrl ?? undefined);
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
  <!-- Player / Preview Section (hidden for written content) -->
  {#if data.content.contentType !== 'written'}
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
            <LockIcon size={32} class="content-detail__lock-icon" stroke-width="1.5" />
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
      <h1 class="content-detail__title">{data.content.title}</h1>
      <div class="content-detail__meta">
        <span class="content-detail__badge">{contentTypeBadge}</span>
        {#if duration > 0}
          <span class="content-detail__duration">
            {m.content_duration()}: {formatDurationHuman(duration)}
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
          <span class="content-detail__price-amount">{displayPrice(priceCents)}</span>
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
                {m.checkout_purchase_button({ price: displayPrice(priceCents) })}
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

    {#if data.contentBodyHtml}
      <article class="content-detail__body prose">
        {@html data.contentBodyHtml}
      </article>
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
    background: color-mix(in srgb, black 60%, transparent);
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

  .content-detail__lock-icon {
    opacity: var(--opacity-90);
    margin-bottom: var(--space-1);
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
    background: var(--color-brand-primary-subtle);
    color: var(--color-interactive-active);
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
    background: var(--color-interactive);
    color: var(--color-text-on-brand);
    text-decoration: none;
    width: 100%;
  }

  .content-detail__purchase-btn:hover:not(:disabled) {
    background: var(--color-interactive-hover);
  }

  .content-detail__purchase-btn:disabled {
    opacity: var(--opacity-70);
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

  /* Article body (written content) */
  .content-detail__body {
    margin-top: var(--space-4);
    padding-top: var(--space-4);
    border-top: var(--border-width) var(--border-style) var(--color-border);
  }

  .prose :global(h1) { font-size: var(--text-2xl); font-weight: var(--font-bold); margin: var(--space-4) 0 var(--space-2); color: var(--color-text); }
  .prose :global(h2) { font-size: var(--text-xl); font-weight: var(--font-semibold); margin: var(--space-3) 0 var(--space-2); color: var(--color-text); }
  .prose :global(h3) { font-size: var(--text-lg); font-weight: var(--font-semibold); margin: var(--space-3) 0 var(--space-2); color: var(--color-text); }
  .prose :global(p) { margin: var(--space-2) 0; line-height: var(--leading-relaxed); color: var(--color-text-secondary); font-size: var(--text-base); }
  .prose :global(ul) { padding-left: var(--space-6); margin: var(--space-2) 0; color: var(--color-text-secondary); list-style-type: disc; }
  .prose :global(ol) { padding-left: var(--space-6); margin: var(--space-2) 0; color: var(--color-text-secondary); list-style-type: decimal; }
  .prose :global(li) { margin: var(--space-1) 0; }
  .prose :global(code) { font-family: var(--font-mono, monospace); background-color: var(--color-surface-secondary, var(--color-surface)); padding: var(--space-1); border-radius: var(--radius-sm); font-size: 0.9em; }
  .prose :global(pre) { background-color: var(--color-surface-secondary, var(--color-surface)); padding: var(--space-4); border-radius: var(--radius-md); overflow-x: auto; margin: var(--space-3) 0; }
  .prose :global(pre code) { background: none; padding: 0; }
  .prose :global(blockquote) { border-left: var(--border-width-thick) var(--border-style) var(--color-brand-primary-subtle); padding-left: var(--space-4); margin: var(--space-3) 0; color: var(--color-text-secondary); }
  .prose :global(a) { color: var(--color-interactive-hover); text-decoration: underline; }
  .prose :global(strong) { font-weight: var(--font-bold); }
  .prose :global(hr) { border: none; border-top: var(--border-width) var(--border-style) var(--color-border); margin: var(--space-4) 0; }
  .prose :global(img) { max-width: 100%; height: auto; border-radius: var(--radius-md); margin: var(--space-3) 0; }

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
    background: var(--color-interactive-active);
    color: var(--color-focus-ring);
  }

  :global([data-theme='dark']) .content-detail__title {
    color: var(--color-text);
  }

  :global([data-theme='dark']) .content-detail__creator,
  :global([data-theme='dark']) .content-detail__duration {
    color: var(--color-text-secondary);
  }

  :global([data-theme='dark']) .content-detail__description-heading {
    color: var(--color-text);
  }

  :global([data-theme='dark']) .content-detail__description p {
    color: var(--color-text-secondary);
  }

  :global([data-theme='dark']) .content-detail__completed-badge {
    background: var(--color-success-900, #14532d);
    color: var(--color-success-200, #bbf7d0);
  }

  :global([data-theme='dark']) .content-detail__purchase {
    background: var(--color-surface);
    border-color: var(--color-border);
  }

  :global([data-theme='dark']) .content-detail__price-amount {
    color: var(--color-text);
  }

  :global([data-theme='dark']) .content-detail__price-label {
    color: var(--color-text-secondary);
  }

  :global([data-theme='dark']) .content-detail__purchase-error {
    background: var(--color-error-50);
    color: var(--color-error-200);
  }

  :global([data-theme='dark']) .content-detail__body {
    border-color: var(--color-border);
  }

  :global([data-theme='dark']) .prose :global(h1),
  :global([data-theme='dark']) .prose :global(h2),
  :global([data-theme='dark']) .prose :global(h3) {
    color: var(--color-text);
  }

  :global([data-theme='dark']) .prose :global(p),
  :global([data-theme='dark']) .prose :global(ul),
  :global([data-theme='dark']) .prose :global(ol),
  :global([data-theme='dark']) .prose :global(blockquote) {
    color: var(--color-text-secondary);
  }

  :global([data-theme='dark']) .prose :global(a) {
    color: var(--color-interactive);
  }

  :global([data-theme='dark']) .prose :global(code) {
    background-color: var(--color-surface-secondary);
  }

  :global([data-theme='dark']) .prose :global(pre) {
    background-color: var(--color-surface-secondary);
  }
</style>
