<!--
  /admin shell (Codex-2hxff.28): the Support sub-nav above each page.

  The Queue link's count is streamed: the nav renders at once, without a
  number, and a count that fails to load shows no Badge rather than holding
  the nav up (data design §7). The count query is shared with the queue page,
  so settling an item and refreshing it updates both.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import TabLinks from '$lib/components/support/TabLinks.svelte';
  import { getSupportQueueCounts } from '$lib/remote/support.remote';

  const { children }: { children: Snippet } = $props();

  const countsQuery = getSupportQueueCounts();
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
