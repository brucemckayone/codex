<!--
  @component MediaUseChip

  "In use by N" under a library item's title (Codex-6sbn1, owner round 2
  decision 2: variant A). Tinted when anything published uses the item, grey
  when only drafts do; a muted "Not in use" when nothing does. Tap it for
  where: a popover under the chip on a wide screen, a sheet from the bottom
  on a phone.

  The count comes with the list (`usage` on each `GET /api/media` row, one
  query per page); the popover reads the full list when it opens, from the
  same lookup the delete guard runs. A worker older than this omits `usage`,
  and then the chip draws nothing rather than claim "Not in use".

  @prop mediaId  The item
  @prop usage    Its `{ total, live }` from the list row, when the worker sent it
-->
<script lang="ts">
  import type { MediaUsageCounts } from '@codex/shared-types';
  import { Button } from '$lib/components/ui';
  import * as Popover from '$lib/components/ui/Popover';
  import { ChevronDownIcon, LinkIcon, RefreshCwIcon, XIcon } from '$lib/components/ui/Icon';
  import { getMediaUsage } from '$lib/remote/media.remote';
  import { queryErrorMessage } from '$lib/remote/query-result';
  import * as m from '$paraglide/messages';
  import MediaUsesList from './MediaUsesList.svelte';
  import MediaUsesSkeleton from './MediaUsesSkeleton.svelte';

  interface Props {
    mediaId: string;
    usage?: MediaUsageCounts;
  }

  const { mediaId, usage }: Props = $props();

  let open = $state(false);

  // Read while open only: closing releases it, so each open asks again.
  const usageQuery = $derived(open ? getMediaUsage(mediaId) : null);
  // A failed read wins over a value an earlier read left behind.
  const failed = $derived(queryErrorMessage(usageQuery?.error) !== null);
  const loaded = $derived(failed ? undefined : usageQuery?.current);

  const total = $derived(loaded?.total ?? usage?.total ?? 0);
  const live = $derived(loaded?.live ?? usage?.live ?? 0);
</script>

{#if usage}
  <div class="use-row">
    {#if usage.total === 0}
      <span class="use-none">{m.media_chip_not_in_use()}</span>
    {:else}
      <Popover.Root bind:open positioning={{ placement: 'bottom-start' }}>
        <Popover.Trigger
          class="use-chip"
          data-tone={usage.live > 0 ? 'live' : 'draft'}
          aria-haspopup="dialog"
          aria-label={m.media_chip_label({ count: usage.total })}
        >
          <LinkIcon size={12} />
          {m.media_chip_in_use({ count: usage.total })}
          <span class="use-chip__chev" aria-hidden="true"><ChevronDownIcon size={12} /></span>
        </Popover.Trigger>
        <Popover.Content class="uses-pop" aria-label={m.media_uses_where_title()}>
          <span class="uses-pop__grip" aria-hidden="true"></span>
          <div class="uses-pop__head">
            <h2 class="uses-pop__title">{m.media_chip_in_use({ count: total })}</h2>
            <Popover.Close class="uses-pop__close" aria-label={m.common_close()}>
              <XIcon size={16} />
            </Popover.Close>
          </div>
          <div class="uses-pop__body">
            {#if failed}
              <p class="uses-pop__failed" role="alert">{m.media_uses_failed()}</p>
              <div>
                <Button size="xs" variant="secondary" onclick={() => usageQuery?.refresh()}>
                  <RefreshCwIcon size={12} />
                  {m.media_tile_try_again()}
                </Button>
              </div>
            {:else if loaded}
              <MediaUsesList usage={loaded} />
            {:else}
              <MediaUsesSkeleton />
            {/if}
          </div>
          <p class="uses-pop__foot">
            {live > 0 ? m.media_uses_foot_live() : m.media_uses_foot_drafts()}
          </p>
        </Popover.Content>
      </Popover.Root>
    {/if}
  </div>
{/if}

<style>
  .use-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--space-6);
  }

  .use-none {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .use-row :global(.use-chip) {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    padding: var(--space-0-5) var(--space-2-5);
    border-radius: var(--radius-full);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    line-height: var(--leading-none);
    color: var(--color-text);
    cursor: pointer;
    border: var(--border-width) var(--border-style)
      color-mix(in oklab, var(--color-interactive) 35%, var(--color-border));
    background: color-mix(in oklab, var(--color-interactive) 9%, var(--color-surface));
    transition: var(--transition-colors);
  }

  .use-row :global(.use-chip > svg:first-child) {
    color: var(--color-interactive);
  }

  .use-row :global(.use-chip[data-tone='draft']) {
    border-color: var(--color-border);
    background: var(--color-surface-secondary);
  }

  .use-row :global(.use-chip[data-tone='draft'] > svg:first-child) {
    color: var(--color-text-secondary);
  }

  .use-row :global(.use-chip:focus-visible),
  .use-row :global(.use-chip[data-state='open']) {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .use-chip__chev {
    display: inline-flex;
    color: var(--color-text-secondary);
  }

  /* ── The popover (a sheet on a phone) ─────────────────────────────── */
  /* `div.` outranks PopoverContent's own scoped `.popover-content` rule
     (padding, a 20rem cap) whatever order the two stylesheets load in. */
  :global(div.popover-content.uses-pop) {
    display: flex;
    flex-direction: column;
    width: 26rem;
    max-width: calc(100vw - var(--space-8));
    padding: 0;
    overflow: hidden;
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-xl);
  }

  .uses-pop__grip {
    display: none;
  }

  .uses-pop__head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
  }

  .uses-pop__title {
    flex: 1;
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .uses-pop__head :global(.uses-pop__close) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-8);
    height: var(--space-8);
    border: 0;
    border-radius: var(--radius-full);
    background: none;
    color: var(--color-text-secondary);
    cursor: pointer;
  }

  .uses-pop__head :global(.uses-pop__close:hover) {
    background: var(--color-surface-secondary);
    color: var(--color-text);
  }

  .uses-pop__head :global(.uses-pop__close:focus-visible) {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .uses-pop__body {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    max-height: 60vh;
    overflow-y: auto;
    padding: var(--space-2) var(--space-4) var(--space-3);
  }

  .uses-pop__failed {
    margin: var(--space-1) 0 0;
    font-size: var(--text-sm);
    color: var(--color-status-error-text);
  }

  .uses-pop__foot {
    margin: 0;
    padding: var(--space-3) var(--space-4);
    border-top: var(--border-width) var(--border-style) var(--color-border);
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--color-text-secondary);
  }

  /*
    A phone gets a sheet from the bottom. Melt positions the popover with
    inline top/left; `!important` is the one way a stylesheet outranks an
    inline style, and only this media query uses it. The spread shadow is the
    sheet's scrim.
  */
  @media (max-width: 39.9375rem) {
    :global(div.popover-content.uses-pop) {
      position: fixed !important;
      inset: auto 0 0 0 !important;
      width: 100%;
      max-width: none;
      border-bottom: 0;
      border-radius: var(--radius-xl) var(--radius-xl) 0 0;
      box-shadow: 0 0 0 100vmax var(--color-surface-overlay);
    }

    .uses-pop__grip {
      display: block;
      width: var(--space-10);
      height: var(--space-1);
      margin: var(--space-2) auto 0;
      border-radius: var(--radius-full);
      background: var(--color-border-strong);
    }
  }
</style>
