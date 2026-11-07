<!--
  @component PortalUses

  The portals a live piece is a practice in, in its Settings' fold
  (Codex-a6ofh.2.5, mockup W5a): "Also in the portal Svelte Mastery · stage
  2. Change that in the portal." A portal's stages are its own to change, so
  each line links to its curriculum. Read when the fold opens (it mounts
  then), from the creator's own read, draft portals too. A read that failed
  is said, with Try again, never taken for "in none".

  @prop {string} contentId - The piece
-->
<script lang="ts">
  import { getContentPortals } from '$lib/remote/content.remote';
  import { connectQueryState } from '$lib/utils/connect-readiness';
  import * as m from '$paraglide/messages';
  import { logReadFailure } from '../media-library/log-read-failure';
  import { joinNames } from '../plan-picker/select-from-tier';

  interface Props {
    contentId: string;
  }

  const { contentId }: Props = $props();

  const portals = $derived(getContentPortals(contentId));
  const unread = $derived(connectQueryState(portals).kind === 'failed');
  $effect(() => {
    if (portals.error != null) logReadFailure('studio_live.portals_unread', portals.error, { contentId });
  });

  /** A failure shows through the query's `.error`, logged above. */
  function reread() {
    portals.refresh().catch(() => undefined);
  }

  function stages(numbers: number[]): string {
    const listed = joinNames(numbers.map(String));
    return numbers.length === 1 ? m.studio_live_portal_stage({ number: listed }) : m.studio_live_portal_stages({ numbers: listed });
  }
</script>

{#if unread}
  <p class="portal-line">
    {m.studio_live_portals_unread()}
    <button type="button" class="portal-link" onclick={reread}>{m.common_try_again()}</button>
  </p>
{:else if portals.current}
  {#each portals.current.uses as use (use.courseId)}
    <p class="portal-line">
      {m.studio_live_portal_in()} <b>{use.title}</b> · {stages(use.stageNumbers)}.
      {#if use.pageId}
        <a class="portal-link" href="/studio/journeys/{use.pageId}/curriculum">{m.studio_live_portal_change()}</a>
      {/if}
    </p>
  {/each}
{/if}

<style>
  .portal-line {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .portal-line b {
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .portal-link {
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    font-weight: var(--font-medium);
    color: var(--color-link);
    text-decoration: underline;
    cursor: pointer;
  }

  .portal-link:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-sm);
  }
</style>
