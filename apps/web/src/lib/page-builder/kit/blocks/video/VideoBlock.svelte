<!--
  @component VideoBlock

  The introduction film, shown large. Two layouts:
    theatre — the words first, then the film on a wide screen with its play
              button centred and the caption beneath (edge to edge in Bold,
              lit from behind in Cinematic's dark room)
    split   — the film as the larger half beside the words (running off the
              band's leading edge in Bold)

  The film streams on `sellPreview`, but the awaited course view says
  whether one can come (`course.filmsAttached.intro`, Codex-61zsk.40). With
  none, the public page folds the band from the first paint. With one, it
  sends the section whole, the screen holding its ratio (its HTML is the
  final state, 03 §10), and only a film that fails to resolve leaves it to
  fold once the stream settles: the public page never leaves its words above
  nothing (Codex-61zsk.37). The page folds the section before its bands
  resolve, by the same rule (`filmToShow`), so the bands either side never
  meet as one (Codex-61zsk.57); the block's own marker below folds it only
  when it is mounted outside the page, as in its own tests. Where the page is
  looked at (the canvas, a
  still thumbnail) the section keeps its screen, the kit's plate in it, and
  on the canvas a prompt for the film. The button row appears only when the
  creator writes one.

  The film plays in the screen itself (`InlineFilm`): a press lays the player
  over the poster, letterboxed in Bold's 21:9, and the poster returns with
  "Watch again" when it ends. It asks for the full film where the server
  allows one (`intro`).

  A line says who speaks and for how long (Codex-61zsk.73): "Maya Okafor ·
  2:04", or "0:30 preview" when a press plays the preview (`filmPlays`). The
  speaker is the creator's, else the page's guide (the About you section's
  name), shown by default; the "Hide who's speaking" switch leaves them off
  (`hideSpeaker`). In `theatre` it sits under the
  screen, in line with the words; in `split` under the words, above the
  buttons. With neither a speaker nor a length there is no line.
-->
<script lang="ts">
  import { filmPlays, filmToShow } from '../../model/films';
  import { hasHead } from '../../model/read';
  import type { BlockProps } from '../../model/types';
  import { getKitPage } from '../../page-context';
  import ButtonRow from '../../primitives/ButtonRow.svelte';
  import { editAttrs } from '../../primitives/edit';
  import Eyebrow from '../../primitives/Eyebrow.svelte';
  import Heading from '../../primitives/Heading.svelte';
  import InlineFilm from '../../primitives/InlineFilm.svelte';
  import Text from '../../primitives/Text.svelte';
  import { settled } from '../hero/settled.svelte';
  import ClipFrame from './ClipFrame.svelte';
  import { filmLength, VIDEO_COPY } from './copy';
  import { VIDEO_PROMPT, videoDefinition } from './definition';

  const { props, section, context, edit }: BlockProps = $props();

  const page = getKitPage();
  const content = $derived(videoDefinition.coerce(props));
  const split = $derived(section.layout === 'split');
  const title = $derived(content.heading ?? context.course.title);
  const hasWords = $derived(hasHead(content));
  const hasCta = $derived(Boolean(content.ctaLabel || content.note));
  const captionAttrs = $derived(editAttrs('video', 'caption', edit));

  // The film once the stream settles, read in place (`settled.svelte.ts`):
  // `undefined` until then and on the server, `null` if the read failed.
  const preview = $derived(settled(context.sellPreview));
  const pending = $derived(preview === undefined);
  const clip = $derived(preview?.intro ?? null);
  // No film to show (`filmToShow`, which the page's fold reads too): settled
  // with none, or none can come, which the awaited view knows before the
  // stream settles (Codex-61zsk.40). A film that arrives anyway still shows.
  const filmless = $derived(
    filmToShow(context.course.filmsAttached?.intro, preview, 'intro') === false
  );
  const shown = $derived(!filmless || page.still || !!edit);
  // A section with no film is the creator's alone: the canvas's own.
  const creatorOnly = $derived(filmless ? '' : undefined);

  // Who speaks, unless the creator hides them, and for how long a press plays.
  const speaker = $derived(
    content.hideSpeaker === true ? undefined : (content.speaker ?? page.guideName)
  );
  const length = $derived(filmLength(clip ? filmPlays(clip, page) : null));
  const hasLine = $derived(Boolean(speaker || length));
</script>

<!-- One run of text, no space between: "Maya Okafor · 2:04". -->
{#snippet line()}
  <p class="video__line">{#if speaker}<b>{speaker}</b>{/if}{#if speaker && length}{' · '}{/if}{#if length}{length}{/if}</p>
{/snippet}

{#snippet words()}
  {#if content.eyebrow || content.heading}
    <div class="video__top">
      {#if content.eyebrow}<Eyebrow text={content.eyebrow} type="video" {edit} />{/if}
      {#if content.heading}
        <Heading
          level={section.headingLevel}
          text={content.heading}
          type="video"
          field="heading"
          {edit}
        />
      {/if}
    </div>
  {/if}
  {#if content.body}
    <Text text={content.body} size="lead" type="video" field="body" {edit} />
  {/if}
  {#if split && hasLine}{@render line()}{/if}
{/snippet}

{#snippet actions()}
  {#if hasCta}
    <div class="video__actions" data-lp-edit-only={creatorOnly}>
      <ButtonRow
        {context}
        section="video"
        label={content.ctaLabel}
        note={content.note}
        size="md"
        {edit}
      />
    </div>
  {/if}
{/snippet}

{#snippet screen()}
  <figure class="video__screen" data-layout={section.layout} data-lp-edit-only={creatorOnly}>
    <span class="lp-atmos video__glow" aria-hidden="true"></span>
    {#if clip}
      <InlineFilm {clip} film="intro" label={VIDEO_COPY.watch} {title} {edit}>
        {#snippet children(control, player)}
          <ClipFrame
            still={clip.posterUrl}
            ratio="var(--_ratio)"
            place={split ? 'corner' : 'center'}
            {player}
          >
            {@render control()}
          </ClipFrame>
        {/snippet}
      </InlineFilm>
    {:else}
      <ClipFrame
        ratio="var(--_ratio)"
        {pending}
        prompt={edit && !pending ? VIDEO_PROMPT : undefined}
      />
    {/if}
    {#if !split && hasLine}{@render line()}{/if}
    {#if content.caption}
      <figcaption class="video__caption" {...captionAttrs}>{content.caption}</figcaption>
    {/if}
  </figure>
{/snippet}

{#if filmless}
  <!-- No film: the live page folds this band away. -->
  <span class="video-none" hidden></span>
{/if}
{#if shown}
  {#if split}
    <div class="video-split" data-lp-edit-only={creatorOnly}>
      {#if hasWords || hasCta || hasLine}
        <div class="video-split__words">{@render words()}{@render actions()}</div>
      {/if}
      {@render screen()}
    </div>
  {:else}
    <!-- Side by side, no space between: nothing is left behind when the
         canvas's own parts are set aside. -->
    {#if hasWords}<div class="video-head" data-lp-edit-only={creatorOnly}>{@render words()}</div>{/if}{@render screen()}{@render actions()}
  {/if}
{/if}

<style>
  /* ── no film on the live page: no band either ──────────────────────────── */
  :global(.lp:not([data-lp-still]) .lp-section:has(> .lp-inner > .video-none)) {
    display: none;
  }

  /* ── shared ────────────────────────────────────────────────────────────── */
  .video__top,
  .video-head,
  .video-split__words {
    display: grid;
    gap: var(--lp-stack);
  }

  .video__screen,
  .video-split {
    /* From the band's edge to the content column's: what a bleeding part
       pads by to keep its words in line with everything else. */
    --_edge: max(var(--lp-gutter), calc((100cqi - var(--lp-container)) / 2));
  }

  .video__screen {
    --_ratio: 16 / 9;
    position: relative;
    isolation: isolate;
    display: grid;
    gap: var(--space-3);
    margin: 0;
  }

  .video__caption,
  .video__line {
    margin: 0;
    max-inline-size: calc(var(--lp-measure) * var(--lp-measure-unit));
    color: var(--lp-ink-soft);
    font-size: var(--lp-size-small);
    line-height: var(--lp-leading-body);
  }

  .video__line {
    font-variant-numeric: tabular-nums;
  }

  .video__line b {
    color: var(--lp-ink);
    font-weight: var(--lp-weight-label);
  }

  /* Cinematic's screen lights the room around it; on a light band the same
     glow would only be a gradient wash. */
  .video__glow {
    display: none;
  }

  :global(.lp[data-lp-style='cinematic']) .video__glow {
    display: block;
    inset: 6% -4% 14%;
    --lp-atmos-strength: 0.38;
  }

  /* ── theatre ───────────────────────────────────────────────────────────── */
  /* Bold and Clean set the heading and its words on one line, the words
     settling on the heading's last line; Soft and Cinematic centre both. */
  @container (min-width: 52rem) {
    :global(.lp:is([data-lp-style='bold'], [data-lp-style='clean'])) .video-head {
      grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
      column-gap: var(--lp-gap);
      align-items: end;
    }
  }

  :global(.lp:is([data-lp-style='soft'], [data-lp-style='cinematic'])) .video-head,
  :global(.lp:is([data-lp-style='soft'], [data-lp-style='cinematic'])) .video-head .video__top {
    justify-items: center;
    text-align: center;
  }

  :global(.lp:is([data-lp-style='soft'], [data-lp-style='cinematic'])) .video-head :global(.lp-eyebrow),
  :global(.lp:is([data-lp-style='soft'], [data-lp-style='cinematic'])) .video-head :global(.lp-text) {
    justify-self: center;
  }

  /* A centred paragraph never ends on a lone word. On the `p` itself: the
     app's prose rule sets `text-wrap` there, which inheritance cannot beat. */
  :global(.lp:is([data-lp-style='soft'], [data-lp-style='cinematic'])) .video-head :global(.lp-text p) {
    text-wrap: balance;
  }

  :global(.lp:is([data-lp-style='soft'], [data-lp-style='cinematic']))
    .video__screen[data-layout='theatre']
    :is(.video__caption, .video__line) {
    justify-self: center;
    text-align: center;
  }

  :global(.lp:is([data-lp-style='soft'], [data-lp-style='cinematic'])) .video__actions {
    --lp-actions-align: center;
  }

  /* Bold: the screen runs edge to edge; its line and caption stay in the
     column. */
  :global(.lp[data-lp-style='bold']) .video__screen[data-layout='theatre'] {
    grid-column: bleed;
  }

  :global(.lp[data-lp-style='bold'])
    .video__screen[data-layout='theatre']
    :is(.video__caption, .video__line) {
    padding-inline: var(--_edge);
  }

  @container (min-width: 48rem) {
    :global(.lp[data-lp-style='bold']) .video__screen[data-layout='theatre'] {
      --_ratio: 21 / 9;
    }
  }

  /* ── split ─────────────────────────────────────────────────────────────── */
  .video-split {
    display: grid;
    gap: var(--lp-gap);
    align-items: center;
  }

  @container (min-width: 56rem) {
    .video-split:has(> .video__screen):has(> .video-split__words) {
      grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
      column-gap: calc(var(--lp-gap) * 1.25);
    }

    .video-split:has(> .video-split__words) > .video__screen {
      grid-row: 1;
      grid-column: 1;
    }

    .video-split:has(> .video__screen) > .video-split__words {
      grid-row: 1;
      grid-column: 2;
    }
  }

  /* Bold: on a phone the film is full width; on a wide band it runs off the
     leading edge and the words keep to the column's far side. */
  /* The band's own tracks, so no column gap: one would shift the content
     track off the column every other band lines up on. */
  :global(.lp[data-lp-style='bold'] .lp-inner) > .video-split {
    grid-column: bleed;
    grid-template-columns: inherit;
    column-gap: 0;
  }

  :global(.lp[data-lp-style='bold']) .video-split > .video-split__words {
    grid-column: content;
  }

  :global(.lp[data-lp-style='bold']) .video-split > .video__screen {
    grid-column: bleed;
  }

  :global(.lp[data-lp-style='bold']) .video-split .video__screen {
    --clip-inset: var(--_edge);
  }

  :global(.lp[data-lp-style='bold']) .video-split .video__caption {
    padding-inline: var(--_edge);
  }

  @container (min-width: 56rem) {
    :global(.lp[data-lp-style='bold']) .video-split:has(> .video__screen):has(> .video-split__words) {
      grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
      column-gap: calc(var(--lp-gap) * 1.25);
      padding-inline-end: var(--_edge);
    }

    :global(.lp[data-lp-style='bold']) .video-split:has(> .video-split__words) > .video__screen {
      grid-column: 1;
    }

    :global(.lp[data-lp-style='bold']) .video-split:has(> .video__screen) > .video-split__words {
      grid-column: 2;
    }

    :global(.lp[data-lp-style='bold']) .video-split:has(> .video-split__words) .video__caption {
      padding-inline-end: 0;
    }
  }
</style>
