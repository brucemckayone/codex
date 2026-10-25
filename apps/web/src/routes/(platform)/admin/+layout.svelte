<!--
  /admin shell (Codex-2hxff.28): the Support sub-nav above each page.

  The Queue link's count is streamed: the nav renders at once, without a
  number, and a count that fails to load shows no Badge rather than holding
  the nav up (data design §7). The layout holds the one counts query and
  provides it (`queue-counts.ts`): the pages refresh this instance, so a
  settle or a refund updates the badge, even after a failed first load.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import TabLinks from '$lib/components/support/TabLinks.svelte';
  import { provideQueueCounts } from '$lib/components/support/queue-counts';

  const { children }: { children: Snippet } = $props();

  const countsQuery = provideQueueCounts();
  const waiting = $derived(
    countsQuery.current
      ? countsQuery.current.failedRefunds + countsQuery.current.creatorDebts
      : null
  );

  const path = $derived(page.url.pathname);
</script>

<div class="admin">
  <TabLinks
    label={m.support_nav_label()}
    kicker={m.support_nav_label()}
    items={[
      {
        href: '/admin/refunds',
        label: m.support_nav_refunds(),
        current: path.startsWith('/admin/refunds'),
      },
      {
        href: '/admin/queue',
        label: m.support_nav_queue(),
        current: path.startsWith('/admin/queue'),
        count: waiting,
        countLabel: waiting
          ? m.support_nav_queue_waiting({ count: String(waiting) })
          : undefined,
      },
    ]}
  />
  {@render children()}
</div>

<style>
  .admin {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding-block: var(--space-6) var(--space-10);
    min-width: 0;
  }
</style>
