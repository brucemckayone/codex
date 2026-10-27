<!--
  @component CreatorCheckoutSuccessPage

  Thin wrapper around the shared CheckoutSuccess component.
  Computes creator-specific URLs and passes them as props.
-->
<script lang="ts">
  import { page } from '$app/state';
  import { CheckoutSuccess } from '$lib/components/ui/CheckoutSuccess';
  import { buildPlatformUrl } from '$lib/utils/subdomain';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  const { data }: Props = $props();

  // The player paywall's return carries no username or slug (Codex-2hxff.22
  // WEB-03), and verify names neither, while this host finds content by
  // username and slug only. Its `/` matches no route, so with no username
  // the links go to the platform: the library lists the purchase.
  const creatorContentUrl = $derived(
    data.username ? `/${data.username}/content` : null
  );
  const platformLibraryUrl = $derived(buildPlatformUrl(page.url, '/library'));

  const contentUrl = $derived(
    data.username && data.contentSlug
      ? `/${data.username}/content/${data.contentSlug}`
      : (creatorContentUrl ?? platformLibraryUrl)
  );

  const browseUrl = $derived(
    creatorContentUrl ?? buildPlatformUrl(page.url, '/discover')
  );
</script>

<CheckoutSuccess
  verification={data.verification}
  verifyFailed={data.verifyFailed}
  unlock={data.unlock}
  {contentUrl}
  {browseUrl}
  libraryUrl={creatorContentUrl ?? platformLibraryUrl}
  paymentHistoryUrl={buildPlatformUrl(page.url, '/account/payment')}
  titleSuffix="Creators"
/>
