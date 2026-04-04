<!--
  @component ContentDetailPage (Org)

  Thin wrapper around ContentDetailView for the org content detail route.
  Handles page-specific concerns: hydration, purchase form with use:enhance,
  and org-specific data derivations.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import { ContentDetailView } from '$lib/components/content';
  import { hydrateIfNeeded } from '$lib/collections';
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

  let purchasing = $state(false);

  const creatorName = $derived(data.content.creator?.name ?? data.content.creator?.email ?? '');
  const titleSuffix = $derived(data.org?.name ?? 'Codex');
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
  {titleSuffix}
  relatedContent={data.relatedContent}
  buildRelatedHref={(item) => buildContentUrl(page.url, item)}
>
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
