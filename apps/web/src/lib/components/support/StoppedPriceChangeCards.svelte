<!--
  @component StoppedPriceChangeCards

  Queue › Price moves' stopped changes (Codex-2hxff.86; batch C1 Part B page
  6, M7-M8). Every email in a change's first batch was refused, so the run
  stopped it: one card for the whole change, not a row per person, naming
  the cause the run saw and the error id that joins its log line. Restart is
  for after the cause is fixed (owner decision Q6); the card then says when
  the run restarts it, and stays until it does.

  @prop {StoppedPriceChange[]} changes
  @prop {(change: StoppedPriceChange) => void} onRestart
  @prop {string | null} [busyId] - The change whose Restart is running.
-->
<script lang="ts">
  import type { StoppedPriceChange } from '@codex/admin';
  import * as m from '$paraglide/messages';
  import { Button } from '$lib/components/ui';
  import ChangeCard from './ChangeCard.svelte';
  import { stoppedBadge, stoppedFacts, stoppedSub, stoppedTitle } from './price-moves-view';

  interface Props {
    changes: StoppedPriceChange[];
    onRestart: (change: StoppedPriceChange) => void;
    busyId?: string | null;
  }

  const { changes, onRestart, busyId = null }: Props = $props();
</script>

<ul class="change-cards">
  {#each changes as change (change.changeId)}
    {#snippet restart()}
      <Button
        variant="secondary"
        size="sm"
        loading={busyId === change.changeId}
        disabled={busyId !== null && busyId !== change.changeId}
        onclick={() => onRestart(change)}
        data-testid="price-change-restart"
      >
        {m.support_queue_moves_action_restart()}
      </Button>
    {/snippet}
    <ChangeCard
      tone="stopped"
      title={stoppedTitle(change)}
      sub={stoppedSub(change)}
      badge={stoppedBadge(change)}
      facts={stoppedFacts(change)}
      actions={change.restart ? undefined : restart}
      testid="stopped-price-change"
    />
  {/each}
</ul>

<style>
  .change-cards {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }
</style>
