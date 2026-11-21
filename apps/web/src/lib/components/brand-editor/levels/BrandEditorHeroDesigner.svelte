<!--
  @component BrandEditorHeroDesigner

  The brand studio's Hero › Composition control: the purpose-first hero
  from `$lib/org-hero/hero-config.ts`. It writes `hero-opt-*` keys into the
  pending tokenOverrides, exactly as the Layout control writes `hero-hide-*`,
  so the preview frame re-renders live through the existing bridge and Save
  persists them with the rest of the brand.

  Every option offers "Auto": no stored value, so the purpose decides (and the
  page's fallbacks decide what this org can actually show). Only the options
  the org changes are stored, so improving a purpose's defaults later reaches
  every org that never touched them.

  The preview reports what the hero resolved to (WP-9, the preview bridge's
  resolved report): a field whose choice the page cannot show says what it
  shows instead, the purposes are named in the org's own kind ("Get people
  listening"), and the Showreel group shows whenever the hero is a Showreel,
  chosen outright or by its purpose on Auto. A hint rests only on a report
  resolved from the choices as they now stand (`answers`), never on one
  still on its way back after an edit, nor on a landing the preview has left.
-->
<script lang="ts">
  import { answers, brandEditor, previewResolved } from '$lib/brand-editor';
  import { reelInkWarning } from '$lib/brand-editor/reel-ink-warning';
  import ListSegment from '$lib/components/studio/list-toolbar/ListSegment.svelte';
  import * as m from '$paraglide/messages';
  import {
    clearHeroSettings,
    HERO_PURPOSE_COPY,
    HERO_PURPOSES,
    heroConsumeLabel,
    type HeroOptionKey,
    type HeroOptions,
    type HeroPurpose,
    readHeroSettings,
    storedHeroChanges,
    writeHeroSetting,
  } from '$lib/org-hero/hero-config';

  /** A message, called at render so it reads in the visitor's language. */
  type Words = () => string;

  /**
   * One option and a label for EVERY value it can take, so a value added to
   * `HERO_OPTION_VALUES` fails the typecheck here until the editor names it.
   */
  type Field = {
    [K in HeroOptionKey]: {
      key: K;
      label: Words;
      values: Readonly<Record<HeroOptions[K], Words>>;
    };
  }[HeroOptionKey];

  const onOff = { on: m.branding_hero_on, off: m.branding_hero_off };
  /** The kind of content the preview's hero names, else watching. */
  const kind = () => previewResolved.current?.kind ?? 'watch';

  type Group = {
    id: string;
    title: Words;
    fields: readonly Field[];
    /** Only while the hero is a Showreel (its own options). */
    showreel?: true;
  };

  const GROUPS: readonly Group[] = [
    {
      id: 'arrangement',
      title: m.branding_hero_group_arrangement,
      fields: [
        { key: 'comp', label: m.branding_hero_field_comp, values: { statement: m.branding_hero_comp_statement, centre: m.branding_hero_comp_centre, showcase: m.branding_hero_comp_showcase, split: m.branding_hero_comp_split, billboard: m.branding_hero_comp_billboard, showreel: m.branding_hero_comp_showreel } },
        { key: 'align', label: m.branding_hero_field_align, values: { start: m.branding_hero_align_start, center: m.branding_hero_align_center, end: m.branding_hero_align_end } },
        { key: 'height', label: m.branding_hero_field_height, values: { full: m.branding_hero_height_full, tall: m.branding_hero_height_tall, compact: m.branding_hero_height_compact } },
      ],
    },
    {
      id: 'background',
      title: m.branding_hero_group_background,
      fields: [
        { key: 'bg', label: m.branding_hero_field_bg, values: { shader: m.branding_hero_bg_shader, film: m.branding_hero_bg_film, gradient: m.branding_hero_bg_gradient, pattern: m.branding_hero_bg_pattern, plain: m.branding_hero_bg_plain } },
        { key: 'veil', label: m.branding_hero_field_veil, values: { auto: m.branding_hero_veil_auto, soft: m.branding_hero_veil_soft, strong: m.branding_hero_veil_strong } },
        { key: 'ambient', label: m.branding_hero_field_ambient, values: { drift: m.branding_hero_ambient_drift, still: m.branding_hero_ambient_still } },
        { key: 'grain', label: m.branding_hero_field_grain, values: onOff },
      ],
    },
    {
      id: 'words',
      title: m.branding_hero_group_words,
      fields: [
        { key: 'lead', label: m.branding_hero_field_lead, values: { both: m.branding_hero_lead_both, logo: m.branding_hero_lead_logo, name: m.branding_hero_lead_name } },
        { key: 'logo', label: m.branding_hero_field_logo, values: { s: m.branding_hero_logo_s, m: m.branding_hero_logo_m, l: m.branding_hero_logo_l } },
        { key: 'line', label: m.branding_hero_field_line, values: { desc: m.branding_hero_line_desc, none: m.branding_hero_none } },
        { key: 'search', label: m.branding_hero_field_search, values: onOff },
      ],
    },
    {
      id: 'buttons',
      title: m.branding_hero_group_buttons,
      fields: [
        { key: 'main', label: m.branding_hero_field_main, values: { consume: () => heroConsumeLabel(kind()), explore: m.branding_hero_main_explore, join: m.branding_hero_main_join, film: m.branding_hero_main_film, follow: m.branding_hero_main_follow } },
        { key: 'second', label: m.branding_hero_field_second, values: { auto: m.branding_hero_second_auto, none: m.branding_hero_none } },
        { key: 'micro', label: m.branding_hero_field_micro, values: onOff },
        { key: 'bstyle', label: m.branding_hero_field_bstyle, values: { solid: m.branding_hero_bstyle_solid, outline: m.branding_hero_bstyle_outline, pill: m.branding_hero_bstyle_pill, link: m.branding_hero_bstyle_link } },
      ],
    },
    {
      id: 'spotlight',
      title: m.branding_hero_group_spotlight,
      fields: [
        { key: 'spot', label: m.branding_hero_field_spot, values: { featured: m.branding_hero_spot_featured, latest: m.branding_hero_spot_latest, film: m.branding_hero_spot_film, none: m.branding_hero_none } },
        { key: 'proof', label: m.branding_hero_field_proof, values: { facts: m.branding_hero_proof_facts, shelf: m.branding_hero_proof_shelf, none: m.branding_hero_none } },
      ],
    },
    {
      id: 'feeling',
      title: m.branding_hero_group_feeling,
      fields: [
        { key: 'type', label: m.branding_hero_field_type, values: { classic: m.branding_hero_type_classic, expressive: m.branding_hero_type_expressive, caps: m.branding_hero_type_caps, oversized: m.branding_hero_type_oversized } },
        { key: 'accent', label: m.branding_hero_field_accent, values: { none: m.branding_hero_none, underline: m.branding_hero_accent_underline, highlight: m.branding_hero_accent_highlight } },
        { key: 'entrance', label: m.branding_hero_field_entrance, values: { rise: m.branding_hero_entrance_rise, reveal: m.branding_hero_entrance_reveal, fade: m.branding_hero_entrance_fade, none: m.branding_hero_none } },
      ],
    },
    {
      id: 'showreel',
      title: m.branding_hero_group_showreel,
      showreel: true,
      fields: [
        { key: 'reel-layout', label: m.branding_hero_field_reel_layout, values: { corner: m.branding_hero_reel_layout_corner, wide: m.branding_hero_reel_layout_wide, name: m.branding_hero_reel_layout_name } },
        { key: 'reel-peek', label: m.branding_hero_field_reel_peek, values: { off: m.branding_hero_reel_peek_off, on: m.branding_hero_reel_peek_on } },
        { key: 'reel-pointer', label: m.branding_hero_field_reel_pointer, values: { liquid: m.branding_hero_reel_pointer_liquid, smoke: m.branding_hero_reel_pointer_smoke, glitch: m.branding_hero_reel_pointer_glitch, none: m.branding_hero_none } },
        { key: 'reel-trans', label: m.branding_hero_field_reel_trans, values: { burn: m.branding_hero_reel_trans_burn, liquid: m.branding_hero_reel_trans_liquid, glitch: m.branding_hero_reel_trans_glitch } },
        { key: 'reel-surface', label: m.branding_hero_field_reel_surface, values: { none: m.branding_hero_none, grain: m.branding_hero_reel_surface_grain, halftone: m.branding_hero_reel_surface_halftone, reeded: m.branding_hero_reel_surface_reeded, red: m.branding_hero_reel_surface_red, shader: m.branding_hero_reel_surface_shader } },
        { key: 'reel-band', label: m.branding_hero_field_reel_band, values: { fade: m.branding_hero_reel_band_fade, under: m.branding_hero_reel_band_under, edges: m.branding_hero_reel_band_edges, none: m.branding_hero_none } },
        { key: 'reel-edge', label: m.branding_hero_field_reel_edge, values: { shadow: m.branding_hero_reel_edge_shadow, outline: m.branding_hero_reel_edge_outline } },
        { key: 'reel-opening', label: m.branding_hero_field_reel_opening, values: { name: m.branding_hero_reel_opening_name, none: m.branding_hero_none } },
        { key: 'reel-film', label: m.branding_hero_field_reel_film, values: { name: m.branding_hero_reel_film_name, smoke: m.branding_hero_reel_film_smoke, liquid: m.branding_hero_reel_film_liquid } },
        { key: 'reel-loop', label: m.branding_hero_field_reel_loop, values: { on: m.branding_hero_reel_loop_on, off: m.branding_hero_reel_loop_off } },
      ],
    },
  ];

  const overrides = $derived(brandEditor.pending?.tokenOverrides ?? {});
  const settings = $derived(readHeroSettings(overrides));
  // Counted from the stored keys, so a stale or retired value still shows as a
  // change and Reset clears it.
  const changed = $derived(storedHeroChanges(overrides));
  const purposeLabelId = $props.id();
  const report = $derived(previewResolved.current);
  // What the page drew from THESE choices: the last report is from before an
  // edit until the preview answers it, so no hint rests on a stale one.
  const resolved = $derived(report && answers(report, settings) ? report.options : null);

  // The hero is a Showreel when chosen outright, or on Auto when its purpose
  // picks one: the preview says which, and before its first report the
  // purpose that does (Get people watching, for an org with a reel). Only the
  // purpose and the composition decide it, so a report on those two still
  // holds while an edit of anything else is on its way.
  const storedComp = $derived(settings.options.comp ?? null);
  const reelReport = $derived(report && answers(report, settings, ['comp']) ? report : null);
  const showreelOnAuto = $derived(
    storedComp === null &&
      (reelReport ? reelReport.options.comp === 'showreel' : settings.purpose === 'consume')
  );
  const isShowreel = $derived(storedComp === 'showreel' || showreelOnAuto);
  const groups = $derived(GROUPS.filter((group) => !group.showreel || isShowreel));
  // The brand's ink on its ground, on the theme being edited, as the reel
  // judges a word (reel-scrim's `contrast`): below the floor, Text over
  // footage decides what the reel does with it.
  const inkWarning = $derived(
    reelInkWarning(brandEditor.getThemeColor('primaryColor'), brandEditor.getThemeColor('backgroundColor'))
  );

  /** The segment's options: Auto (no stored value, '') and every value. */
  function optionsOf(field: Field) {
    return [
      { value: '', label: m.branding_hero_auto },
      ...Object.entries<Words>(field.values).map(([value, label]) => ({ value, label })),
    ];
  }

  /** What the page shows in place of a choice it cannot, or null. */
  function shownInstead(field: Field, choice: string | null): string | null {
    const shown = resolved?.[field.key];
    if (choice === null || shown === undefined || shown === choice) return null;
    const label = Object.entries<Words>(field.values).find(([value]) => value === shown)?.[1];
    return label ? label() : null;
  }

  function write(next: Record<string, string | null>) {
    brandEditor.updateField('tokenOverrides', next);
  }

  function setPurpose(purpose: HeroPurpose) {
    // A new purpose starts from its own defaults, as the design pages show.
    write(writeHeroSetting(clearHeroSettings(overrides, { keepPurpose: false }), 'purpose', purpose));
  }

  function setOption(key: HeroOptionKey, value: string | null) {
    write(writeHeroSetting(overrides, key, value));
  }
</script>

<div class="hero-designer">
  {#if !settings.purpose}
    <section class="hero-designer__intro">
      <p class="hero-designer__lede">{m.branding_hero_intro()}</p>
      <button type="button" class="hero-designer__primary" onclick={() => setPurpose('spotlight')}>
        {m.branding_hero_try()}
      </button>
    </section>
  {:else}
    <section class="hero-designer__section">
      <span class="hero-designer__label" id={purposeLabelId}>{m.branding_hero_purpose_label()}</span>
      <div class="hero-designer__purposes" role="group" aria-labelledby={purposeLabelId}>
        {#each HERO_PURPOSES as purpose (purpose)}
          <button
            type="button"
            class="hero-designer__purpose"
            aria-pressed={settings.purpose === purpose}
            onclick={() => setPurpose(purpose)}
          >
            <b>{HERO_PURPOSE_COPY[purpose].label(kind())}</b>
            <small>{HERO_PURPOSE_COPY[purpose].hint()}</small>
          </button>
        {/each}
      </div>
    </section>

    <div class="hero-designer__bar">
      <span>{changed === 0 ? m.branding_hero_unchanged() : m.branding_hero_changed({ count: String(changed) })}</span>
      <button
        type="button"
        class="hero-designer__quiet"
        disabled={changed === 0}
        onclick={() => write(clearHeroSettings(overrides, { keepPurpose: true }))}
      >
        {m.branding_hero_reset()}
      </button>
    </div>

    {#each groups as group (group.id)}
      <section class="hero-designer__section" data-group={group.id}>
        <span class="hero-designer__label">{group.title()}</span>
        {#if group.showreel}
          <p class="hero-designer__lede">{m.branding_hero_showreel_lede()}</p>
          {#if showreelOnAuto && settings.purpose}
            <p class="hero-designer__lede">
              {m.branding_hero_showreel_auto_note({ purpose: HERO_PURPOSE_COPY[settings.purpose].label(kind()) })}
            </p>
          {/if}
        {/if}
        {#each group.fields as field (field.key)}
          {@const current = settings.options[field.key] ?? null}
          {@const instead = shownInstead(field, current)}
          <div class="hero-designer__field" data-key={field.key} data-changed={current !== null ? '' : undefined}>
            <span class="hero-designer__field-label">{field.label()}</span>
            <ListSegment
              label={field.label()}
              value={current ?? ''}
              options={optionsOf(field)}
              wrap
              onSelect={(value) => setOption(field.key, value === '' ? null : value)}
            />
            {#if instead}
              <p class="hero-designer__instead">{m.branding_hero_resolved_hint({ value: instead })}</p>
            {/if}
            {#if field.key === 'reel-edge' && inkWarning}
              <div class="hero-designer__warning" data-ink-warning>
                <strong>{m.branding_hero_reel_ink_warning_title()}</strong>
                <p>
                  {m.branding_hero_reel_ink_warning_body({
                    ratio: String(inkWarning.ratio),
                    floor: String(inkWarning.floor),
                  })}
                </p>
              </div>
            {/if}
          </div>
        {/each}
      </section>
    {/each}

    <button
      type="button"
      class="hero-designer__quiet hero-designer__back"
      onclick={() => write(clearHeroSettings(overrides, { keepPurpose: false }))}
    >
      {m.branding_hero_back_classic()}
    </button>
  {/if}
</div>

<style>
  /* System scope (the studio rail): no org-only tokens (R12). */
  .hero-designer {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .hero-designer__intro {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .hero-designer__lede {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .hero-designer__section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .hero-designer__label {
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
    color: var(--color-text-secondary);
  }

  .hero-designer__purposes {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2);
  }

  .hero-designer__purpose {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
    text-align: left;
    font: inherit;
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-text);
    cursor: pointer;
  }

  .hero-designer__purpose b { font-size: var(--text-sm); font-weight: var(--font-semibold); }
  .hero-designer__purpose small { font-size: var(--text-xs); color: var(--color-text-secondary); }

  .hero-designer__purpose[aria-pressed='true'] {
    border-color: var(--color-interactive);
    box-shadow: 0 0 0 1px var(--color-interactive);
  }

  .hero-designer__bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .hero-designer__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .hero-designer__field-label {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  /* a changed option gets a dot, as on the design pages */
  .hero-designer__field[data-changed] .hero-designer__field-label { color: var(--color-text); }
  .hero-designer__field[data-changed] .hero-designer__field-label::before {
    content: '';
    width: var(--space-2);
    height: var(--space-2);
    border-radius: var(--radius-full);
    background: var(--color-status-warning-text);
  }

  .hero-designer__instead {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-status-warning-text);
  }

  .hero-designer__warning {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-status-warning-border);
    border-radius: var(--radius-md);
    background: var(--color-status-warning-surface);
    color: var(--color-status-warning-text);
    font-size: var(--text-xs);
  }

  .hero-designer__warning p {
    margin: 0;
  }

  .hero-designer__quiet {
    padding: var(--space-1) var(--space-2);
    font: inherit;
    font-size: var(--text-xs);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-text);
    cursor: pointer;
  }

  .hero-designer__primary {
    align-self: flex-start;
    padding: var(--space-2) var(--space-4);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    border: 0;
    border-radius: var(--radius-button);
    background: var(--color-interactive);
    color: var(--color-on-interactive);
    cursor: pointer;
  }

  .hero-designer__quiet { padding-inline: var(--space-3); }

  .hero-designer__quiet:disabled { opacity: var(--opacity-50, 0.5); cursor: default; }
  .hero-designer__back { align-self: flex-start; }

  .hero-designer__purpose:focus-visible,
  .hero-designer__primary:focus-visible,
  .hero-designer__quiet:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }
</style>
