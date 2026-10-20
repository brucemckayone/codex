<!--
  @component PageDials

  "Adjust <Style>" (Codex-61zsk.59): the page's five dials (03 X61, X62) and
  its headlines from another Style (X73, X74), in the Style tab between the
  Styles and the page's brand, as the owner approved the mock. Each dial is
  three buttons; the one named after the Style is its own step, and pressing
  it deletes the dial from the page. A step changes the canvas at once and is
  one undo step, saved like every edit.

  A step that changes nothing in this Style says so, from the kit
  (`dialNoEffect`), so the words cannot drift from what the page draws.
  Headlines offer only the proven swaps for the page's Style (the allow-list,
  `TYPE_FACET_BASES`), each a real `.lp` root drawing the page's own words in
  that Type, its own Type named on the root as `PageRenderer` names it (every
  Type's rules are keyed on it); a Style with none says why. Motion's canvas holds still while
  editing, so its dial points to Preview.

  Every control is a labelled group of toggle buttons, as the Style cards,
  layouts, colours and spacing are: Tab moves, Space or Enter presses, and the
  announcement says "pressed". Pressing a step leaves focus on it.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import type { BrandTokenOverrides } from '$lib/page-builder';
  import {
    type PageDialId,
    type PageDialStep,
    resolveStyle,
    STYLES,
    TYPE_FACET_BASES,
    type TypeFacet,
  } from '$lib/page-builder/kit';
  import { type DialNoEffect, dialNoEffect } from '$lib/page-builder/kit/model/dial-effect';
  import type { PageDesign } from '$lib/page-builder/kit/model/types';
  import { pageBuilder } from '$lib/page-builder/page-builder-store.svelte';
  import { brandOverridesToStyleAttr } from '$lib/page-builder/render/brand-overrides';
  import * as m from '$paraglide/messages';

  interface Props {
    design: PageDesign;
    theme?: 'light' | 'dark';
    brandOverrides?: BrandTokenOverrides | null;
    /** The brand's corners are rounded at all, for the corners dial's note. */
    roundedBrand: boolean;
    /** The page's own headline, drawn in each Type. */
    sample: string;
    /** Opens the page's preview, where motion plays. */
    onPreview: () => void;
    /** A polite status for assistive technology. */
    announce: (text: string) => void;
  }

  const {
    design,
    theme,
    brandOverrides = null,
    roundedBrand,
    sample,
    onPreview,
    announce,
  }: Props = $props();

  const uid = $props.id();
  let root = $state<HTMLElement>();

  type Message = (inputs?: Record<string, string>) => string;
  /** A dial with three steps, `null` being the Style's own. */
  interface Dial {
    id: Exclude<PageDialId, 'drama'>;
    name: Message;
    steps: readonly (string | null)[];
    after?: Message;
  }

  const DIALS: readonly Dial[] = [
    {
      id: 'colour',
      name: m.studio_page_editor_dial_colour,
      steps: ['muted', null, 'vivid'],
      after: m.studio_page_editor_dial_colour_after,
    },
    { id: 'corners', name: m.studio_page_editor_dial_corners, steps: ['brand', null, 'rounder'] },
    {
      id: 'spacing',
      name: m.studio_page_editor_dial_spacing,
      steps: ['compact', null, 'spacious'],
      after: m.studio_page_editor_dial_spacing_after,
    },
    // The Style's own motion is all of it, so it sits at the full end.
    {
      id: 'motion',
      name: m.studio_page_editor_dial_motion,
      steps: ['still', 'gentle', null],
      after: m.studio_page_editor_dial_motion_after,
    },
  ];

  const LABELS: Record<string, Message> = {
    'colour:muted': m.studio_page_editor_dial_colour_muted,
    'colour:vivid': m.studio_page_editor_dial_colour_vivid,
    'corners:brand': m.studio_page_editor_dial_corners_brand,
    'corners:rounder': m.studio_page_editor_dial_corners_rounder,
    'spacing:compact': m.studio_page_editor_dial_spacing_compact,
    'spacing:spacious': m.studio_page_editor_dial_spacing_spacious,
    'drama:calmer': m.studio_page_editor_dial_drama_calmer,
    'drama:louder': m.studio_page_editor_dial_drama_louder,
    'motion:still': m.studio_page_editor_dial_motion_still,
    'motion:gentle': m.studio_page_editor_dial_motion_gentle,
  };

  const NOTES: Record<string, Message> = {
    'colour:muted': m.studio_page_editor_dial_colour_muted_note,
    'colour:vivid': m.studio_page_editor_dial_colour_vivid_note,
    'colour:': m.studio_page_editor_dial_colour_own_note,
    'corners:brand': m.studio_page_editor_dial_corners_brand_note,
    'corners:rounder': m.studio_page_editor_dial_corners_rounder_note,
    'corners:': m.studio_page_editor_dial_corners_own_note,
    'spacing:compact': m.studio_page_editor_dial_spacing_compact_note,
    'spacing:spacious': m.studio_page_editor_dial_spacing_spacious_note,
    'spacing:': m.studio_page_editor_dial_spacing_own_note,
    'drama:calmer': m.studio_page_editor_dial_drama_calmer_note,
    'drama:louder': m.studio_page_editor_dial_drama_louder_note,
    'motion:still': m.studio_page_editor_dial_motion_still_note,
    'motion:gentle': m.studio_page_editor_dial_motion_gentle_note,
    'motion:': m.studio_page_editor_dial_motion_own_note,
  };

  const NO_EFFECT: Record<DialNoEffect, (step: string) => Message> = {
    'no-tints': () => m.studio_page_editor_dial_none_no_tints,
    'no-coloured-bands': () => m.studio_page_editor_dial_none_no_coloured_bands,
    'no-bands': () => m.studio_page_editor_dial_none_no_bands,
    'own-corners': (step) =>
      step === 'rounder'
        ? m.studio_page_editor_dial_none_own_rounder
        : m.studio_page_editor_dial_none_own_brand,
  };

  const VOICE_LINES: Record<TypeFacet, Message> = {
    bold: m.studio_page_editor_facet_bold,
    poster: m.studio_page_editor_facet_poster,
    soft: m.studio_page_editor_facet_soft,
    quiet: m.studio_page_editor_facet_quiet,
  };

  const style = $derived(resolveStyle(design));
  const label = $derived(STYLES[style].label);
  const dials = $derived<Record<string, string | undefined>>(design.dials ?? {});
  const facet = $derived(design.facets?.type);
  const menu = $derived(TYPE_FACET_BASES[style]);
  /** Whose headlines the page draws: the facet's, or the Style's own. */
  const voice = $derived(facet ? STYLES[facet].label : label);
  const adjusted = $derived(design.dials !== undefined || design.facets !== undefined);
  const brandStyle = $derived(brandOverridesToStyleAttr(brandOverrides));

  /** Why `step` of `dial` changes nothing here, or `null`. */
  function noEffect(dial: PageDialId, step: string | null): DialNoEffect | null {
    if (step === null) return null;
    return dialNoEffect(style, dial, step as PageDialStep<typeof dial>, { roundedBrand });
  }

  function noteOf(dial: PageDialId, after?: Message): string {
    const current = dials[dial] ?? '';
    const own = NOTES[`${dial}:${current}`]?.({ style: label, voice }) ?? '';
    return after ? `${own} ${after()}` : own;
  }

  /**
   * One sentence per reason, naming its step, as every step of the dial shares
   * one note: "this changes nothing" under the Style's own step would read as
   * that step. Both steps for one reason (Quiet's colour) are one sentence.
   */
  function reasons(dial: PageDialId, steps: readonly (string | null)[]): string[] {
    const byReason = new Map<DialNoEffect, string[]>();
    for (const step of steps) {
      const reason = noEffect(dial, step);
      if (step !== null && reason) byReason.set(reason, [...(byReason.get(reason) ?? []), step]);
    }
    return [...byReason].map(([reason, [first, ...rest]]) => {
      const why = NO_EFFECT[reason](first)({ style: label });
      return rest.length > 0
        ? m.studio_page_editor_dial_none_both({ style: label, why })
        : m.studio_page_editor_dial_none_one({ step: LABELS[`${dial}:${first}`]?.() ?? first, style: label, why });
    });
  }

  function press(dial: PageDialId, step: string | null): void {
    pageBuilder.setPageDial(dial, (step ?? undefined) as PageDialStep<typeof dial> | undefined);
  }

  async function resetAll(): Promise<void> {
    pageBuilder.resetPageLook();
    announce(m.studio_page_editor_dials_reset_done({ style: label }));
    // The reset button goes; focus lands on the first dial's own step.
    await tick();
    root?.querySelector<HTMLElement>('[data-dial="colour"][data-step=""]')?.focus();
  }
</script>

{#snippet steps(dial: PageDialId, options: readonly (string | null)[], noteId: string, own: string, ownHidden: string)}
  <div class="dial__steps" role="group" aria-labelledby="{uid}-{dial}">
    {#each options as step (step ?? '')}
      <button
        type="button"
        class="dial__step"
        data-dial={dial}
        data-step={step ?? ''}
        data-noop={noEffect(dial, step) ? '' : undefined}
        aria-pressed={(dials[dial] ?? null) === step}
        aria-describedby={noteId}
        onclick={() => press(dial, step)}
      >
        {#if step === null}
          {own}<span class="sr-only">{ownHidden}</span>
        {:else}
          {LABELS[`${dial}:${step}`]?.()}
        {/if}
      </button>
    {/each}
  </div>
{/snippet}

<section class="dials" aria-labelledby="{uid}-title" bind:this={root}>
  <h2 class="dials__title" id="{uid}-title">{m.studio_page_editor_dials_title({ style: label })}</h2>
  <p class="dials__body">{m.studio_page_editor_dials_body({ style: label })}</p>

  {#each DIALS as dial, index (dial.id)}
    {#if index === 3}
      <div class="dial" data-dial-group="headlines">
        <h3 class="dial__name" id="{uid}-headlines">{m.studio_page_editor_dial_headlines()}</h3>
        {#if menu.length === 0}
          <p class="dial__note"><b>{m.studio_page_editor_facet_none({ style: label })}</b></p>
        {:else}
          <p class="dial__sub" id="{uid}-facet">{m.studio_page_editor_dial_headlines_style()}</p>
          <div class="facets" role="group" aria-labelledby="{uid}-headlines {uid}-facet">
            {#each [null, ...menu] as type (type ?? '')}
              {@const line = type ? VOICE_LINES[type] : null}
              <button
                type="button"
                class="facet"
                data-facet={type ?? ''}
                aria-pressed={(facet ?? null) === type}
                aria-describedby={line ? `${uid}-facet-${type}` : undefined}
                onclick={() => pageBuilder.setTypeFacet(type ?? undefined)}
              >
                <span
                  class="lp facet__lp"
                  data-lp-style={style}
                  data-lp-type-facet={type ?? style}
                  data-lp-theme={theme}
                  data-org-brand={brandStyle ? '' : undefined}
                  style={brandStyle}
                  aria-hidden="true"
                >
                  <span class="lp-page facet__page">
                    <span class="lp-section facet__tile" data-lp-scheme="base">
                      <span class="lp-surface"></span>
                      <span class="facet__sample">{sample}</span>
                    </span>
                  </span>
                </span>
                <span class="facet__name">
                  {#if type}
                    {m.studio_page_editor_facet_voice({ voice: STYLES[type].label })}
                  {:else}
                    {m.studio_page_editor_facet_own({ style: label })}<span class="sr-only"
                      >{m.studio_page_editor_facet_own_hidden()}</span
                    >
                  {/if}
                </span>
                {#if line}<span class="sr-only" id="{uid}-facet-{type}">{line()}</span>{/if}
              </button>
            {/each}
          </div>
        {/if}
        <p class="dial__sub" id="{uid}-drama">{m.studio_page_editor_dial_headlines_size()}</p>
        <div class="dial__steps" role="group" aria-labelledby="{uid}-headlines {uid}-drama">
          {#each ['calmer', null, 'louder'] as step (step ?? '')}
            <button
              type="button"
              class="dial__step"
              data-dial="drama"
              data-step={step ?? ''}
              aria-pressed={(dials.drama ?? null) === step}
              aria-describedby="{uid}-drama-note"
              onclick={() => press('drama', step)}
            >
              {#if step === null}
                {m.studio_page_editor_dial_own({ style: voice })}<span class="sr-only"
                  >{m.studio_page_editor_dial_own_size_hidden()}</span
                >
              {:else}
                {LABELS[`drama:${step}`]?.()}
              {/if}
            </button>
          {/each}
        </div>
        <p class="dial__note" id="{uid}-drama-note">{noteOf('drama')}</p>
      </div>
    {/if}
    {@const why = reasons(dial.id, dial.steps)}
    <div class="dial" data-dial-group={dial.id}>
      <h3 class="dial__name" id="{uid}-{dial.id}">{dial.name()}</h3>
      {@render steps(
        dial.id,
        dial.steps,
        `${uid}-${dial.id}-note`,
        m.studio_page_editor_dial_own({ style: label }),
        m.studio_page_editor_dial_own_hidden()
      )}
      <p class="dial__note" id="{uid}-{dial.id}-note">
        {noteOf(dial.id, dial.after)}
        {#if why.length > 0}<b>{why.join(' ')}</b>{/if}
        {#if dial.id === 'motion'}
          {m.studio_page_editor_dial_motion_canvas()}
          <button type="button" class="dial__preview" onclick={onPreview}>
            {m.studio_page_editor_preview()}
          </button>
          {m.studio_page_editor_dial_motion_shows()}
        {/if}
      </p>
    </div>
  {/each}

  {#if adjusted}
    <button type="button" class="dials__reset" onclick={() => void resetAll()}>
      {m.studio_page_editor_dials_reset({ style: label })}
    </button>
  {/if}
</section>

<style>
  .dials {
    display: grid;
    gap: var(--space-4);
  }

  .dials__title {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .dials__body,
  .dial__note,
  .dial__sub {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--color-text-secondary);
  }

  .dials__body {
    margin-block-start: calc(-1 * var(--space-2));
  }

  .dial {
    display: grid;
    gap: var(--space-1-5);
  }

  .dial__name {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .dial__sub {
    font-weight: var(--font-medium);
  }

  .dial__note b {
    color: var(--color-text);
    font-weight: var(--font-medium);
  }

  /* The spacing control's well (SpacingControl), the pressed step raised on
     it; a label wraps to two lines rather than shrinking. */
  .dial__steps {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-0-5);
    padding: var(--space-0-5);
    border-radius: var(--radius-md);
    background: color-mix(in oklab, var(--color-text) 6%, transparent);
  }

  .dial__step {
    min-block-size: var(--tap-target-min);
    padding: var(--space-1) var(--space-2);
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-secondary);
    font: inherit;
    font-size: var(--text-xs);
    line-height: var(--leading-tight);
    cursor: pointer;
  }

  .dial__step:hover {
    color: var(--color-text);
  }

  .dial__step[aria-pressed='true'] {
    background: var(--color-surface);
    color: var(--color-text);
    font-weight: var(--font-medium);
    box-shadow: var(--shadow-xs);
  }

  /* A step that changes nothing here stays pressable, a shade quieter. */
  .dial__step[data-noop]:not([aria-pressed='true']) {
    color: color-mix(in oklab, var(--color-text-secondary) 70%, transparent);
  }

  .dial__step:focus-visible,
  .facet:focus-visible,
  .dials__reset:focus-visible,
  .dial__preview:focus-visible {
    outline: var(--border-width-thick) solid var(--color-text);
    outline-offset: var(--focus-offset);
  }

  .dial__preview {
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-text);
    font: inherit;
    font-weight: var(--font-medium);
    text-decoration: underline;
    cursor: pointer;
  }

  /* Headlines: two to a row, each a real page root in its Type. */
  .facets {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-1-5);
  }

  .facet {
    display: grid;
    gap: var(--space-1);
    min-inline-size: 0;
    min-block-size: var(--tap-target-min);
    padding: var(--space-1-5);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-background);
    color: var(--color-text);
    font: inherit;
    text-align: start;
    cursor: pointer;
  }

  .facet[aria-pressed='true'] {
    border-color: var(--color-text);
    box-shadow: inset 0 0 0 var(--border-width) var(--color-text);
  }

  /* A real band of the page, as the colour swatches draw (SchemeSwatches):
     its ground, its ink, its Style's surface. */
  .facet__lp,
  .facet__page {
    display: block;
    inline-size: 100%;
  }

  .facet__tile {
    display: block;
    padding: var(--space-2);
    overflow: clip;
    border: var(--border-width) var(--border-style) var(--lp-line);
    border-radius: var(--radius-sm);
  }

  /* The Type's own headline tokens, read on its root, at a swatch's size. */
  .facet__sample {
    position: relative;
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    color: var(--lp-heading-ink, currentColor);
    font-family: var(--lp-font-display);
    font-size: var(--text-base);
    font-weight: var(--lp-weight-display);
    font-synthesis: none;
    line-height: var(--lp-leading-display);
    letter-spacing: var(--lp-tracking-display);
    text-transform: var(--lp-case-display, none);
  }

  .facet__name {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
  }

  .dials__reset {
    justify-self: start;
    min-block-size: var(--tap-target-min);
    padding-inline: var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border-strong);
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text);
    font: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
  }
</style>
