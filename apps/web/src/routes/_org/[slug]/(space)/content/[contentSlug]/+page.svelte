<!--
  @component ContentDetailPage (Org)

  Thin wrapper around ContentDetailView for the org content detail route.
  Handles page-specific concerns: hydration, purchase form with use:enhance,
  and org-specific data derivations.

  Uses SvelteKit streaming: content + contentBodyHtml are awaited (SEO + first paint),
  while relatedContent and accessAndProgress are streamed as bare promises.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import { ContentDetailView } from '$lib/components/content';
  import { ContentCard } from '$lib/components/ui/ContentCard';
  import { contentCollection, hydrateIfNeeded } from '$lib/collections';
  import { formatPrice } from '$lib/utils/format';
  import { buildContentUrl } from '$lib/utils/subdomain';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
    form: { sessionUrl?: string; checkoutError?: string } | null;
  }

  const { data, form }: Props = $props();

  onMount(() => {
    if (data.content) {
      hydrateIfNeeded('content', [data.content]);
    }
  });

  // Use cached content from collection if available (e.g., from browse/explore)
  // Falls back to SSR data (always present, awaited in server load)
  const content = $derived(
    contentCollection?.state.get(data.content.id) ?? data.content
  );

  let purchasing = $state(false);

  /** Feature flag from org layout — when false, subscription UI is hidden */
  const enableSubscriptions = $derived(data.enableSubscriptions ?? true);

  // Subscription context — resolves asynchronously without blocking render.
  // Gate on enableSubscriptions: when disabled, never show subscription prompts.
  let subCtx = $state({
    requiresSubscription:
      data.content.accessType === 'subscribers' || !!data.content.minimumTierId,
    hasSubscription: false,
    subscriptionCoversContent: false,
  });

  $effect(() => {
    if (!enableSubscriptions) {
      subCtx = {
        requiresSubscription: false,
        hasSubscription: false,
        subscriptionCoversContent: false,
      };
      return;
    }
    data.subscriptionContext?.then((ctx) => {
      subCtx = {
        requiresSubscription: ctx.requiresSubscription,
        hasSubscription: ctx.hasSubscription,
        subscriptionCoversContent: ctx.subscriptionCoversContent,
      };
    });
  });

  const creatorName = $derived(content.creator?.name ?? content.creator?.email ?? '');
  const titleSuffix = $derived(data.org?.name ?? 'Codex');
  const priceCents = $derived(content.priceCents ?? null);

  function displayPrice(cents: number | null): string {
    if (!cents) return m.content_price_free();
    return formatPrice(cents);
  }

  function handlePurchase() {
    purchasing = true;
    return async ({ result, update }: { result: any; update: () => Promise<void> }) => {
      purchasing = false;
      if (result.type === 'success' && result.data?.sessionUrl) {
        window.location.href = result.data.sessionUrl;
        return;
      }
      await update();
    };
  }
</script>

<!--
  Unauthenticated: accessAndProgress is null, flat fields hold static values.
  Authenticated: accessAndProgress is a promise — await it for player/purchase area.
-->
{#if data.accessAndProgress}
  {#await data.accessAndProgress}
    <!-- Skeleton: player/purchase area loading -->
    <ContentDetailView
      content={content}
      contentBodyHtml={data.contentBodyHtml}
      hasAccess={false}
      streamingUrl={null}
      progress={null}
      isAuthenticated={true}
      formResult={form}
      {purchasing}
      {creatorName}
      {titleSuffix}
      requiresSubscription={subCtx.requiresSubscription}
      hasSubscription={subCtx.hasSubscription}
      subscriptionCoversContent={subCtx.subscriptionCoversContent}
    >
      {#snippet purchaseForm()}
        <div class="access-skeleton">
          <div class="skeleton skeleton--wide"></div>
          <div class="skeleton skeleton--button"></div>
        </div>
      {/snippet}
    </ContentDetailView>
  {:then accessData}
    <ContentDetailView
      content={content}
      contentBodyHtml={data.contentBodyHtml}
      hasAccess={accessData.hasAccess}
      streamingUrl={accessData.streamingUrl}
      progress={accessData.progress}
      isAuthenticated={true}
      formResult={form}
      {purchasing}
      {creatorName}
      {titleSuffix}
      requiresSubscription={subCtx.requiresSubscription}
      hasSubscription={subCtx.hasSubscription}
      subscriptionCoversContent={subCtx.subscriptionCoversContent}
    >
      {#snippet purchaseForm()}
        <form method="POST" action="?/purchase" use:enhance={handlePurchase}>
          <input type="hidden" name="contentId" value={content.id} />
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
      {/snippet}
    </ContentDetailView>
  {/await}
{:else}
  <!-- Unauthenticated: no streaming needed for access state -->
  <ContentDetailView
    content={content}
    contentBodyHtml={data.contentBodyHtml}
    hasAccess={false}
    streamingUrl={null}
    progress={null}
    isAuthenticated={false}
    formResult={form}
    {purchasing}
    {creatorName}
    {titleSuffix}
    requiresSubscription={subCtx.requiresSubscription}
    hasSubscription={subCtx.hasSubscription}
    subscriptionCoversContent={subCtx.subscriptionCoversContent}
  >
    {#snippet purchaseForm()}
      <form method="POST" action="?/purchase" use:enhance={handlePurchase}>
        <input type="hidden" name="contentId" value={content.id} />
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
    {/snippet}
  </ContentDetailView>
{/if}

<!-- Streamed related content section (below fold) -->
{#await data.relatedContent}
  <section class="content-detail__related content-detail__related--streamed">
    <div class="related-skeleton__header">
      <div class="skeleton skeleton--heading"></div>
    </div>
    <div class="related-skeleton__grid">
      {#each Array(3) as _}
        <div class="related-skeleton__card">
          <div class="skeleton skeleton--thumbnail"></div>
          <div class="skeleton skeleton--title"></div>
          <div class="skeleton skeleton--meta"></div>
        </div>
      {/each}
    </div>
  </section>
{:then relatedItems}
  {#if relatedItems && relatedItems.length > 0}
    {@const filtered = relatedItems
      .filter((item) => item.id !== content.id && item.creator?.id === content.creator?.id)
      .slice(0, 4)}
    {#if filtered.length > 0}
      <section class="content-detail__related content-detail__related--streamed">
        <h2 class="content-detail__related-heading">
          {m.content_detail_more_from_creator({ creator: creatorName })}
        </h2>
        <div class="content-detail__related-grid">
          {#each filtered as item (item.id)}
            {@const mediaItem = item.mediaItem as { thumbnailUrl?: string | null; durationSeconds?: number | null } | null}
            <ContentCard
              id={item.id}
              title={item.title}
              thumbnail={mediaItem?.thumbnailUrl ?? null}
              description={item.description}
              contentType={item.contentType === 'written' ? 'article' : (item.contentType as 'video' | 'audio')}
              duration={mediaItem?.durationSeconds ?? null}
              href={buildContentUrl(page.url, item)}
              price={item.priceCents != null
                ? { amount: item.priceCents, currency: 'GBP' }
                : null}
              contentAccessType={item.accessType}
            />
          {/each}
        </div>
      </section>
    {/if}
  {/if}
{/await}

<style>
  /* ── Skeleton Loading States ── */
  .skeleton {
    background: linear-gradient(
      90deg,
      var(--color-surface-secondary) 25%,
      var(--color-surface-tertiary) 50%,
      var(--color-surface-secondary) 75%
    );
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
    border-radius: var(--radius-md);
  }

  .skeleton--wide {
    width: 100%;
    height: var(--space-6);
  }

  .skeleton--button {
    width: 100%;
    height: var(--space-12);
    border-radius: var(--radius-md);
    margin-top: var(--space-3);
  }

  .skeleton--heading {
    width: 240px;
    height: var(--text-lg);
  }

  .skeleton--thumbnail {
    width: 100%;
    aspect-ratio: 16 / 9;
    border-radius: var(--radius-lg);
  }

  .skeleton--title {
    width: 80%;
    height: var(--text-base);
  }

  .skeleton--meta {
    width: 50%;
    height: var(--text-sm);
  }

  .access-skeleton {
    padding: var(--space-5);
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
  }

  /* ── Streamed Related Content ── */
  .content-detail__related--streamed {
    width: 100%;
    max-width: 960px;
    margin: 0 auto;
    padding: 0 var(--space-4) var(--space-8);
  }

  .content-detail__related-heading {
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin: 0 0 var(--space-4);
    padding-top: var(--space-6);
    border-top: var(--border-width) var(--border-style) var(--color-border);
  }

  .content-detail__related-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-4);
  }

  .related-skeleton__header {
    padding-top: var(--space-6);
    margin-bottom: var(--space-4);
    border-top: var(--border-width) var(--border-style) var(--color-border);
  }

  .related-skeleton__grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-4);
  }

  .related-skeleton__card {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  @media (--breakpoint-sm) {
    .content-detail__related-grid,
    .related-skeleton__grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (--breakpoint-md) {
    .content-detail__related--streamed {
      padding: 0 var(--space-6) var(--space-10);
    }
  }

  @media (--breakpoint-lg) {
    .content-detail__related-grid,
    .related-skeleton__grid {
      grid-template-columns: repeat(4, 1fr);
    }
  }

  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
</style>
