<!--
  @component Heading

  A kit heading. The document LEVEL and the visual SIZE are separate on
  purpose: the page has one `<h1>` (the hero) whatever size it is drawn at,
  and a section heading may be drawn at display size without becoming an h1.

  Never faux-bold: `font-synthesis: none` lets a single-weight display face
  (Archivo Black, Anton…) render its real weight instead of a smeared
  synthetic one when the Style or brand asks for a heavier weight than exists.
-->
<script lang="ts">
  import type { SectionTypeId } from '../model/ids';
  import type { BlockEdit } from '../model/types';
  import { editAttrs } from './edit';

  interface Props {
    level: 1 | 2 | 3 | 4;
    size?: 'display' | 'heading' | 'title';
    text: string;
    type: SectionTypeId;
    /** The props key this heading edits inline on the canvas. */
    field?: string;
    edit?: BlockEdit | null;
    id?: string;
    class?: string;
  }

  const {
    level,
    size = 'heading',
    text,
    type,
    field,
    edit = null,
    id,
    class: className,
  }: Props = $props();

  const tag = $derived(`h${level}`);
  const attrs = $derived(editAttrs(type, field, edit));
</script>

<svelte:element
  this={tag}
  {id}
  class="lp-heading {className ?? ''}"
  data-size={size}
  {...attrs}>{text}</svelte:element
>

<style>
  .lp-heading {
    margin: 0;
    font-family: var(--lp-font-display);
    font-synthesis: none;
    color: inherit;
    text-wrap: balance;
    overflow-wrap: break-word;
    hyphens: manual;
  }

  /* `--lp-display-scale` is a layout's hook (a split hero draws the display
     size smaller): a separate property, because re-declaring
     `--lp-size-display` in terms of itself would be a cycle. */
  .lp-heading[data-size='display'] {
    font-size: calc(var(--lp-size-display) * var(--lp-display-scale, 1));
    font-weight: var(--lp-weight-display);
    line-height: var(--lp-leading-display);
    letter-spacing: var(--lp-tracking-display);
    text-transform: var(--lp-case-display);
  }

  .lp-heading[data-size='heading'] {
    font-size: var(--lp-size-heading);
    font-weight: var(--lp-weight-heading);
    line-height: var(--lp-leading-heading);
    letter-spacing: var(--lp-tracking-heading);
  }

  .lp-heading[data-size='title'] {
    font-size: var(--lp-size-title);
    font-weight: var(--lp-weight-title);
    line-height: var(--lp-leading-title);
    letter-spacing: var(--lp-tracking-title);
  }
</style>
