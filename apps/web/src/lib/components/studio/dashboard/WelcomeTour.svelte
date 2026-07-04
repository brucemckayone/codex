<!--
  @component WelcomeTour

  First-run welcome modal for the personal creator studio dashboard. Shows once
  — the very first time a creator lands on the studio (welcomeSeenAt === null),
  then patches welcomeSeen=true so it never reappears (tracked server-side, so
  it's once per creator across devices, not per browser).

  Self-contained: reads/writes the creator_onboarding record via remotes, so
  the dashboard only has to mount it.
-->
<script lang="ts">
  import { Button } from '$lib/components/ui';
  import * as Dialog from '$lib/components/ui/Dialog';
  import {
    getCreatorOnboarding,
    updateCreatorOnboarding,
  } from '$lib/remote/onboarding.remote';
  import * as m from '$paraglide/messages';

  const onboardingQuery = $derived(getCreatorOnboarding());

  let open = $state(false);
  // Guard so the show-once decision runs a single time even as the query
  // refreshes after we patch welcomeSeen.
  let handled = $state(false);

  $effect(() => {
    const record = onboardingQuery.current;
    if (!record || handled) return;
    handled = true;
    if (record.welcomeSeenAt === null) {
      open = true;
      updateCreatorOnboarding({ welcomeSeen: true }).catch(() => {});
    }
  });
</script>

{#if open}
  <Dialog.Root bind:open>
    <Dialog.Content size="sm">
      <Dialog.Header>
        <Dialog.Title>{m.welcome_tour_title()}</Dialog.Title>
        <Dialog.Description>{m.welcome_tour_body()}</Dialog.Description>
      </Dialog.Header>
      <Dialog.Footer>
        <Button variant="primary" onclick={() => (open = false)}>
          {m.welcome_tour_cta()}
        </Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
{/if}
