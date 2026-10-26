<!--
  @component OrgCheckoutSuccessPage

  Thin wrapper around the shared CheckoutSuccess component.
  Computes org-specific URLs and passes them as props.
-->
<script lang="ts">
  import { page } from '$app/state';
  import { buildContentUrl, buildPlatformUrl } from '$lib/utils/subdomain';
  import { CheckoutSuccess } from '$lib/components/ui/CheckoutSuccess';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  const { data }: Props = $props();

  // If the webhook hasn't fired yet (verification null / retries exhausted)
  // but we still have a contentSlug from the URL, route the user back to the
  // content page anyway — the access check on that page will gate streaming
  // and it's a more useful destination than /library. buildContentUrl uses
  // `slug ?? id` for the path so we pass the slug in both slots when the
  // verified id isn't available yet (typed fallback, not a real navigation id).
  // The player paywall's return carries no slug (Codex-2hxff.22 WEB-03): the
  // verified content id is the way there instead.
  const contentUrl = $derived(
    data.contentSlug
      ? buildContentUrl(page.url, {
          slug: data.contentSlug,
          id: data.verification?.content?.id ?? data.contentSlug
        })
      : data.verification?.content
        ? buildContentUrl(page.url, { id: data.verification.content.id })
        : '/library'
  );
</script>

<CheckoutSuccess
  verification={data.verification}
  verifyFailed={data.verifyFailed}
  unlock={data.unlock}
  {contentUrl}
  browseUrl="/explore"
  libraryUrl="/library"
  paymentHistoryUrl={buildPlatformUrl(page.url, '/account/payment')}
  titleSuffix={data.org?.name ?? 'Codex'}
/>
