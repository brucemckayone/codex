<!--
  @component Eyebrow

  The optional short label above a heading: the kit's kicker. It is in the
  org's own label case (`--text-transform-label`, uppercase unless the org or
  the page chose otherwise), so it reads like the kickers on the org's own
  pages; uppercase, it takes the org's label tracking (`kit.css`). Styles vary
  it only through tokens — weight, its tracking when it is not uppercase, and
  Soft's pill fill.
-->
<script lang="ts">
  import type { SectionTypeId } from '../model/ids';
  import type { BlockEdit } from '../model/types';
  import { editAttrs } from './edit';

  interface Props {
    text: string;
    type: SectionTypeId;
    field?: string;
    edit?: BlockEdit | null;
    class?: string;
  }

  const { text, type, field = 'eyebrow', edit = null, class: className }: Props = $props();

  const attrs = $derived(editAttrs(type, field, edit));
</script>

<p class="lp-eyebrow {className ?? ''}" {...attrs}>{text}</p>

<style>
  .lp-eyebrow {
    justify-self: start;
    margin: 0;
    padding: var(--lp-eyebrow-pad);
    border-radius: var(--lp-eyebrow-radius);
    background: color-mix(
      in oklab,
      var(--lp-panel) calc(var(--lp-eyebrow-fill) * 100%),
      transparent
    );
    color: var(--lp-accent);
    font-family: var(--lp-font-body);
    font-size: var(--lp-size-label);
    font-weight: var(--lp-weight-label);
    letter-spacing: var(--lp-tracking-label);
    text-transform: var(--lp-case-label);
    line-height: var(--lp-leading-title);
  }
</style>
