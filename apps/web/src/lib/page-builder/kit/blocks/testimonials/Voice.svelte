<!--
  @component Voice

  One quote and who said it. `grid` and `quiet` set it in the body face to be
  read; `lead` and `monument` set it like a heading, a step smaller the more it
  says, so a long quote stays a readable measure and a short one fills its
  stage. The opening mark hangs outside the text's edge so the words line up;
  the monument stands its mark above it instead.
-->
<script lang="ts">
  import type { Testimonial } from './voices';

  interface Props {
    voice: Testimonial;
    size?: 'grid' | 'quiet' | 'lead' | 'monument';
    centred?: boolean;
  }

  const { voice, size = 'grid', centred = false }: Props = $props();
</script>

<figure
  class="voice"
  data-size={size}
  data-length={voice.length}
  data-centred={centred ? '' : undefined}
>
  <blockquote class="voice__quote"><p>{voice.quote}</p></blockquote>
  {#if voice.name || voice.detail}
    <figcaption class="voice__by">
      {#if voice.name}<span class="voice__name">{voice.name}</span>{/if}
      {#if voice.detail}<span class="voice__detail">{voice.detail}</span>{/if}
    </figcaption>
  {/if}
</figure>

<style>
  .voice {
    display: grid;
    align-content: start;
    gap: var(--space-4);
    margin: 0;
    color: var(--lp-ink);
  }

  /* Resets the app's prose blockquote (brand bar, italic, secondary grey). */
  .voice__quote {
    margin: 0;
    padding: 0;
    border: none;
    quotes: '“' '”' '‘' '’';
    color: inherit;
    font-style: normal;
  }

  .voice__quote p {
    max-inline-size: none;
    margin: 0;
    font-family: var(--lp-font-body);
    font-size: var(--lp-size-lead);
    line-height: var(--lp-leading-lead);
    text-wrap: pretty;
    text-indent: -0.4em;
  }

  .voice__quote p::before {
    content: open-quote;
  }

  .voice__quote p::after {
    content: close-quote;
  }

  .voice[data-size='grid'][data-length='long'] p,
  .voice[data-size='quiet'] p {
    font-size: var(--lp-size-body);
    line-height: var(--lp-leading-body);
  }

  /* ── lead / monument: set like headings ────────────────────────────────── */
  .voice:is([data-size='lead'], [data-size='monument']) p {
    --_size: calc((var(--lp-size-heading) + var(--lp-size-title)) / 2);
    font-family: var(--lp-font-display);
    font-size: var(--_size);
    font-weight: var(--lp-weight-heading);
    font-synthesis: none;
    line-height: var(--lp-leading-heading);
    letter-spacing: var(--lp-tracking-heading);
    text-wrap: balance;
    text-indent: -0.42em;
  }

  .voice[data-size='lead'] p {
    max-inline-size: 30ch;
  }

  .voice[data-size='monument'] p {
    max-inline-size: 26ch;
  }

  .voice[data-size='monument'][data-length='short'] p {
    --_size: var(--lp-size-heading);
    max-inline-size: 20ch;
  }

  .voice:is([data-size='lead'], [data-size='monument'])[data-length='long'] p {
    --_size: var(--lp-size-title);
    max-inline-size: 38ch;
    font-weight: var(--lp-weight-title);
    line-height: var(--lp-leading-title);
    letter-spacing: var(--lp-tracking-title);
  }

  .voice:is([data-size='lead'], [data-size='monument']) .voice__by {
    font-size: var(--lp-size-body);
  }

  /* Wide, the lead's byline signs off at the panel's far corner, so the
     measured quote and its name fill the plate between them. */
  @container (min-width: 60rem) {
    .voice[data-size='lead'] {
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: end;
      column-gap: var(--lp-gap);
    }

    .voice[data-size='lead'] .voice__by {
      text-align: end;
    }
  }

  /* The monument's opening mark stands above it, large; the closing one goes. */
  .voice[data-size='monument'] p::before {
    display: block;
    margin-block-end: -0.42em;
    color: var(--lp-accent);
    font-size: 2.4em;
    line-height: 1;
  }

  .voice[data-size='monument'] p::after {
    content: no-close-quote;
  }

  .voice[data-centred] {
    justify-items: center;
    text-align: center;
  }

  .voice[data-centred] p {
    margin-inline: auto;
    text-indent: 0;
  }

  /* ── who said it ───────────────────────────────────────────────────────── */
  .voice__by {
    display: grid;
    gap: var(--space-0-5);
    margin: 0;
    color: var(--lp-ink);
    font-size: var(--lp-size-small);
    line-height: var(--lp-leading-title);
  }

  .voice__name {
    font-weight: var(--font-semibold);
  }

  .voice__detail {
    color: var(--lp-ink-soft);
  }
</style>
