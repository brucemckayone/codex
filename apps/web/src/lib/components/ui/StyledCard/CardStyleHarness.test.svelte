<!--
  Test-only harness: a shared card under an org's card style, set the way
  the org layout sets it (`setCardStyleContext`, an object of getters).
  Named `*.test.svelte` (a fixture) so the vitest include globs never collect
  it.
-->
<script lang="ts">
  import type { CardStyle } from '@codex/validation';
  import type { ComponentProps } from 'svelte';
  import { setCardStyleContext } from '$lib/card-styles/context';
  import JourneyEntryCard from '$lib/components/journeys/JourneyEntryCard.svelte';
  import type { JourneyEntryCardProps } from '$lib/components/journeys/journey-entry-card';
  import ContentCard from '../ContentCard/ContentCard.svelte';

  interface Props {
    style: CardStyle;
    vars?: Record<string, string>;
    content?: ComponentProps<typeof ContentCard>;
    journey?: JourneyEntryCardProps;
  }

  const { style, vars = {}, content, journey }: Props = $props();

  setCardStyleContext({
    get style() {
      return style;
    },
    get vars() {
      return vars;
    },
  });
</script>

{#if content}
  <ContentCard {...content} />
{:else if journey}
  <JourneyEntryCard {...journey} />
{/if}
