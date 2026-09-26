<!--
  @component Text

  Creator prose: plain text where a blank line starts a new paragraph. Each
  paragraph is its own `<p>`, on the public page and the canvas alike, so the
  inline editor re-joins them rather than flattening them (`editParagraphAttrs`).
-->
<script lang="ts">
  import { paragraphs } from '../model/read';
  import type { SectionTypeId } from '../model/ids';
  import type { BlockEdit } from '../model/types';
  import { editParagraphAttrs } from './edit';

  interface Props {
    text: string;
    size?: 'lead' | 'body' | 'small';
    tone?: 'ink' | 'soft';
    type: SectionTypeId;
    field?: string;
    edit?: BlockEdit | null;
    class?: string;
  }

  const {
    text,
    size = 'body',
    tone = 'soft',
    type,
    field,
    edit = null,
    class: className,
  }: Props = $props();

  const parts = $derived(paragraphs(text));
  const attrs = $derived(editParagraphAttrs(type, field, edit));
</script>

<div class="lp-text {className ?? ''}" data-size={size} data-tone={tone} {...attrs}>
  {#each parts as part, index (index)}
    <p>{part}</p>
  {/each}
</div>

<style>
  .lp-text {
    display: grid;
    gap: var(--lp-paragraph-gap);
    max-inline-size: var(--lp-measure);
    font-family: var(--lp-font-body);
    font-weight: var(--lp-weight-body);
    text-wrap: pretty;
  }

  .lp-text p {
    margin: 0;
  }

  .lp-text[data-size='lead'] {
    font-size: var(--lp-size-lead);
    line-height: var(--lp-leading-lead);
    max-inline-size: var(--lp-measure-lead);
  }

  .lp-text[data-size='body'] {
    font-size: var(--lp-size-body);
    line-height: var(--lp-leading-body);
  }

  .lp-text[data-size='small'] {
    font-size: var(--lp-size-small);
    line-height: var(--lp-leading-body);
  }

  .lp-text[data-tone='ink'] {
    color: var(--lp-ink);
  }

  .lp-text[data-tone='soft'] {
    color: var(--lp-ink-soft);
  }
</style>
