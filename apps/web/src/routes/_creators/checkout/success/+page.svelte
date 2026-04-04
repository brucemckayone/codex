<!--
  @component CreatorCheckoutSuccessPage

  Thin wrapper around the shared CheckoutSuccess component.
  Computes creator-specific URLs and passes them as props.
-->
<script lang="ts">
  import { CheckoutSuccess } from '$lib/components/ui/CheckoutSuccess';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  const { data }: Props = $props();

  const contentUrl = $derived(
    data.username && data.contentSlug
      ? `/${data.username}/content/${data.contentSlug}`
      : data.username
        ? `/${data.username}/content`
        : '/'
  );

  const browseUrl = $derived(data.username ? `/${data.username}/content` : '/');
</script>

<CheckoutSuccess
  verification={data.verification}
  {contentUrl}
  {browseUrl}
  libraryUrl={browseUrl}
  titleSuffix="Creators"
/>
