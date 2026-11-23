<!--
  @component SubscribeNudge

  Asks a visitor to subscribe to the org, through the page's one floating
  banner (layout/DockBanner): attached to the dock on a phone, floating
  bottom-centre elsewhere. It renders nothing of its own (Codex-r9ws7).

  Engagement-gated: the offer waits until the visitor has scrolled ~40% of
  the viewport's height, so it never lands on the hero. Dismissing it is
  remembered by `$lib/collections/dismissals` under `dismissKey`, across
  pages and tab closes, for that collection's TTL (4 days by default).
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { dismiss, isDismissed } from '$lib/collections/dismissals';
  import {
    DOCK_BANNER_PRIORITY,
    offerDockBanner,
  } from '$lib/components/layout/DockBanner';

  interface Props {
    orgName: string;
    /** Storage key for dismissal — typically `subscribe-cta:${orgId}`. */
    dismissKey: string;
    /** Where Subscribe goes: the pricing page, where login waits until a
        tier is picked so the redirect can carry the tier and interval. */
    href?: string;
  }

  const { orgName, dismissKey, href = '/pricing' }: Props = $props();

  // The persisted dismissal is read once on the client before the first
  // offer, so a dismissed nudge never shows for a frame.
  let ready = $state(false);
  let dismissed = $state(false);
  let scrollY = $state(0);
  let innerHeight = $state(0);

  onMount(() => {
    dismissed = isDismissed(dismissKey);
    ready = true;
  });

  // Viewport-relative, so it is as patient on a phone as on a monitor.
  const engaged = $derived(innerHeight > 0 && scrollY > innerHeight * 0.4);

  offerDockBanner(() =>
    ready && engaged && !dismissed
      ? {
          id: `subscribe:${dismissKey}`,
          priority: DOCK_BANNER_PRIORITY.subscribe,
          region: 'Subscribe call to action',
          title: 'Become a member',
          subtitle: orgName,
          action: { label: 'Subscribe', href },
          dismiss: {
            label: 'Dismiss subscribe banner',
            onclick: () => {
              dismissed = true;
              dismiss(dismissKey);
            },
          },
        }
      : null
  );
</script>

<svelte:window bind:scrollY bind:innerHeight />
