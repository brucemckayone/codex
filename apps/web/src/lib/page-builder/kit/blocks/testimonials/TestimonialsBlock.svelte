<!--
  @component TestimonialsBlock

  What members say: the course's own testimonials first, then any the creator
  adds. Five layouts, and none drops a voice:
    grid     — every quote given the same space, under a rule; no cards
    featured — the first quote large in the section's one filled panel, the
               others in a quieter row beneath
    quote    — the first quote as the monument, centred (lit from behind in
               Cinematic); the others follow quietly under it
    marquee  — the quotes drift slowly across the page on a strip that runs
               to its edges, with a pause button (TestimonialsMarquee)
    wall     — every quote on one masonry wall, the first featured
               (TestimonialsWall)

  No star ratings, no invented avatars. No quotes at all: the public page
  keeps only the words; the canvas asks for some.
-->
<script lang="ts">
  import { featuredScheme } from '../../model/resolve';
  import type { BlockProps } from '../../model/types';
  import { getKitPage } from '../../page-context';
  import ButtonRow from '../../primitives/ButtonRow.svelte';
  import Eyebrow from '../../primitives/Eyebrow.svelte';
  import Heading from '../../primitives/Heading.svelte';
  import Text from '../../primitives/Text.svelte';
  import { TESTIMONIALS_EMPTY, testimonialsDefinition } from './definition';
  import TestimonialsMarquee from './TestimonialsMarquee.svelte';
  import TestimonialsWall from './TestimonialsWall.svelte';
  import Voice from './Voice.svelte';
  import { type Testimonial, voices } from './voices';

  const LAYOUTS = ['grid', 'featured', 'quote', 'marquee', 'wall'] as const;

  const { props, section, context, edit }: BlockProps = $props();

  const page = getKitPage();
  const content = $derived(testimonialsDefinition.coerce(props));
  const all = $derived(voices(context.testimonials, content.items));
  const layout = $derived(
    LAYOUTS.find((id) => id === section.layout) ?? 'grid'
  );
  const featured = $derived(featuredScheme(page.style, section.scheme));
  const asks = $derived(Boolean(content.ctaLabel || content.note));
  const headed = $derived(Boolean(content.eyebrow || content.heading || content.body));
</script>

{#snippet list(entries: Testimonial[], size: 'grid' | 'quiet', centred: boolean)}
  <ul class="tm-list" data-count={entries.length}>
    {#each entries as entry (entry.key)}
      <li><Voice voice={entry} {size} {centred} /></li>
    {/each}
  </ul>
{/snippet}

<div class="tm" class:lp-bleed={layout === 'marquee'} data-layout={layout}>
  {#if headed}
    <header class="tm__head">
      {#if content.eyebrow}<Eyebrow text={content.eyebrow} type="testimonials" {edit} />{/if}
      {#if content.heading}
        <!-- Under a monument the heading steps aside: the quote is the headline. -->
        <Heading
          level={section.headingLevel}
          size={layout === 'quote' ? 'title' : 'heading'}
          text={content.heading}
          type="testimonials"
          field="heading"
          {edit}
        />
      {/if}
      {#if content.body}
        <Text text={content.body} size="lead" type="testimonials" field="body" {edit} />
      {/if}
    </header>
  {/if}

  {#if all.length === 0}
    {#if edit}<p class="tm__empty" data-lp-edit-only>{TESTIMONIALS_EMPTY}</p>{/if}
  {:else if layout === 'quote'}
    <div class="tm-monument">
      <span class="lp-atmos tm-monument__glow" aria-hidden="true"></span>
      <Voice voice={all[0]} size="monument" centred />
    </div>
    {#if all.length > 1}{@render list(all.slice(1), 'quiet', true)}{/if}
  {:else if layout === 'featured'}
    <div class="tm-lead" data-lp-scheme={featured}>
      <Voice voice={all[0]} size="lead" />
    </div>
    {#if all.length > 1}{@render list(all.slice(1), 'quiet', false)}{/if}
  {:else if layout === 'marquee'}
    <TestimonialsMarquee voices={all} />
  {:else if layout === 'wall'}
    <TestimonialsWall voices={all} {featured} />
  {:else}
    {@render list(all, 'grid', false)}
  {/if}

  {#if asks}
    <ButtonRow
      {context}
      section="testimonials"
      label={content.ctaLabel}
      note={content.note}
      size="md"
      {edit}
    />
  {/if}
</div>

<style>
  .tm,
  .tm__head {
    display: grid;
    gap: var(--lp-stack);
    align-content: start;
  }

  .tm {
    gap: var(--lp-gap);
  }

  /* The moving strip runs to the section's edges (it carries words there, so
     the block is `.lp-bleed`, 03 X10); everything else keeps the column. The
     section's own tracks, with no column gap, which would narrow the content
     track and push it off the section's. */
  .tm.lp-bleed {
    grid-template-columns: inherit;
    column-gap: 0;
  }

  .tm.lp-bleed > :global(*) {
    grid-column: content;
    min-inline-size: 0;
  }

  .tm.lp-bleed > :global(.tm-marquee) {
    grid-column: bleed;
  }

  /* The heading measures itself in its own `ch`, not the body face's. */
  .tm__head :global(.lp-heading[data-size='heading']) {
    max-inline-size: 20ch;
  }

  /* global.css caps every `p` at 65ch; the prompt spans its region. */
  .tm__empty {
    max-inline-size: none;
    margin: 0;
    padding: var(--space-6);
    border: var(--lp-border) var(--border-style-dashed) var(--lp-button-line);
    border-radius: var(--lp-radius-card);
    color: var(--lp-ink-soft);
    font-size: var(--lp-size-small);
    text-align: center;
  }

  /* ── the quotes, side by side ──────────────────────────────────────────── */
  .tm-list {
    display: grid;
    gap: var(--space-10) var(--lp-gap);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* base.css spaces every `li` but the last, which unevens a row. */
  .tm-list > li {
    margin: 0;
    padding-block-start: var(--space-5);
    border-block-start: var(--lp-border) var(--border-style) var(--lp-line);
  }

  .tm-list[data-count='1'] {
    max-inline-size: var(--lp-measure);
  }

  @container (min-width: 40rem) {
    .tm-list:not([data-count='1']) {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  /* Three to a row, except where two divides the set evenly. */
  @container (min-width: 62rem) {
    .tm-list:not([data-count='1'], [data-count='2'], [data-count='4']) {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }

  /* ── featured: the section's one filled panel ──────────────────────────── */
  .tm-lead {
    padding: clamp(var(--space-6), var(--space-4) + 3cqi, var(--space-12));
    border-radius: var(--lp-radius-card);
    background: var(--lp-bg);
    color: var(--lp-ink);
  }

  /* ── quote: the monument, centred, the others under it ─────────────────── */
  .tm[data-layout='quote'] {
    --lp-actions-align: center;
    justify-items: center;
    text-align: center;
  }

  .tm[data-layout='quote'] .tm__head {
    justify-items: center;
  }

  .tm[data-layout='quote'] :global(:is(.lp-eyebrow, .lp-text)) {
    justify-self: center;
    margin-inline: auto;
  }

  .tm[data-layout='quote'] > :is(.tm-monument, .tm-list) {
    justify-self: stretch;
  }

  .tm[data-layout='quote'] > .tm-list[data-count='1'] {
    justify-self: center;
  }

  .tm-monument {
    position: relative;
    isolation: isolate;
    padding-block: var(--space-6);
  }

  /* The glow belongs to Cinematic's dark room only; on a light band it would
     be a gradient wash. */
  .tm-monument__glow {
    display: none;
    --lp-atmos-a: 30% 40%;
    --lp-atmos-b: 72% 60%;
  }

  :global(.lp[data-lp-style='cinematic']) .tm-monument__glow {
    display: block;
  }

  /* ── Bold: hard ink rules over open columns ────────────────────────────── */
  :global(.lp[data-lp-style='bold']) .tm-list > li {
    border-block-start: var(--lp-rule) var(--border-style) var(--lp-ink);
  }

  /* ── Soft: outlined rounded tiles, and a centred head over them ────────── */
  :global(.lp[data-lp-style='soft']) .tm-list {
    row-gap: var(--lp-gap);
  }

  :global(.lp[data-lp-style='soft']) .tm-list > li {
    padding: var(--space-6);
    border: var(--lp-border) var(--border-style) var(--lp-line);
    border-radius: var(--lp-radius-card);
  }

  :global(.lp[data-lp-style='soft']) .tm[data-layout='grid'] {
    --lp-actions-align: center;
  }

  :global(.lp[data-lp-style='soft']) .tm[data-layout='grid'] .tm__head {
    justify-items: center;
    text-align: center;
  }

  :global(.lp[data-lp-style='soft']) .tm[data-layout='grid'] :global(.lp-eyebrow) {
    justify-self: center;
  }
</style>
