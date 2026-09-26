<!--
  @component SideLabel

  The creator's few words over one side ("Where you are now"), edited in place
  on the canvas. The after side's label takes the accent: it names where the
  visitor is going.
-->
<script lang="ts">
  import type { BlockEdit } from '../../model/types';
  import { editAttrs } from '../../primitives/edit';
  import { type Side, sideLabelId } from './change';

  interface Props {
    side: Side;
    text: string;
    anchor: string;
    edit: BlockEdit | null;
  }

  const { side, text, anchor, edit }: Props = $props();

  const attrs = $derived(editAttrs('transformation', `${side}Label`, edit));
</script>

<p class="tf-label" data-side={side} id={sideLabelId(anchor, side)} {...attrs}>{text}</p>

<style>
  .tf-label {
    margin: 0;
    color: var(--lp-ink-soft);
    font-size: var(--lp-size-label);
    font-weight: var(--lp-weight-label);
    letter-spacing: var(--lp-tracking-label);
    line-height: var(--lp-leading-title);
  }

  .tf-label[data-side='after'] {
    color: var(--lp-accent);
  }
</style>
