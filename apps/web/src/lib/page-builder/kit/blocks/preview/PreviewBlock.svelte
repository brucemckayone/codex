<!--
  @component PreviewBlock

  A short clip from inside the course. Two layouts:
    feature — the clip first and large (edge to edge in Bold and Cinematic),
              the words beneath it: heading on one side, the rest on the other
    split   — the words beside a tall frame of the clip, which runs off the
              band's far edge in Bold and Cinematic

  Cinematic dissolves the frame into its dark room, so its play button moves
  from the corner to the middle of the picture. The clip streams on
  `sellPreview`, but the awaited course view says whether one can come
  (`course.filmsAttached.reel`, Codex-61zsk.40). With none, the public page
  folds the band from the first paint. With one, it sends the section whole,
  the frame holding its space (its HTML is the final state, 03 §10), and only
  a clip that fails to resolve leaves it to fold once the stream settles: the
  public page never leaves its words above nothing (Codex-61zsk.37). The page
  folds the section before its bands resolve, by the same rule (`filmToShow`),
  so the bands either side never meet as one (Codex-61zsk.57); the block's
  own marker below folds it only when it is mounted outside the page, as in
  its own tests. Where
  the page is looked at (the canvas, a still thumbnail) the
  section keeps its frame, the kit's plate in it, and on the canvas a prompt
  for the clip. The button row appears only when the creator writes one.

  The clip plays in its own frame (`InlineFilm`), letterboxed in the split's
  tall one; Cinematic's fades lift under the player, which is squared where
  Cinematic squares the picture. It asks for the full film where the server
  allows one (`reel`).

  Its line says what it is and how long a press plays (Codex-61zsk.73),
  "A 30-second listen", then the creator's caption, "· From week one"
  (`filmPlays`). It sits where the caption did, under the frame in
  `feature`, and under the words, above the buttons, in `split`. An audio
  clip has no picture, so it plays in a listening card instead
  (`ListenCard`), which holds the line, and keeps to the column in every
  Style.
-->
<script lang="ts">
  import { filmPlays, filmToShow } from '../../model/films';
  import type { BlockProps } from '../../model/types';
  import { getKitPage } from '../../page-context';
  import ButtonRow from '../../primitives/ButtonRow.svelte';
  import { editAttrs } from '../../primitives/edit';
  import Eyebrow from '../../primitives/Eyebrow.svelte';
  import Heading from '../../primitives/Heading.svelte';
  import InlineFilm from '../../primitives/InlineFilm.svelte';
  import Text from '../../primitives/Text.svelte';
  import { settled } from '../hero/settled.svelte';
  import ClipFrame from '../video/ClipFrame.svelte';
  import { PREVIEW_COPY, previewKind } from './copy';
  import { PREVIEW_PROMPT, previewDefinition } from './definition';
  import ListenCard from './ListenCard.svelte';

  const { props, section, context, edit }: BlockProps = $props();

  const page = getKitPage();
  const content = $derived(previewDefinition.coerce(props));
  const split = $derived(section.layout === 'split');
  const place = $derived(page.style === 'cinematic' ? 'center' : 'corner');
  const title = $derived(content.heading ?? context.course.title);
  const hasTop = $derived(Boolean(content.eyebrow || content.heading));
  const hasCta = $derived(Boolean(content.ctaLabel || content.note));
  const captionAttrs = $derived(editAttrs('preview', 'caption', edit));

  // The clip once the stream settles, read in place (`settled.svelte.ts`):
  // `undefined` until then and on the server, `null` if the read failed.
  const preview = $derived(settled(context.sellPreview));
  const pending = $derived(preview === undefined);
  const clip = $derived(preview?.reel ?? null);
  // No clip to show (`filmToShow`, which the page's fold reads too): settled
  // with none, or none can come, which the awaited view knows before the
  // stream settles (Codex-61zsk.40). A clip that arrives anyway still shows.
  const clipless = $derived(
    filmToShow(context.course.filmsAttached?.reel, preview, 'reel') === false
  );
  const shown = $derived(!clipless || page.still || !!edit);
  // A section with no clip is the creator's alone: the canvas's own.
  const creatorOnly = $derived(clipless ? '' : undefined);

  // What a press plays, said before the caption. An older payload names no
  // kind, so its line is the caption alone.
  const plays = $derived(clip ? filmPlays(clip, page) : null);
  const kind = $derived(
    clip?.mediaType && plays ? previewKind(clip.mediaType, plays.seconds) : undefined
  );
  const listen = $derived(clip?.mediaType === 'audio');
  // A film's line: split sets it under the words, feature under the frame.
  // The listening card holds its own.
  const filmLine = $derived(!listen && Boolean(kind || content.caption));
  const hasWords = $derived(
    hasTop || Boolean(content.body) || hasCta || (split && filmLine)
  );
</script>

<!-- One run of text, no space between: "A 30-second watch · From week one". -->
{#snippet line()}
  {#if kind}<b class="preview__kind">{kind}</b>{/if}{#if kind && content.caption}{' · '}{/if}{#if content.caption}<span {...captionAttrs}>{content.caption}</span>{/if}
{/snippet}

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
  {#if split && filmLine}<p class="preview__line">{@render line()}</p>{/if}
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

{#snippet frame()}
  <figure
    class="preview__clip"
    data-layout={section.layout}
    data-media={listen ? 'audio' : undefined}
    data-lp-edit-only={creatorOnly}
  >
    {#if clip && listen}
      <ListenCard
        {clip}
        {title}
        seconds={plays?.seconds ?? null}
        still={clip.posterUrl ?? preview?.heroImageUrl ?? null}
        {line}
        {edit}
      />
    {:else if clip}
      <InlineFilm {clip} film="reel" label={PREVIEW_COPY.watch} {title} {edit}>
        {#snippet children(control, player)}
          <ClipFrame still={clip.posterUrl} ratio="var(--_ratio)" {place} {player}>
            {@render control()}
          </ClipFrame>
        {/snippet}
      </InlineFilm>
    {:else}
      <ClipFrame
        ratio="var(--_ratio)"
        {pending}
        prompt={edit && !pending ? PREVIEW_PROMPT : undefined}
      />
    {/if}
    {#if !split && filmLine}
      <figcaption class="preview__line">{@render line()}</figcaption>
    {/if}
  </figure>
{/snippet}

{#if clipless}
  <!-- No clip: the live page folds this band away. -->
  <span class="preview-none" hidden></span>
{/if}
{#if shown}
  {#if split}
    <div class="preview-split" data-lp-edit-only={creatorOnly}>
      {#if hasWords}
        <div class="preview-split__words">
          {#if hasTop}{@render top()}{/if}
          {@render more()}
        </div>
      {/if}
      {@render frame()}
    </div>
  {:else}
    <!-- Side by side, no space between: nothing is left behind when the
         canvas's own parts are set aside. -->
    {@render frame()}{#if hasWords}<div class="preview-words" data-lp-edit-only={creatorOnly}>
        {#if hasTop}{@render top()}{/if}
        {#if content.body || hasCta}<div class="preview__more">{@render more()}</div>{/if}
      </div>{/if}
  {/if}
{/if}

<style>
  /* ── no clip on the live page: no band either ──────────────────────────── */
  :global(.lp:not([data-lp-still]) .lp-section:has(> .lp-inner > .preview-none)) {
    display: none;
  }

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

  .preview__line {
    margin: 0;
    max-inline-size: calc(var(--lp-measure) * var(--lp-measure-unit));
    color: var(--lp-ink-soft);
    font-size: var(--lp-size-small);
    line-height: var(--lp-leading-body);
  }

  /* What it is and how long, in the line's own ink (the card's panel ink). */
  .preview__kind {
    font-weight: var(--lp-weight-label);
  }

  .preview__line .preview__kind {
    color: var(--lp-ink);
  }

  /* The listening card is wide where the frame is (`ListenCard`). */
  @container (min-width: 40rem) {
    .preview__clip[data-layout='feature'] {
      --listen-ratio: 21 / 9;
    }
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

  :global(.lp[data-lp-style='soft']) .preview__clip[data-layout='feature'] .preview__line {
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
    .preview__line {
    padding-inline: var(--_edge);
  }

  /* The listening card keeps to the column: a panel run off the band's edge
     would read as a band of its own. */
  :global(.lp:is([data-lp-style='bold'], [data-lp-style='cinematic'])) .preview__clip[data-media='audio'] {
    padding-inline: var(--_edge);
  }

  @container (min-width: 48rem) {
    :global(.lp:is([data-lp-style='bold'], [data-lp-style='cinematic'])) .preview__clip[data-layout='feature'] {
      --_ratio: 21 / 9;
    }
  }

  /* Cinematic: the picture dissolves into the room, most of all below it.
     A film playing over it is square too, and unmasked: the fade would take
     its controls. */
  :global(.lp[data-lp-style='cinematic']) .preview__clip[data-layout='feature'] :global(.lp-media) {
    border-radius: 0;
    mask-image: linear-gradient(to bottom, transparent, black 10%, black 58%, transparent);
  }

  :global(.lp[data-lp-style='cinematic']) .preview__clip :global(.lp-film) {
    border-radius: 0;
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
      > .preview__clip[data-media='audio'] {
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
