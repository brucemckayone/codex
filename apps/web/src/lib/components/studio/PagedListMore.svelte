<!--
  @component PagedListMore

  A studio list's "Show more" (Codex-a6ofh.3.1): the media library's and the
  content list's, read from their `PagedList`. Renders nothing once every row
  is loaded. A page that failed says so above the button, which stays to try
  again.
-->
<script lang="ts">
  import { Button } from '$lib/components/ui';
  import * as m from '$paraglide/messages';

  interface Props {
    /** The list's paging, as `PagedList` keeps it. */
    list: {
      readonly left: number;
      /** Null until the view's first page has arrived (then `left` is 0). */
      readonly total: number | null;
      readonly moreLoading: boolean;
      readonly moreFailed: boolean;
      showMore(): Promise<void>;
    };
  }

  const { list }: Props = $props();
</script>

{#if list.left > 0 && list.total !== null}
  <div class="more">
    {#if list.moreFailed}
      <p class="more-failed" role="alert">{m.media_library_show_more_failed()}</p>
    {/if}
    <Button
      variant="secondary"
      loading={list.moreLoading}
      disabled={list.moreLoading}
      onclick={() => list.showMore()}
    >
      {m.media_library_show_more({ left: list.left, total: list.total })}
    </Button>
  </div>
{/if}

<style>
  .more {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    padding-top: var(--space-2);
  }

  .more-failed {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-status-error-text);
  }
</style>
