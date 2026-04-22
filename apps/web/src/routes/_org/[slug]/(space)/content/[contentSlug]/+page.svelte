<!--
  @component ContentDetailPage (Org)

  Thin wrapper around ContentDetailView for the org content detail route.
  Handles page-specific concerns: hydration, purchase form with use:enhance,
  and org-specific data derivations.

  Uses SvelteKit streaming: content + contentBodyHtml are awaited (SEO + first paint),
  while relatedContent and accessAndProgress are streamed as bare promises.
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { enhance } from '$app/forms';
  import { invalidate } from '$app/navigation';
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import { ContentDetailView, RelatedContent } from '$lib/components/content';
  import { hydrateIfNeeded } from '$lib/collections';
  import { formatPrice } from '$lib/utils/format';
  import { buildContentUrl } from '$lib/utils/subdomain';
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
  // Previously used contentCollection?.state.get(data.content.id) as an optimistic
  // lookup, but TanStack DB's internal state.get() returns wrong items after
  // collection hydration from explore, causing stale content on client-side navigation.
  const content = $derived(data.content);

  let purchasing = $state(false);

  /** Feature flag from org layout — when false, subscription UI is hidden */
  const enableSubscriptions = $derived(data.enableSubscriptions ?? true);

  // Subscription context — shared composable (see
  // `$lib/utils/subscription-context.svelte.ts`). Handles the two-layer
  // promise-seeded + live-collection-override pattern and the stale-promise
  // guard when navigating between content items.
  const subscription = useSubscriptionContext(() => ({
    subscriptionContext: data.subscriptionContext,
    organizationId: data.content.organizationId,
    enableSubscriptions,
    accessType: data.content.accessType,
    minimumTierId: data.content.minimumTierId,
  }));

  // Access state — resolved reactively from the streaming promise.
  // A single ContentDetailView stays mounted; only these props change.
  //
  // `streamingExpiresAt` is the ISO 8601 expiry of the signed R2 URL from
  // loadAccessAndProgress (Codex-1ywzr). Threaded into VideoPlayer /
  // AudioPlayer so they can pre-emptively refresh before the signature
  // lapses, and reactively refresh via the 403 / MEDIA_ERR_NETWORK path
  // if the pre-emptive one doesn't fire (e.g. backgrounded tab).
  let accessState = $state({
    // Seeded from the server load: `hasAccess` may already be true for
    // publicly-accessible content (accessType === 'free') even when the
    // streaming promise is absent (unauthenticated visitor) or has yet to
    // resolve. The $effect below keeps this in sync with the streamed
    // result once it lands.
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

  // Track which promise we've already resolved to prevent re-triggering
  let resolvedPromise: Promise<unknown> | null = null;

  $effect(() => {
    const promise = data.accessAndProgress;
    // untrack writes to avoid reactive loop (reading promise, writing accessState)
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
        // No streaming promise (unauthenticated visitor). Body access still
        // follows the server-computed policy — keep it honest by reading
        // data.hasAccess rather than forcing false.
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
  Key by content ID to force full re-mount when navigating between content items.
  Without this, SvelteKit reuses the same component instance for different [contentSlug]
  params, and internal $state/$effect from the previous item can persist.
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
    // Clear the reason optimistically, then force a server-load re-run
    // so the next streaming URL request can succeed. `app:auth` is the
    // narrowest dep shared across content-detail loads.
    accessState.revocationReason = null;
    void invalidate('app:auth');
  }}
  progress={accessState.progress}
  isAuthenticated={!!data.accessAndProgress}
  formResult={form}
  {purchasing}
  {creatorName}
  {titleSuffix}
  requiresSubscription={subscription.subCtx.requiresSubscription}
  hasSubscription={subscription.subCtx.hasSubscription}
  subscriptionCoversContent={subscription.subCtx.subscriptionCoversContent}
>
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
      hrefBuilder={(item) => buildContentUrl(page.url, item)}
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
