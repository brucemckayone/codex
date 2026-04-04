<!--
  @component OrgCheckoutSuccessPage

  Thin wrapper around the shared CheckoutSuccess component.
  Computes org-specific URLs and passes them as props.
-->
<script lang="ts">
  import { page } from '$app/state';
  import { buildContentUrl } from '$lib/utils/subdomain';
  import { CheckoutSuccess } from '$lib/components/ui/CheckoutSuccess';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  const { data }: Props = $props();

  const contentUrl = $derived(
    data.contentSlug && data.verification?.content
      ? buildContentUrl(page.url, { slug: data.contentSlug, id: data.verification.content.id })
      : '/library'
  );
</script>

<CheckoutSuccess
  verification={data.verification}
  {contentUrl}
  browseUrl="/explore"
  libraryUrl="/library"
  titleSuffix={data.org?.name ?? 'Codex'}
/>
