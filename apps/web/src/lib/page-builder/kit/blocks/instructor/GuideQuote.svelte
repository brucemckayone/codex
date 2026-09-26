<!--
  @component GuideQuote

  A line in the guide's own words. `large` is the quote layout's centrepiece,
  set like a heading; otherwise it is a pull quote inside the story, marked by
  an accent rule. The opening mark hangs outside the text's edge, so the
  words — not the punctuation — line up with everything above them.
-->
<script lang="ts">
  import type { BlockEdit } from '../../model/types';
  import { editAttrs } from '../../primitives/edit';

  interface Props {
    text: string;
    large?: boolean;
    /** Set down the middle of a centred layout: no side rule, no hang. */
    centred?: boolean;
    edit?: BlockEdit | null;
  }

  const { text, large = false, centred = false, edit = null }: Props = $props();

  const attrs = $derived(editAttrs('instructor', 'quote', edit));
</script>

<blockquote
  class="quote"
  data-size={large ? 'large' : 'pull'}
  data-centred={centred ? '' : undefined}
>
  <p {...attrs}>{text}</p>
</blockquote>

<style>
  /* Resets the app's prose blockquote (brand bar, italic, secondary grey). */
  .quote {
    margin: 0;
    padding: 0;
    border: none;
    quotes: '“' '”' '‘' '’';
    color: var(--lp-ink);
    font-style: normal;
  }

  .quote p {
    max-inline-size: none;
    margin: 0;
    font-family: var(--lp-font-display);
    font-synthesis: none;
    text-wrap: balance;
  }

  .quote p::before {
    content: open-quote;
  }

  .quote p::after {
    content: close-quote;
  }

  .quote[data-size='pull'] {
    padding-inline-start: var(--space-5);
    border-inline-start: var(--lp-rule) var(--border-style) var(--lp-accent);
  }

  .quote[data-size='pull'] p {
    max-inline-size: var(--lp-measure-lead);
    font-size: var(--lp-size-title);
    font-weight: var(--lp-weight-title);
    line-height: var(--lp-leading-title);
    letter-spacing: var(--lp-tracking-title);
  }

  .quote[data-size='large'] p {
    max-inline-size: 24ch;
    font-size: var(--lp-size-heading);
    font-weight: var(--lp-weight-heading);
    line-height: var(--lp-leading-heading);
    letter-spacing: var(--lp-tracking-heading);
    text-indent: -0.42em;
  }

  .quote[data-centred] {
    padding-inline-start: 0;
    border-inline-start: none;
  }

  .quote[data-centred] p {
    margin-inline: auto;
  }

  /* Centred, a hanging mark would push the line off centre (Soft centres the
     quote layout too). */
  .quote[data-centred] p,
  :global(.lp[data-lp-style='soft']) .quote[data-size='large'] p {
    text-indent: 0;
  }
</style>
