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
-->
<script lang="ts">
  import { brandEditor } from '$lib/brand-editor';
  import * as m from '$paraglide/messages';
  import {
    clearHeroSettings,
    HERO_PURPOSE_COPY,
    HERO_PURPOSES,
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

  const GROUPS: ReadonlyArray<{ id: string; title: Words; fields: readonly Field[] }> = [
    {
      id: 'arrangement',
      title: m.branding_hero_group_arrangement,
      fields: [
        { key: 'comp', label: m.branding_hero_field_comp, values: { statement: m.branding_hero_comp_statement, centre: m.branding_hero_comp_centre, showcase: m.branding_hero_comp_showcase, split: m.branding_hero_comp_split, billboard: m.branding_hero_comp_billboard } },
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
        { key: 'main', label: m.branding_hero_field_main, values: { consume: m.branding_hero_main_consume, explore: m.branding_hero_main_explore, join: m.branding_hero_main_join, film: m.branding_hero_main_film, follow: m.branding_hero_main_follow } },
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
  ];

  const overrides = $derived(brandEditor.pending?.tokenOverrides ?? {});
  const settings = $derived(readHeroSettings(overrides));
  // Counted from the stored keys, so a stale or retired value still shows as a
  // change and Reset clears it.
  const changed = $derived(storedHeroChanges(overrides));
  const purposeLabelId = $props.id();

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
            <b>{HERO_PURPOSE_COPY[purpose].label('watch')}</b>
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

    {#each GROUPS as group (group.id)}
      <section class="hero-designer__section">
        <span class="hero-designer__label">{group.title()}</span>
        {#each group.fields as field (field.key)}
          {@const current = settings.options[field.key] ?? null}
          <div class="hero-designer__field" data-changed={current !== null ? '' : undefined}>
            <span class="hero-designer__field-label">{field.label()}</span>
            <div class="hero-designer__seg" role="group" aria-label={field.label()}>
              <button type="button" aria-pressed={current === null} onclick={() => setOption(field.key, null)}>{m.branding_hero_auto()}</button>
              {#each Object.entries(field.values) as [value, label] (value)}
                <button type="button" aria-pressed={current === value} onclick={() => setOption(field.key, value)}>
                  {label()}
                </button>
              {/each}
            </div>
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

  .hero-designer__seg {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .hero-designer__seg button,
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

  .hero-designer__seg button[aria-pressed='true'] {
    background: var(--color-interactive);
    border-color: var(--color-interactive);
    color: var(--color-on-interactive);
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
  .hero-designer__seg button:focus-visible,
  .hero-designer__primary:focus-visible,
  .hero-designer__quiet:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }
</style>
