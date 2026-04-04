<!--
  @component CreatorContentDetailPage

  Thin wrapper around ContentDetailView for the creator content detail route.
  Handles page-specific concerns: hydration, purchase form with use:enhance,
  creator-specific attribution link, and creator-specific href builder.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { enhance } from '$app/forms';
  import * as m from '$paraglide/messages';
  import { ContentDetailView } from '$lib/components/content';
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

  let purchasing = $state(false);

  const creatorName = $derived(data.creatorProfile?.name ?? data.username);
  const priceCents = $derived(data.content.priceCents ?? null);

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

<ContentDetailView
  content={data.content}
  contentBodyHtml={data.contentBodyHtml}
  hasAccess={data.hasAccess}
  streamingUrl={data.streamingUrl}
  progress={data.progress}
  isAuthenticated={!!data.user}
  formResult={form}
  {purchasing}
  {creatorName}
  titleSuffix={creatorName}
  relatedContent={data.relatedContent}
  buildRelatedHref={(item) => `/${data.username}/content/${item.slug ?? item.id}`}
>
  {#snippet creatorAttribution()}
    <p class="content-detail__creator">
      <a href="/{data.username}" class="content-detail__creator-link">
        {m.content_detail_by_creator({ creator: creatorName })}
      </a>
    </p>
  {/snippet}

  {#snippet purchaseForm()}
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
  {/snippet}
</ContentDetailView>
