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
  import { invalidate } from '$app/navigation';
  import * as m from '$paraglide/messages';
  import { ContentDetailView, RelatedContent } from '$lib/components/content';
  import { hydrateIfNeeded } from '$lib/collections';
  import { formatPrice } from '$lib/utils/format';
  import { useSubscriptionContext } from '$lib/utils/subscription-context.svelte';
  import type { AccessRevocationReason } from '$lib/server/content-detail';
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

  // Subscription context — shared composable (see
  // `$lib/utils/subscription-context.svelte.ts`). Creator content is
  // org-scoped when `organizationId` is set; personal content (no org)
  // can never require a subscription, which the composable handles
  // naturally by returning `null` for liveSubscription.
  const subscription = useSubscriptionContext(() => ({
    subscriptionContext: data.subscriptionContext,
    organizationId: data.content.organizationId,
    enableSubscriptions: true,
    accessType: data.content.accessType,
    minimumTierId: data.content.minimumTierId,
  }));

  // Access state — resolved reactively from the streaming promise.
  // A single ContentDetailView stays mounted; only these props change.
  //
  // `streamingExpiresAt` (Codex-1ywzr) is the ISO 8601 expiry of the
  // signed R2 URL. Threaded into VideoPlayer/AudioPlayer so they can
  // pre-emptively refresh before the signature lapses and reactively
  // recover via the 403 / MEDIA_ERR_NETWORK path if needed.
  let accessState = $state({
    // Seeded from the server load: `hasAccess` may already be true for
    // publicly-accessible content (accessType === 'free') even without an
    // active streaming promise. Streamed result overrides when it lands.
    // svelte-ignore state_referenced_locally
    hasAccess: data.hasAccess === true,
    streamingUrl: null as string | null,
    waveformUrl: null as string | null,
    readyVariants: null as string[] | null,
    streamingExpiresAt: null as string | null,
    revocationReason: null as AccessRevocationReason | null,
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
            accessState.readyVariants = result.readyVariants ?? null;
            accessState.streamingExpiresAt = result.expiresAt ?? null;
            accessState.revocationReason =
              (result as { revocationReason?: AccessRevocationReason | null })
                .revocationReason ?? null;
            accessState.progress = result.progress;
            accessState.loading = false;
          }
        });
      } else if (!promise) {
        // No streaming promise (unauthenticated visitor). Keep body access
        // in step with the server-computed policy instead of forcing false.
        accessState.hasAccess = data.hasAccess === true;
        accessState.streamingUrl = null;
        accessState.waveformUrl = null;
        accessState.readyVariants = null;
        accessState.streamingExpiresAt = null;
        accessState.revocationReason = null;
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
  readyVariants={accessState.readyVariants}
  streamingExpiresAt={accessState.streamingExpiresAt}
  revocationReason={accessState.revocationReason}
  onaccessrestored={() => {
    accessState.revocationReason = null;
    void invalidate('app:auth');
  }}
  progress={accessState.progress}
  isAuthenticated={!!data.accessAndProgress}
  formResult={form}
  {purchasing}
  {creatorName}
  titleSuffix={creatorName}
  requiresSubscription={subscription.subCtx.requiresSubscription}
  hasSubscription={subscription.subCtx.hasSubscription}
  subscriptionCoversContent={subscription.subCtx.subscriptionCoversContent}
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
    <RelatedContent
      items={filtered}
      {creatorName}
      hrefBuilder={(item) => `/${data.username}/content/${item.slug ?? item.id}`}
      class="content-detail__related--streamed"
    />
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

  /* Skeleton row layout used by the {#await} pending state — the resolved
     state renders via the shared <RelatedContent> component, so only the
     skeleton selectors remain here. */
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
    .related-skeleton__grid {
      grid-template-columns: repeat(4, 1fr);
    }
  }

  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
</style>
