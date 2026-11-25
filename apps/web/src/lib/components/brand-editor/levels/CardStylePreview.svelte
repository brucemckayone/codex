<!--
  @component CardStylePreview

  One option's sample card in the brand editor's Cards control (Codex-7104r):
  the same item drawn in `style`, with the org's dial values for that style.
  Today is the platform's own ContentCard. Its context is pinned to Today
  here, so the sample stays the real Today card whatever the page around it
  draws. Every other style is StyledCard, from the same adapter the live
  cards use.

  The caller renders it inert: it is a picture of a card, not a card.
-->
<script lang="ts">
  import type { CardStyle } from '@codex/validation';
  import { type ContentCardInput, contentToCard } from '$lib/card-styles/adapters';
  import { setCardStyleContext } from '$lib/card-styles/context';
  import ContentCard from '$lib/components/ui/ContentCard/ContentCard.svelte';
  import { StyledCard } from '$lib/components/ui/StyledCard';

  interface Props {
    style: CardStyle;
    vars: Readonly<Record<string, string>>;
    sample: ContentCardInput;
  }

  const { style, vars, sample }: Props = $props();

  setCardStyleContext({ style: 'today', vars: {} });

  const card = $derived(contentToCard({ ...sample, variant: 'grid' }));
</script>

{#if style === 'today'}
  <ContentCard
    id="card-style-sample"
    variant="grid"
    title={sample.title}
    href={sample.href}
    thumbnail={sample.thumbnail}
    description={sample.description}
    contentType={sample.contentType}
    duration={sample.duration}
    creator={sample.creator}
    price={sample.price}
  />
{:else}
  <StyledCard {card} {style} {vars} />
{/if}
