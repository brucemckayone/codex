<script lang="ts">
  import StudioMediaPage from '$lib/components/studio/StudioMediaPage.svelte';
  import { listMedia } from '$lib/remote/media.remote';

  let { data } = $props();

  type MediaList = Awaited<ReturnType<typeof listMedia>>;

  /** The latest refetch, for the load it refreshed: a navigation drops it. */
  let refetched = $state.raw<{ of: typeof data; list: MediaList } | null>(null);

  const view = $derived(
    refetched?.of === data
      ? {
          ...data,
          mediaItems: refetched.list?.items ?? [],
          pagination: refetched.list?.pagination ?? data.pagination,
        }
      : data
  );

  /*
   * The load paints first; a refetch asks the remote query directly. Called
   * outside a reactive context it always fetches, and it REJECTS on failure,
   * so the page keeps its grid. invalidate() would re-run the load, and a
   * load that throws swaps in +error.svelte, unmounting a running upload.
   */
  async function refresh() {
    const of = data;
    const { status, mediaType } = of.filters;
    const list = await listMedia({
      page: of.pagination.page,
      limit: of.pagination.limit,
      ...(status !== 'all' && { status }),
      ...(mediaType !== 'all' && { mediaType }),
    });
    if (data === of) refetched = { of, list };
  }
</script>

<StudioMediaPage data={view} studioName="My Studio" onRefresh={refresh} />
