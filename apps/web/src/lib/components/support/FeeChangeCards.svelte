<!--
  @component FeeChangeCards

  Queue › Fee notices' cards (Codex-2hxff.33; batch C1 Part B page 5): one
  per fee rise that hasn't started, waiting for its emails or dated. There is
  no fee screen anywhere else, so this is also where the platform owner sees
  a waiting rise and its date. A card stays until the rise starts (F8).

  @prop {FeeChangeCard[]} cards
-->
<script lang="ts">
  import type { FeeChangeCard } from '@codex/admin';
  import ChangeCard from './ChangeCard.svelte';
  import { changeBadge, changeFacts, changeSub, changeTitle } from './fee-notices-view';

  const { cards }: { cards: FeeChangeCard[] } = $props();
</script>

<ul class="change-cards">
  {#each cards as card (card.changeId)}
    <ChangeCard
      title={changeTitle(card)}
      sub={changeSub(card)}
      badge={changeBadge(card)}
      facts={changeFacts(card)}
      testid="fee-change-card"
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
