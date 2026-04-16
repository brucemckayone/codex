<!--
  @component CreatorContentDetailPage

  Thin wrapper around ContentDetailView for the creator content detail route.
  Handles page-specific concerns: hydration, purchase form with use:enhance,
  creator-specific attribution link, and creator-specific href builder.

  Uses SvelteKit streaming: content + contentBodyHtml are awaited (SEO + first paint),
  while relatedContent and accessAndProgress are streamed as bare promises.
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { enhance } from '$app/forms';
  import * as m from '$paraglide/messages';
  import { ContentDetailView } from '$lib/components/content';
  import { ContentCard } from '$lib/components/ui/ContentCard';
  import { hydrateIfNeeded } from '$lib/collections';
  import { formatPrice } from '$lib/utils/format';
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

  // Always use server load data — it's fetched by slug for this specific page.
  // Collection state.get() returns wrong items after hydration from explore/browse.
  const content = $derived(data.content);

  let purchasing = $state(false);

  // Subscription context — defaults derived from data.content, overridden by async subscription check.
  // Writable $derived: resets to content-based defaults on navigation, overwritten by $effect below.
  let subCtx = $derived({
    requiresSubscription:
      data.content.accessType === 'subscribers' || !!data.content.minimumTierId,
    hasSubscription: false,
    subscriptionCoversContent: false,
  });

  $effect(() => {
    data.subscriptionContext?.then((ctx) => {
      subCtx = {
        requiresSubscription: ctx.requiresSubscription,
        hasSubscription: ctx.hasSubscription,
        subscriptionCoversContent: ctx.subscriptionCoversContent,
      };
    });
  });

  // Access state — resolved reactively from the streaming promise.
  // A single ContentDetailView stays mounted; only these props change.
  let accessState = $state({
    hasAccess: false,
    streamingUrl: null as string | null,
    waveformUrl: null as string | null,
    progress: null as {
      positionSeconds: number;
      durationSeconds: number;
      completed: boolean;
    } | null,
    // svelte-ignore state_referenced_locally
    loading: !!data.accessAndProgress,
  });

  let resolvedPromise: Promise<unknown> | null = null;

  $effect(() => {
    const promise = data.accessAndProgress;
    untrack(() => {
      if (promise && promise !== resolvedPromise) {
        accessState.loading = true;
        resolvedPromise = promise;
        promise.then((result) => {
          if (resolvedPromise === promise) {
            accessState.hasAccess = result.hasAccess;
            accessState.streamingUrl = result.streamingUrl;
            accessState.waveformUrl = result.waveformUrl ?? null;
            accessState.progress = result.progress;
            accessState.loading = false;
          }
        });
      } else if (!promise) {
        accessState.hasAccess = false;
        accessState.streamingUrl = null;
        accessState.waveformUrl = null;
        accessState.progress = null;
        accessState.loading = false;
        resolvedPromise = null;
      }
    });
  });

  const creatorName = $derived(data.creatorProfile?.name ?? data.username);
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
  Single ContentDetailView instance — props update reactively when
  the streaming promise resolves. This avoids destroying/recreating
  Key by content ID to force full re-mount when navigating between content items.
-->
{#key data.content.id}
<ContentDetailView
  content={content}
  contentBodyHtml={data.contentBodyHtml}
  hasAccess={accessState.hasAccess}
  accessLoading={accessState.loading}
  streamingUrl={accessState.streamingUrl}
  waveformUrl={accessState.waveformUrl}
  progress={accessState.progress}
  isAuthenticated={!!data.accessAndProgress}
  formResult={form}
  {purchasing}
  {creatorName}
  titleSuffix={creatorName}
  requiresSubscription={subCtx.requiresSubscription}
  hasSubscription={subCtx.hasSubscription}
  subscriptionCoversContent={subCtx.subscriptionCoversContent}
>
  {#snippet creatorAttribution()}
    <p class="content-detail__creator">
      <a href="/{data.username}" class="content-detail__creator-link">
        {m.content_detail_by_creator({ creator: creatorName })}
      </a>
    </p>
  {/snippet}

  {#snippet purchaseForm()}
    {#if accessState.loading}
      <div class="access-skeleton">
        <div class="skeleton skeleton--wide"></div>
        <div class="skeleton skeleton--button"></div>
      </div>
    {:else}
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
    {/if}
  {/snippet}
</ContentDetailView>

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
              href={`/${data.username}/content/${item.slug ?? item.id}`}
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
{/key}

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
