<!--
  @component InstructorBlock

  The guide, with their portrait as the emotional centre. Three layouts:
    split    — portrait beside the story; Bold crops it hard to the band's
               full height, Soft arches it, Cinematic dissolves it into the
               dark; signed off with the signature, name and role
    quote    — the guide's own line, large, signed with a small portrait (in
               Cinematic the portrait becomes the room's backdrop instead)
    centered — portrait, story and credentials down the middle

  Portrait, clip and signature stream on `sellPreview`; the portrait holds
  its space while they load, and a clip adds a play button. No portrait: the
  public page drops it, the canvas asks for one. Every field the creator
  filled shows in every layout.
-->
<script lang="ts">
  import type { SellPreview } from '../../../render/types';
  import type { BlockProps } from '../../model/types';
  import { getKitPage } from '../../page-context';
  import ButtonRow from '../../primitives/ButtonRow.svelte';
  import Eyebrow from '../../primitives/Eyebrow.svelte';
  import Heading from '../../primitives/Heading.svelte';
  import Text from '../../primitives/Text.svelte';
  import ClipFrame from '../video/ClipFrame.svelte';
  import Watch from '../video/Watch.svelte';
  import { INSTRUCTOR_COPY } from './copy';
  import Credentials from './Credentials.svelte';
  import { INSTRUCTOR_PROMPT, instructorDefinition } from './definition';
  import GuideQuote from './GuideQuote.svelte';
  import Signoff from './Signoff.svelte';

  const { props, section, context, edit }: BlockProps = $props();

  const page = getKitPage();
  const content = $derived(instructorDefinition.coerce(props));
  const layout = $derived(
    section.layout === 'quote' || section.layout === 'centered' ? section.layout : 'split'
  );
  const alt = $derived(content.name ? INSTRUCTOR_COPY.portraitAlt(content.name) : '');
  const watchLabel = $derived(INSTRUCTOR_COPY.watch(content.name));
  const title = $derived(content.name ?? content.heading ?? context.course.title);
  const hasCta = $derived(Boolean(content.ctaLabel || content.note));

  const still = (preview: SellPreview | null) =>
    preview?.guidePortraitUrl ?? preview?.guideClip?.posterUrl ?? null;
</script>

{#snippet head(size: 'heading' | 'title')}
  {#if content.eyebrow || content.heading}
    <div class="guide__head">
      {#if content.eyebrow}<Eyebrow text={content.eyebrow} type="instructor" {edit} />{/if}
      {#if content.heading}
        <Heading
          level={section.headingLevel}
          {size}
          text={content.heading}
          type="instructor"
          field="heading"
          {edit}
        />
      {/if}
    </div>
  {/if}
{/snippet}

{#snippet story()}
  {#if content.body}
    <Text text={content.body} type="instructor" field="body" {edit} />
  {/if}
{/snippet}

{#snippet actions()}
  {#if hasCta}
    <div class="guide__actions">
      <ButtonRow {context} section="instructor" label={content.ctaLabel} note={content.note}
        size="md" {edit} />
    </div>
  {/if}
{/snippet}

<!-- `play`: the clip's button sits on the portrait (split, centred) or beside the name (quote). -->
{#snippet portrait(play: boolean, place: 'corner' | 'foot' = 'corner')}
  {#await context.sellPreview}
    <div class="guide__portrait" data-layout={layout}>
      <ClipFrame ratio="var(--_ratio)" pending />
    </div>
  {:then preview}
    {@const clip = preview?.guideClip ?? null}
    {#if still(preview) || clip}
      <div class="guide__portrait" data-layout={layout}>
        <span class="lp-atmos guide__glow" aria-hidden="true"></span>
        {#if clip && play}
          <ClipFrame still={still(preview)} ratio="var(--_ratio)" {alt} {place}>
            <Watch {clip} label={watchLabel} {title} {edit} />
          </ClipFrame>
        {:else}
          <ClipFrame still={still(preview)} ratio="var(--_ratio)" {alt} />
        {/if}
      </div>
    {:else if edit}
      <div class="guide__portrait" data-layout={layout} data-lp-edit-only>
        <ClipFrame ratio="var(--_ratio)" prompt={play ? INSTRUCTOR_PROMPT : undefined} />
      </div>
    {/if}
  {/await}
{/snippet}

{#if layout === 'quote'}
  <div class="guide-quote">
    {@render head(content.quote ? 'title' : 'heading')}
    {#if content.quote}
      <div class="guide-quote__line"><GuideQuote text={content.quote} large {edit} /></div>
    {/if}
    {@render portrait(false)}
    <div class="guide-quote__by">
      <Signoff {context} name={content.name} role={content.role} {edit} />
      {#await context.sellPreview then preview}
        {#if preview?.guideClip}
          <Watch clip={preview.guideClip} label={watchLabel} {title} {edit} />
        {:else if edit && !still(preview)}
          <p class="guide__prompt" data-lp-edit-only>{INSTRUCTOR_PROMPT}</p>
        {/if}
      {/await}
    </div>
    {#if content.body || content.credentials || hasCta}
      <div class="guide-quote__more">
        {#if content.body || hasCta}
          <div class="guide__story">{@render story()}{@render actions()}</div>
        {/if}
        {#if content.credentials}
          <!-- Soft reads this layout down the middle, where ruled columns would sit off-centre. -->
          <Credentials
            items={content.credentials}
            variant={page.style === 'soft' ? 'chips' : 'ledger'}
          />
        {/if}
      </div>
    {/if}
  </div>
{:else}
  {@const centred = layout === 'centered'}
  <div class={centred ? 'guide-centered' : 'guide-split'}>
    {@render portrait(true, centred ? 'foot' : 'corner')}
    <div class="guide__words">
      {@render head('heading')}
      {@render story()}
      {#if content.quote}<GuideQuote text={content.quote} {centred} {edit} />{/if}
      {#if content.credentials}
        <Credentials items={content.credentials} variant={centred ? 'chips' : 'ledger'} />
      {/if}
      <Signoff {context} name={content.name} role={content.role} {edit} />
      {@render actions()}
    </div>
  </div>
{/if}

<style>
  /* ── shared ────────────────────────────────────────────────────────────── */
  .guide__head,
  .guide__words,
  .guide__story {
    display: grid;
    gap: var(--lp-stack);
    align-content: start;
  }

  .guide-split,
  .guide-quote,
  .guide-centered {
    /* From the band's edge to the content column's. */
    --_edge: max(var(--lp-gutter), calc((100cqi - var(--lp-container)) / 2));
  }

  .guide__portrait {
    --_ratio: 4 / 5;
    position: relative;
    isolation: isolate;
    min-inline-size: 0;
  }

  /* Cinematic's centred portrait is lit from behind; nowhere else. */
  .guide__glow {
    display: none;
  }

  .guide__prompt {
    margin: 0;
    color: var(--lp-ink-soft);
    font-size: var(--lp-size-small);
  }

  /* ── split ─────────────────────────────────────────────────────────────── */
  .guide-split {
    display: grid;
    gap: var(--lp-gap);
    align-items: start;
  }

  @container (min-width: 52rem) {
    .guide-split:has(> .guide__portrait) {
      grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
      column-gap: calc(var(--lp-gap) * 1.5);
    }

    /* The face stays in view while a long story scrolls past it. */
    .guide-split > .guide__portrait {
      position: sticky;
      top: var(--space-12);
    }
  }

  /* Soft: an arched window. */
  :global(.lp[data-lp-style='soft']) .guide__portrait[data-layout='split'] :global(.lp-media) {
    border-radius:
      50% 50% var(--lp-radius-media) var(--lp-radius-media) / 40% 40% var(--lp-radius-media)
      var(--lp-radius-media);
  }

  /* Bold and Cinematic: the portrait meets the band's top on a phone, and on
     a wide band fills its whole height at the leading edge. */
  /* The band's own tracks, so no column gap: one would shift the content
     track off the column every other band lines up on. */
  :global(.lp:is([data-lp-style='bold'], [data-lp-style='cinematic'])) .guide-split {
    grid-column: bleed;
    grid-template-columns: inherit;
    column-gap: 0;
  }

  :global(.lp:is([data-lp-style='bold'], [data-lp-style='cinematic'])) .guide-split > .guide__words {
    grid-column: content;
  }

  :global(.lp:is([data-lp-style='bold'], [data-lp-style='cinematic'])) .guide-split > .guide__portrait {
    --clip-inset: var(--_edge);
    grid-column: bleed;
    margin-block-start: calc(-1 * var(--lp-pad));
  }

  :global(.lp[data-lp-style='cinematic']) .guide__portrait[data-layout='split'] :global(.lp-media) {
    border-radius: 0;
    mask-image: linear-gradient(to bottom, black 55%, transparent);
  }

  @container (min-width: 52rem) {
    :global(.lp:is([data-lp-style='bold'], [data-lp-style='cinematic'])) .guide-split:has(> .guide__portrait) {
      grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
      column-gap: calc(var(--lp-gap) * 1.5);
      align-items: stretch;
      margin-block: calc(-1 * var(--lp-pad));
      padding-inline-end: var(--_edge);
    }

    :global(.lp:is([data-lp-style='bold'], [data-lp-style='cinematic']))
      .guide-split:has(> .guide__portrait)
      > .guide__portrait {
      --_ratio: auto;
      grid-column: 1;
      position: static;
      margin-block-start: 0;
    }

    :global(.lp:is([data-lp-style='bold'], [data-lp-style='cinematic']))
      .guide-split:has(> .guide__portrait)
      > .guide__words {
      grid-column: 2;
      align-content: center;
      padding-block: var(--lp-pad);
    }

    :global(.lp[data-lp-style='cinematic']) .guide__portrait[data-layout='split'] :global(.lp-media) {
      mask-image: linear-gradient(to right, black 50%, transparent);
    }
  }

  /* ── quote ─────────────────────────────────────────────────────────────── */
  .guide-quote {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-areas: 'head head' 'line line' 'portrait by' 'more more';
    gap: var(--lp-gap) var(--space-5);
    align-items: center;
  }

  .guide-quote:not(:has(> .guide__portrait)) {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: 'head' 'line' 'by' 'more';
  }

  .guide-quote > .guide__head {
    grid-area: head;
  }

  .guide-quote__line {
    grid-area: line;
  }

  .guide-quote > .guide__portrait {
    --_ratio: 1 / 1;
    grid-area: portrait;
    inline-size: clamp(var(--space-16), 9cqi, var(--space-24));
  }

  .guide-quote__by {
    grid-area: by;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-8);
  }

  .guide-quote__more {
    grid-area: more;
    display: grid;
    gap: var(--lp-gap);
    align-items: start;
  }

  @container (min-width: 52rem) {
    .guide-quote__more {
      grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
    }
  }

  /* Soft: down the middle, the portrait a circle above the name. */
  :global(.lp[data-lp-style='soft']) .guide-quote,
  :global(.lp[data-lp-style='soft']) .guide-quote:not(:has(> .guide__portrait)) {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: 'head' 'line' 'portrait' 'by' 'more';
    justify-items: center;
    text-align: center;
  }

  /* Down the middle, the portrait and the name belong together: the quote
     and the story keep the air around them instead. */
  :global(.lp[data-lp-style='soft']) .guide-quote {
    row-gap: var(--lp-stack);
  }

  :global(.lp[data-lp-style='soft']) .guide-quote__line {
    margin-block: var(--space-2) var(--space-6);
  }

  :global(.lp[data-lp-style='soft']) .guide-quote__more {
    margin-block-start: var(--space-6);
  }

  :global(.lp[data-lp-style='soft']) .guide-quote__by {
    --signoff-align: center;
    flex-direction: column;
  }

  :global(.lp[data-lp-style='soft']) .guide-quote__more {
    grid-template-columns: minmax(0, 1fr);
    justify-items: center;
    --lp-actions-align: center;
  }

  :global(.lp[data-lp-style='soft']) :is(.guide-quote, .guide-centered) :global(.lp-eyebrow) {
    justify-self: center;
  }

  :global(.lp[data-lp-style='soft']) .guide__portrait:is([data-layout='quote'], [data-layout='centered'])
    :global(.lp-media) {
    border-radius: var(--radius-full);
  }

  /* Cinematic: the portrait is the room's backdrop, dissolving toward the words. */
  @container (min-width: 52rem) {
    :global(.lp[data-lp-style='cinematic']) .guide-quote:has(> .guide__portrait) {
      grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
      grid-template-areas: 'head portrait' 'line portrait' 'by portrait' 'more portrait';
      column-gap: 0;
    }

    :global(.lp[data-lp-style='cinematic']) .guide-quote > .guide__portrait {
      --_ratio: auto;
      align-self: stretch;
      inline-size: auto;
      margin-block: calc(-1 * var(--lp-pad));
      margin-inline-end: calc(-1 * var(--_edge));
    }

    :global(.lp[data-lp-style='cinematic']) .guide__portrait[data-layout='quote'] :global(.lp-media) {
      border-radius: 0;
      mask-image: linear-gradient(to right, transparent, black 45%);
    }

    :global(.lp[data-lp-style='cinematic']) .guide-quote:has(> .guide__portrait) .guide-quote__more {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  /* ── centered ──────────────────────────────────────────────────────────── */
  .guide-centered {
    display: grid;
    justify-items: center;
    gap: var(--lp-gap);
    text-align: center;
  }

  .guide-centered .guide__words {
    justify-items: center;
    --signoff-align: center;
    --lp-actions-align: center;
  }

  .guide-centered :global(.lp-eyebrow) {
    justify-self: center;
  }

  /* A centred story never ends on a lone word (on the `p`: the app's prose
     rule sets `text-wrap` there directly). */
  .guide-centered :global(.lp-text p),
  :global(.lp[data-lp-style='soft']) .guide-quote :global(.lp-text p) {
    text-wrap: balance;
  }

  .guide-centered .guide__portrait {
    inline-size: min(100%, 20rem);
  }

  /* Room below for a play button that sits half over the portrait's foot. */
  .guide-centered .guide__portrait:has(:global(.clip__control)) {
    margin-block-end: var(--space-6);
  }

  :global(.lp[data-lp-style='bold']) .guide-centered .guide__portrait {
    --_ratio: 1 / 1;
    inline-size: min(100%, 26rem);
  }

  :global(.lp[data-lp-style='soft']) .guide-centered .guide__portrait {
    --_ratio: 1 / 1;
    inline-size: min(100%, 17rem);
  }

  :global(.lp[data-lp-style='cinematic']) .guide-centered .guide__portrait {
    inline-size: min(100%, 24rem);
  }

  :global(.lp[data-lp-style='cinematic']) .guide__portrait[data-layout='centered'] :global(.lp-media) {
    border-radius: 0;
    mask-image: radial-gradient(closest-side, black 62%, transparent);
  }

  :global(.lp[data-lp-style='cinematic']) .guide-centered .guide__glow {
    display: block;
    inset: 10%;
    --lp-atmos-strength: 0.45;
  }
</style>
