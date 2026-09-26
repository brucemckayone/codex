<!--
  @component PreviewBlock

  A short clip from inside the course. Two layouts:
    feature — the clip first and large (edge to edge in Bold and Cinematic),
              the words beneath it: heading on one side, the rest on the other
    split   — the words beside a tall frame of the clip, which runs off the
              band's far edge in Bold and Cinematic

  Cinematic dissolves the frame into its dark room, so its play button moves
  from the corner to the middle of the picture. The clip streams on
  `sellPreview` with its space held while it loads; no clip → the public page
  drops the frame and its caption, the canvas asks for one. The button row
  appears only when the creator writes one.
-->
<script lang="ts">
  import type { PreviewMedia } from '../../../render/types';
  import type { BlockProps } from '../../model/types';
  import { getKitPage } from '../../page-context';
  import ButtonRow from '../../primitives/ButtonRow.svelte';
  import { editAttrs } from '../../primitives/edit';
  import Eyebrow from '../../primitives/Eyebrow.svelte';
  import Heading from '../../primitives/Heading.svelte';
  import Text from '../../primitives/Text.svelte';
  import ClipFrame from '../video/ClipFrame.svelte';
  import Watch from '../video/Watch.svelte';
  import { PREVIEW_COPY } from './copy';
  import { PREVIEW_PROMPT, previewDefinition } from './definition';

  const { props, section, context, edit }: BlockProps = $props();

  const page = getKitPage();
  const content = $derived(previewDefinition.coerce(props));
  const split = $derived(section.layout === 'split');
  const place = $derived(page.style === 'cinematic' ? 'center' : 'corner');
  const title = $derived(content.heading ?? context.course.title);
  const hasTop = $derived(Boolean(content.eyebrow || content.heading));
  const hasCta = $derived(Boolean(content.ctaLabel || content.note));
  const captionAttrs = $derived(editAttrs('preview', 'caption', edit));
</script>

{#snippet top()}
  <div class="preview__top">
    {#if content.eyebrow}<Eyebrow text={content.eyebrow} type="preview" {edit} />{/if}
    {#if content.heading}
      <Heading
        level={section.headingLevel}
        text={content.heading}
        type="preview"
        field="heading"
        {edit}
      />
    {/if}
  </div>
{/snippet}

{#snippet more()}
  {#if content.body}
    <Text text={content.body} size="lead" type="preview" field="body" {edit} />
  {/if}
  {#if hasCta}
    <div class="preview__actions">
      <ButtonRow
        {context}
        section="preview"
        label={content.ctaLabel}
        note={content.note}
        size="md"
        {edit}
      />
    </div>
  {/if}
{/snippet}

{#snippet frame(clip: PreviewMedia | null, pending: boolean)}
  <figure
    class="preview__clip"
    data-layout={section.layout}
    data-lp-edit-only={!clip && !pending ? '' : undefined}
  >
    {#if clip}
      <ClipFrame still={clip.posterUrl} ratio="var(--_ratio)" {place}>
        <Watch {clip} label={PREVIEW_COPY.watch} {title} {edit} />
      </ClipFrame>
    {:else}
      <ClipFrame
        ratio="var(--_ratio)"
        {pending}
        prompt={edit && !pending ? PREVIEW_PROMPT : undefined}
      />
    {/if}
    {#if content.caption}
      <figcaption class="preview__caption" {...captionAttrs}>{content.caption}</figcaption>
    {/if}
  </figure>
{/snippet}

{#snippet stage()}
  {#await context.sellPreview}
    {@render frame(null, true)}
  {:then preview}
    {#if preview?.reel || edit}
      {@render frame(preview?.reel ?? null, false)}
    {/if}
  {/await}
{/snippet}

{#if split}
  <div class="preview-split">
    {#if hasTop || content.body || hasCta}
      <div class="preview-split__words">
        {#if hasTop}{@render top()}{/if}
        {@render more()}
      </div>
    {/if}
    {@render stage()}
  </div>
{:else}
  {@render stage()}
  {#if hasTop || content.body || hasCta}
    <div class="preview-words">
      {#if hasTop}{@render top()}{/if}
      {#if content.body || hasCta}<div class="preview__more">{@render more()}</div>{/if}
    </div>
  {/if}
{/if}

<style>
  /* ── shared ────────────────────────────────────────────────────────────── */
  .preview__top,
  .preview__more,
  .preview-words,
  .preview-split__words {
    display: grid;
    gap: var(--lp-stack);
  }

  .preview__clip,
  .preview-split {
    /* From the band's edge to the content column's. */
    --_edge: max(var(--lp-gutter), calc((100cqi - var(--lp-container)) / 2));
  }

  .preview__clip {
    --_ratio: 16 / 9;
    display: grid;
    gap: var(--space-3);
    margin: 0;
  }

  .preview__caption {
    margin: 0;
    max-inline-size: var(--lp-measure);
    color: var(--lp-ink-soft);
    font-size: var(--lp-size-small);
    line-height: var(--lp-leading-body);
  }

  /* ── feature ───────────────────────────────────────────────────────────── */
  @container (min-width: 52rem) {
    .preview-words {
      grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
      column-gap: var(--lp-gap);
      align-items: start;
    }

    .preview-words > .preview__more {
      grid-column: 2;
      padding-block-start: var(--space-2);
    }
  }

  /* Soft reads down the middle. */
  :global(.lp[data-lp-style='soft']) .preview-words,
  :global(.lp[data-lp-style='soft']) .preview-words :is(.preview__top, .preview__more) {
    grid-template-columns: minmax(0, 1fr);
    justify-items: center;
    text-align: center;
  }

  :global(.lp[data-lp-style='soft']) .preview-words > .preview__more {
    grid-column: 1;
    padding-block-start: 0;
  }

  :global(.lp[data-lp-style='soft']) .preview-words :global(.lp-eyebrow),
  :global(.lp[data-lp-style='soft']) .preview-words :global(.lp-text) {
    justify-self: center;
  }

  /* On the `p`: the app's prose rule sets `text-wrap` there directly. */
  :global(.lp[data-lp-style='soft']) .preview-words :global(.lp-text p) {
    text-wrap: balance;
  }

  :global(.lp[data-lp-style='soft']) .preview__clip[data-layout='feature'] .preview__caption {
    justify-self: center;
    text-align: center;
  }

  :global(.lp[data-lp-style='soft']) .preview__actions {
    --lp-actions-align: center;
  }

  /* Bold and Cinematic: the clip runs edge to edge, wider on a wide band. */
  :global(.lp:is([data-lp-style='bold'], [data-lp-style='cinematic'])) .preview__clip[data-layout='feature'] {
    --clip-inset: var(--_edge);
    grid-column: bleed;
  }

  :global(.lp:is([data-lp-style='bold'], [data-lp-style='cinematic']))
    .preview__clip[data-layout='feature']
    .preview__caption {
    padding-inline: var(--_edge);
  }

  @container (min-width: 48rem) {
    :global(.lp:is([data-lp-style='bold'], [data-lp-style='cinematic'])) .preview__clip[data-layout='feature'] {
      --_ratio: 21 / 9;
    }
  }

  /* Cinematic: the picture dissolves into the room, most of all below it. */
  :global(.lp[data-lp-style='cinematic']) .preview__clip[data-layout='feature'] :global(.lp-media) {
    border-radius: 0;
    mask-image: linear-gradient(to bottom, transparent, black 10%, black 58%, transparent);
  }

  /* ── split ─────────────────────────────────────────────────────────────── */
  .preview-split {
    display: grid;
    gap: var(--lp-gap);
    align-items: center;
  }

  .preview__clip[data-layout='split'] {
    --_ratio: 4 / 5;
  }

  @container (min-width: 50rem) {
    .preview-split:has(> .preview__clip):has(> .preview-split__words) {
      grid-template-columns: minmax(0, 6fr) minmax(0, 5fr);
      column-gap: calc(var(--lp-gap) * 1.5);
    }
  }

  /* Bold and Cinematic: full width on a phone; on a wide band the frame runs
     off the far edge while the words keep to the column. */
  /* The band's own tracks, so no column gap: one would shift the content
     track off the column every other band lines up on. */
  :global(.lp:is([data-lp-style='bold'], [data-lp-style='cinematic'])) .preview-split {
    grid-column: bleed;
    grid-template-columns: inherit;
    column-gap: 0;
  }

  :global(.lp:is([data-lp-style='bold'], [data-lp-style='cinematic'])) .preview-split > .preview-split__words {
    grid-column: content;
  }

  :global(.lp:is([data-lp-style='bold'], [data-lp-style='cinematic'])) .preview-split > .preview__clip {
    grid-column: bleed;
  }

  /* Edge to edge, so square to the edge. */
  :global(.lp[data-lp-style='cinematic']) .preview-split > .preview__clip :global(.lp-media) {
    border-radius: 0;
  }

  :global(.lp:is([data-lp-style='bold'], [data-lp-style='cinematic'])) .preview-split .preview__caption {
    padding-inline: var(--_edge);
  }

  @container (min-width: 50rem) {
    :global(.lp:is([data-lp-style='bold'], [data-lp-style='cinematic']))
      .preview-split:has(> .preview__clip):has(> .preview-split__words) {
      grid-template-columns: minmax(0, 6fr) minmax(0, 5fr);
      column-gap: calc(var(--lp-gap) * 1.5);
      padding-inline-start: var(--_edge);
    }

    :global(.lp:is([data-lp-style='bold'], [data-lp-style='cinematic']))
      .preview-split:has(> .preview-split__words)
      > .preview__clip {
      grid-column: 2;
    }

    :global(.lp:is([data-lp-style='bold'], [data-lp-style='cinematic']))
      .preview-split:has(> .preview__clip)
      > .preview-split__words {
      grid-column: 1;
    }

    :global(.lp:is([data-lp-style='bold'], [data-lp-style='cinematic']))
      .preview-split:has(> .preview-split__words)
      .preview__caption {
      padding-inline-start: 0;
    }

    /* Cinematic: the frame fades in from the words' side and at its top and
       foot, so only the band's own edge is hard. */
    :global(.lp[data-lp-style='cinematic']) .preview-split:has(> .preview-split__words) :global(.lp-media) {
      border-radius: 0;
      mask-image:
        linear-gradient(to right, transparent, black 32%),
        linear-gradient(to bottom, transparent, black 12%, black 88%, transparent);
      mask-composite: intersect;
    }
  }
</style>
