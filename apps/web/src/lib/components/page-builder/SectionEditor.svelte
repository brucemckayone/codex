<!--
  @component SectionEditor

  The inspector for the rail's currently-selected section (Codex-2pryk.3.3 · WP-5).
  A faithful port of the prototype inspector: a visual VARIANT picker (§4.1
  "options per component") atop the schema-driven copy fields
  (`section-fields.ts`), then per-section actions (duplicate / hide / delete /
  reset). Every edit writes straight into the `pageBuilder` store's pending draft,
  so it streams to the live canvas immediately (two-way with in-canvas typing).

  MEDIA (Codex-eqh0z): a `control: 'media'` field is a REAL `MediaPicker` bound to
  the org media library, and it writes the `courses` sell-media COLUMN named by
  the field's `mediaSlot` — not `section.props`. That indirection is the whole
  point: the live sections resolve their clip from `sellPreview.intro` / `.reel` /
  `portraitUrl`, i.e. from those columns, so a picker that wrote into `props`
  could never change what renders (which is why the old control was a decorative
  text input). Slot edits land in the `sellMedia` store and persist on Save,
  alongside (but separately from) the page body.
-->
<script lang="ts">
  import type { PageSection } from '@codex/shared-types';
  import * as m from '$paraglide/messages';
  import { pageBuilder } from '$lib/page-builder/page-builder-store.svelte';
  import { sellMedia } from '$lib/page-builder/sell-media-store.svelte';
  import { sectionIcon } from './section-icons';
  import {
    findSectionDefinition,
    resolveDesign,
    resolveVariant,
    SECTION_DESIGN_AXES,
    type SectionDesignAxis,
    variantsForType,
  } from '$lib/page-builder';
  import MediaPicker from '$lib/components/studio/MediaPicker.svelte';
  import DesignAxisControl from './DesignAxisControl.svelte';
  import {
    AXIS_HINTS,
    AXIS_LABELS,
    axesForSectionType,
    axisOptions,
    isAxisValue,
  } from './design-vocabulary';
  import { fieldsForSectionType } from './section-fields';
  import type { SectionFieldDef } from './section-fields';
  import ArrayField from './ArrayField.svelte';
  import VariantPicker from './VariantPicker.svelte';

  interface Props {
    section: PageSection;
  }

  const { section }: Props = $props();

  /**
   * The section's icon as a COMPONENT, derived rather than inlined with
   * `{@const}`: that form is only legal as the immediate child of a block, and
   * the header it renders into is a plain element.
   */
  const SectionGlyph = $derived(sectionIcon(section.type));
  const definition = $derived(findSectionDefinition(section.type));

  /** Is this name one of the nine declared axes? Narrows a gate's `string` key. */
  function isDesignAxis(name: string): name is SectionDesignAxis {
    return (SECTION_DESIGN_AXES as readonly string[]).includes(name);
  }

  /**
   * ALL EIGHT DECLARED CONTROL KINDS ARE NOW BUILT (`Codex-28ifd` closed).
   *
   * `number`, `toggle`, `list` and `repeater` were declared by F-C and skipped
   * here, because before being skipped they fell through a catch-all
   * `<input type="text">` that wrote a STRING into keys that must hold an array
   * or a number — a creator typed into a field labelled "Credentials", saved, and
   * got nothing, since `coerce.ts`'s `asObjectArray` discards a non-array at its
   * first line. Skipping stopped the corruption; it did not give anyone the
   * control, so `guide.facts`, `feel.inclusions`, `ache.points`,
   * `invite.offers[].bullets`, `feel.previewDuration` and `invite.offers[].best`
   * were unauthorable.
   *
   * The array kinds share {@link ArrayField} — same interaction, differing only in
   * whether a row is one input or several, discriminated by `itemFields`.
   *
   * NO FILTER REMAINS. Every field the catalogue declares for a type now reaches
   * the rail, which is what the control-coverage guard asserts.
   */
  const fields = $derived(fieldsForSectionType(section.type));

  /**
   * Does this type field a sell-media picker? Drives the read-failure notice
   * below — a section with no media control must not be told about a media read.
   */
  const hasMediaField = $derived(fields.some((f) => f.control === 'media'));

  const variants = $derived(variantsForType(section.type));
  const currentVariant = $derived(resolveVariant(section));

  // ── Design axes (journey sections · F-B2) ──────────────────────────────────
  // Three values per axis, and the panel needs all three to be honest about
  // inheritance: what this section RENDERS as, what it would render as with no
  // override of its own, and where that fallback comes from.
  //
  // Both calls are the SAME `resolveDesign` the renderer uses, so the effective
  // value shown here cannot drift from the value emitted as `data-jp-*` — which a
  // second, local resolution eventually would.
  const pendingPage = $derived(pageBuilder.pending);
  /** Section → page → default: what this section actually renders as. */
  const effectiveDesign = $derived(resolveDesign(section, pendingPage));
  /** Page → default only: what it would render as if it overrode nothing. */
  const inheritedDesign = $derived(resolveDesign(null, pendingPage));
  /**
   * The axis gate for a field, or null when it is not gated / not currently held.
   *
   * A field declaring `disabledWhenAxis` is one whose CONTENT choice a DESIGN axis
   * can overrule — today only the hero's `mediaMode` under `media: none`. Rather
   * than let the author pick something with no effect, the control goes disabled
   * and the returned `reason` is shown in place of its hint.
   *
   * IT READS THE **EFFECTIVE** AXIS, not `section.design`, and the difference is
   * the whole point. Axis resolution is section → page → default, and a section
   * overrides nothing until a creator deliberately says so — so INHERITED is the
   * normal case, not the edge case. Reading the section's own bag alone meant the
   * gate only fired for a creator who had already set `media: none` on this one
   * section, while the page-level look that sets it for EVERY section left the
   * control live: the `Plain Facts` preset carries `media: 'none'`, so choosing it
   * removed the hero's media plate and left "What the media does" enabled, with
   * its ordinary hint on screen and every option a no-op. That is the exact shape
   * — a control that accepts the press and does nothing — that three rounds of
   * this effort were spent removing.
   *
   * `effectiveDesign` is the SAME `resolveDesign` call the renderer makes, so the
   * value the gate tests cannot drift from the value the section renders with; a
   * second, local resolution eventually would.
   *
   * `disabledWhenAxis.axis` is declared as a plain `string`, so it is NARROWED
   * against the runtime axis list rather than cast: a gate naming something that
   * is not one of the nine axes can then never silently resolve to `undefined`
   * and read as "not gated" — it is a declaration bug, and the narrowing is where
   * it stops.
   */
  const axisGate = (field: SectionFieldDef) => {
    const gate = field.disabledWhenAxis;
    if (!gate) return null;
    if (!isDesignAxis(gate.axis)) return null;
    return effectiveDesign[gate.axis] === gate.value ? gate : null;
  };

  /** `media` is inert on 6 of 11 types — hidden there rather than shown dead. */
  const designAxes = $derived(axesForSectionType(section.type));
  const overriddenCount = $derived(
    designAxes.filter((axis) => section.design?.[axis] !== undefined).length
  );

  /**
   * A document-unique id for a field's visible label, so a MANY-CONTROL field can
   * point `aria-labelledby` at it.
   *
   * Scoped by the SECTION id as well as the key: the inspector renders one
   * section at a time today, but an id that collided would silently give two
   * groups the same name — which is the failure this exists to fix, arriving from
   * the other direction. Non-id characters are folded out because a section id is
   * generated, not curated.
   */
  const fieldLabelId = (key: string): string =>
    `sf-${`${section.id}-${key}`.replace(/[^a-zA-Z0-9_-]+/g, '-')}`;

  /**
   * The id of the CONTROL itself, for `label[for]` and `aria-describedby`.
   * Distinct from `fieldLabelId`, which names the label element of a `role="group"`
   * field — a field takes exactly one branch, so they could not collide, but a
   * single id doing both jobs reads as a bug the first time someone greps for it.
   */
  const fieldControlId = (key: string): string => `${fieldLabelId(key)}-control`;

  /** Read a prop as a string for a control `value` (non-strings coerce to ''). */
  function valueOf(key: string): string {
    const v = section.props[key];
    return typeof v === 'string' ? v : '';
  }

  function onInput(key: string, event: Event): void {
    const target = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    pageBuilder.setSectionProp(section.id, key, target.value);
  }

  /** Read a prop as a number for a `number` control (non-numbers show empty). */
  function numberOf(key: string): string {
    const v = section.props[key];
    return typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
  }

  /**
   * Write a NUMBER, or drop the key when the box is cleared.
   *
   * Cleared means absent, not `0`: `feel.previewDuration` is the playhead length
   * and the section treats a missing duration as "no transport", where `0` is a
   * zero-length one. Writing `0` for an empty box would invent a value the
   * creator did not choose.
   */
  function onNumber(key: string, event: Event): void {
    const raw = (event.target as HTMLInputElement).value.trim();
    if (raw === '') {
      pageBuilder.setSectionProp(section.id, key, undefined);
      return;
    }
    const n = Number(raw);
    if (Number.isFinite(n)) pageBuilder.setSectionProp(section.id, key, n);
  }

  /** Read a prop as a boolean for a `toggle` control. */
  function boolOf(key: string): boolean {
    return section.props[key] === true;
  }

  function onToggle(key: string, event: Event): void {
    pageBuilder.setSectionProp(section.id, key, (event.target as HTMLInputElement).checked);
  }

  // Resettable only when it exists in the saved baseline (a new section has none).
  const canReset = $derived(
    !!pageBuilder.saved?.sections.some((s) => s.id === section.id)
  );
</script>

<div class="section-editor">
  <header class="section-editor__head">
    <div class="section-editor__title">
      <!-- THE LAST TEXT-NODE ICON, now an SVG like every other one.
           `definition.icon` is a catalogue STRING, and rendering it here put a
           glyph inside the header's text: `◇`, `◍`, `⊞`, `✦`. `aria-hidden`
           kept it out of the accessible name, so this was the milder half of
           Codex-1khpv — the rail's rows had the same glyphs UNHIDDEN and were
           announced as "⠿ ◇ Hero". The rail was converted; this was handed off
           and then missed, which a completeness audit caught.
           `sectionIcon` falls back for an unknown type, so the `?? '◌'` guard
           this replaces is no longer needed. IconBase marks it decorative. -->
      <span class="section-editor__glyph"><SectionGlyph /></span>
      <div>
        <p class="section-editor__label">{section.name ?? definition?.label ?? section.type}</p>
        {#if definition?.summary}
          <p class="section-editor__summary">{definition.summary}</p>
        {/if}
      </div>
    </div>
    {#if canReset}
      <button
        type="button"
        class="section-editor__reset"
        onclick={() => pageBuilder.resetSection(section.id)}
        title={m.studio_builder_inspector_reset_title()}
      >
        {m.studio_builder_inspector_reset()}
      </button>
    {/if}
  </header>

  {#if variants.length >= 2}
    <div class="section-editor__group">
      <p class="section-editor__group-label">{m.studio_builder_inspector_layout()}</p>
      <VariantPicker
        {variants}
        selected={currentVariant}
        onselect={(id) => pageBuilder.setSectionVariant(section.id, id)}
      />
    </div>
  {/if}

  <!--
    The DESIGN group. Sits under the variant picker because a variant is which
    composition this section uses, and the axes are how that composition is
    dressed — you choose the shape, then adjust it.

    Every control shows its effective value, whether that value is inherited or
    set here, and the way back to inherited. Without that the model is invisible:
    per-axis inheritance means a control reading "Wide" may be this section's
    choice OR the page's, and those two behave completely differently when the
    page's preset changes.
  -->
  <div class="section-editor__group">
    <p class="section-editor__group-label">
      {m.studio_builder_inspector_design()}
      {#if overriddenCount > 0}
        <span class="section-editor__group-count">
          {m.studio_builder_inspector_design_count({ count: overriddenCount })}
        </span>
      {/if}
    </p>
    <p class="section-editor__hint">
      {m.studio_builder_inspector_design_hint()}
    </p>
    <div class="section-editor__axes">
      {#each designAxes as axis (axis)}
        <!--
          Hoist the per-iteration values BEFORE the handler closures: Svelte 5
          does not carry narrowing from the `{#each}` binding into a callback, so
          the `{@const}`s are what keep `axis` typed inside `onselect`.
        -->
        {@const override = section.design?.[axis]}
        <DesignAxisControl
          label={AXIS_LABELS[axis]}
          hint={AXIS_HINTS[axis]}
          options={axisOptions(axis)}
          effective={effectiveDesign[axis]}
          {override}
          inherited={inheritedDesign[axis]}
          inheritedFrom={pendingPage?.design?.[axis] ? 'page' : 'default'}
          onselect={(value) => {
            // Guarded, not cast: an illegal value would store fine and then match
            // no CSS rule, which reads as a control that does nothing.
            if (isAxisValue(axis, value)) {
              pageBuilder.setSectionDesignAxis(section.id, axis, value);
            }
          }}
          onclear={() => pageBuilder.setSectionDesignAxis(section.id, axis, undefined)}
        />
      {/each}
    </div>
  </div>

  <div class="section-editor__fields">
    <p class="section-editor__group-label">{m.studio_builder_inspector_content()}</p>
    <!--
      THE READ FAILURE IS SAID OUT LOUD HERE TOO, and the omission it replaces is
      the one this feature has already been caught by once.

      `sellMedia.loadError` was populated by both of `open()`'s reads and rendered
      only in `PageMediaPanel`. The SAME store feeds the `media` control in every
      section inspector — six of them across hero / introVideo / reel / guide — and
      those rendered nothing at all, so a failed media-library read was
      indistinguishable from "you have no ready media": an empty picker, no
      message, and a creator who concludes their library is empty. That is
      precisely the shape the panel's own comment describes fixing on its side,
      left unfixed on this one.

      Gated on `hasMediaField`, so a prose section is never told about a media read
      it does not make. Same `role="alert"`, same error-then-loading pair as the
      panel, deliberately: two surfaces reporting one fact should say it the same
      way.
    -->
    {#if hasMediaField}
      {#if sellMedia.loadError}
        <p class="section-editor__warn" role="alert">{sellMedia.loadError}</p>
      {:else if sellMedia.loading}
        <p class="section-editor__hint" role="status">{m.studio_builder_media_loading()}</p>
      {/if}
    {/if}

    {#each fields as field (field.key)}
      <!--
        Hoist the narrowed slot BEFORE the handler closure: Svelte 5 does not
        carry `field.mediaSlot`'s non-null narrowing into a callback, so the
        `{@const}` is what keeps `setSlot` typed without a cast.
      -->
      {#if field.control === 'media' && field.mediaSlot}
        {@const slot = field.mediaSlot}
        {@const labelId = fieldLabelId(field.key)}
        <!--
          `role="group"` + `aria-labelledby`, NOT a `<label>`: the picker renders
          a combobox input, a clear button and (once something is chosen) a
          preview button, and a label wrapping more than one control labels none
          of them.

          IT IS ALSO NOT THE WHOLE FIX, stated plainly rather than left to be
          discovered. Melt's combobox puts its own `aria-labelledby` on the input,
          pointing at a `$label` element `MediaPicker` never renders — so the
          reference DANGLES and the widget's own accessible name falls through to
          the placeholder "Select media...", identical for all six pickers. Three
          of them sit stacked in the guide inspector (Portrait / Video /
          Signature), so a screen-reader user got the same name three times with
          nothing to tell them apart. A named group is announced on entry and is
          the fix available inside this directory; naming the widget itself needs
          a label prop on `MediaPicker`, which lives in `components/studio` and is
          handed off.
        -->
        <div class="section-editor__field" role="group" aria-labelledby={labelId}>
          <span class="section-editor__field-label" id={labelId}>{field.label}</span>
          <!--
            `optionsFor(slot)`, NOT `options` — and the store's own doc comment is
            the one this line was breaking: "Every surface with a sell-media
            picker calls THIS rather than reading `options` directly, so the panel
            and the per-section inspector cannot drift into offering different
            lists for the same slot." The inspector was the surface that had
            drifted. `heroMediaId`, `guidePortraitMediaId` and `signatureMediaId`
            accept VIDEO only, because an audio item has `thumbnailKey: null` by
            construction and can resolve to no still at all — so the three still
            slots were offering a creator items that could only ever render as
            nothing: picked, saved clean, no error, section unchanged.
          -->
          <!-- `ariaLabel` names the widget ITSELF. The `role="group"` wrapper around
               this field already gives a screen reader the field name on entry, but
               Melt puts `aria-labelledby` on the trigger pointing at a `label`
               element MediaPicker never renders, so the trigger's OWN name fell
               through to the shared placeholder — three stacked pickers in the guide
               inspector all announced as "Select media…". `field.label` is the same
               string the visible label shows, so the two cannot drift.
               NO `disabled` here on purpose. A picker whose library has not loaded
               accepts a pick the store then drops (`save()` no-ops on `!loaded`), but
               disabling it is a UI-layer patch on a STORE-layer defect — and `!loaded`
               is also true after a FAILED read, which would leave every media field
               permanently dead. That gap is filed separately; it needs a guard in
               `setSlot` and its own test, not a drive-by prop. -->
          <MediaPicker
            mediaItems={sellMedia.optionsFor(slot)}
            value={sellMedia.slot(slot)}
            name={`section-media-${slot}`}
            ariaLabel={field.label}
            showLibraryLink
            onchange={(mediaItemId) => sellMedia.setSlot(slot, mediaItemId)}
          />
          {#if field.hint}
            <span class="section-editor__hint">{field.hint}</span>
          {/if}
        </div>
      {:else if field.control === 'list' || field.control === 'repeater'}
        <!--
          A `<div>`, not a `<label>`: these render MANY inputs, and a label
          wrapping more than one control labels none of them. The group gets a
          plain heading and each row labels its own cells.
        -->
        {@const arrayField = field}
        {@const labelId = fieldLabelId(field.key)}
        <div class="section-editor__field" role="group" aria-labelledby={labelId}>
          <span class="section-editor__field-label" id={labelId}>{field.label}</span>
          <ArrayField
            field={arrayField}
            value={section.props[arrayField.key]}
            onchange={(next) =>
              pageBuilder.setSectionProp(section.id, arrayField.key, next)}
          />
          {#if field.hint}
            <span class="section-editor__hint">{field.hint}</span>
          {/if}
        </div>
      {:else if field.control === 'toggle'}
        <!--
          UNREACHABLE TODAY, AND LEFT THAT WAY DELIBERATELY. The catalogue declares
          exactly one `control: 'toggle'` — `invite.offers[].best` — and it is
          NESTED in `itemFields`, so `ArrayField` renders it and this branch does
          not. It stays as the seam the coverage assertion in
          `section-editor-controls.svelte.test.ts` requires (a declared kind with
          no branch falls through to the catch-all text input and starts corrupting
          the shape it names).

          IF YOU ADD A TOP-LEVEL TOGGLE, port the `{:else}` branch's shape below
          first: this `<label>` wraps the control AND the hint, so the hint is
          folded into the checkbox's accessible name. That was the defect measured
          and fixed for every reachable field.

          AND YOU WILL BE TOLD, rather than trusted to read this. A guard in
          `section-editor-field-description.svelte.test.ts` asserts the catalogue
          declares no top-level toggle; it fails on the very commit that makes this
          branch reachable and names the port in its message. A comment asking for
          care is a convention — this one has a shape behind it.
        -->
        <label class="section-editor__field section-editor__field--inline">
          <input
            type="checkbox"
            class="section-editor__check"
            checked={boolOf(field.key)}
            onchange={(e) => onToggle(field.key, e)}
          />
          <span class="section-editor__field-label">{field.label}</span>
          {#if field.hint}
            <span class="section-editor__hint">{field.hint}</span>
          {/if}
        </label>
      {:else}
      {@const gate = axisGate(field)}
      {@const controlId = fieldControlId(field.key)}
      <!-- The reason REPLACES the hint: a hint about what the control does is
           noise while the control cannot do it. -->
      {@const hintText = gate ? gate.reason : field.hint}
      <!--
        A `<div>` with an explicit `label[for]`, NOT a `<label>` wrapping the lot.

        MEASURED, live, before this change: because the hint sat INSIDE the
        wrapping label, every word of it was folded into the control's ACCESSIBLE
        NAME. "Accent ending" announced as "Accent ending Set in italic accent at
        the end of the headline. Leave blank for none." — and `aria-describedby`
        was null on all twelve fields. A hint is a DESCRIPTION, not a name, so it
        moves out of the label and onto `aria-describedby`.

        This is not a downgrade from implicit association: `field-inventory-sweep`
        resolves an accessible name by `label[for]` FIRST and only then falls back
        to a wrapping label, so the explicit form is the one it prefers.
      -->
      <div
        class="section-editor__field"
        data-hint={hintText ? (gate ? 'pinned' : 'reveal') : 'none'}
      >
        <label class="section-editor__field-label" for={controlId}>{field.label}</label>
        {#if field.control === 'textarea'}
          <textarea
            id={controlId}
            class="section-editor__input section-editor__input--area"
            rows="3"
            placeholder={field.placeholder}
            value={valueOf(field.key)}
            disabled={Boolean(gate)}
            aria-describedby={hintText ? `${controlId}-hint` : undefined}
            oninput={(e) => onInput(field.key, e)}
          ></textarea>
        {:else if field.control === 'number'}
          <input
            id={controlId}
            type="number"
            class="section-editor__input"
            placeholder={field.placeholder}
            value={numberOf(field.key)}
            disabled={Boolean(gate)}
            aria-describedby={hintText ? `${controlId}-hint` : undefined}
            oninput={(e) => onNumber(field.key, e)}
          />
        {:else if field.control === 'select'}
          <select
            id={controlId}
            class="section-editor__input"
            value={valueOf(field.key)}
            disabled={Boolean(gate)}
            aria-describedby={hintText ? `${controlId}-hint` : undefined}
            onchange={(e) => onInput(field.key, e)}
          >
            {#each field.options ?? [] as opt (opt.value)}
              <option value={opt.value}>{opt.label}</option>
            {/each}
          </select>
        {:else}
          <input
            id={controlId}
            type="text"
            class="section-editor__input"
            placeholder={field.placeholder}
            value={valueOf(field.key)}
            disabled={Boolean(gate)}
            aria-describedby={hintText ? `${controlId}-hint` : undefined}
            oninput={(e) => onInput(field.key, e)}
          />
        {/if}
        {#if hintText}
          <p class="section-editor__hint" id={`${controlId}-hint`}>{hintText}</p>
        {/if}
      </div>
      {/if}
    {/each}
  </div>

  <footer class="section-editor__foot">
    <button type="button" class="section-editor__foot-btn" onclick={() => pageBuilder.duplicateSection(section.id)}>
      {m.studio_builder_inspector_duplicate()}
    </button>
    <button type="button" class="section-editor__foot-btn" onclick={() => pageBuilder.toggleSection(section.id)}>
      {section.enabled ? m.studio_builder_inspector_hide() : m.studio_builder_inspector_show()}
    </button>
    <button
      type="button"
      class="section-editor__foot-btn section-editor__foot-btn--danger"
      onclick={() => pageBuilder.removeSection(section.id)}
    >
      {m.studio_builder_inspector_delete()}
    </button>
  </footer>
</div>

<style>
  .section-editor {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4);
  }

  .section-editor__head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .section-editor__title {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    min-width: 0;
  }

  .section-editor__glyph {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-7);
    height: var(--space-7);
    flex-shrink: 0;
    border-radius: var(--radius-md);
    background-color: var(--color-surface-secondary);
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }

  .section-editor__label {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .section-editor__summary {
    margin: var(--space-0-5) 0 0;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    line-height: var(--leading-snug);
  }

  .section-editor__reset {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    flex-shrink: 0;
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: none;
    color: var(--color-text-secondary);
    font-size: var(--text-xs);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .section-editor__reset:hover {
    color: var(--color-text);
    background-color: var(--color-surface-secondary);
  }

  .section-editor__reset:focus-visible,
  .section-editor__foot-btn:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }

  .section-editor__group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  /* Group headings, so they carry structure — measured 2.52:1 light / 3.19:1 dark
     on `--color-text-muted` at 13px semibold, which is NOT WCAG large text and so
     needs the full 4.5. Same one-token fix as the hints below. */
  .section-editor__group-label {
    margin: 0;
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }

  /* Deliberately NOT the override colour: this is a count on a plain surface, and
     the status-info text token is vetted against its own chip surface, not this
     one. The chips inside the group carry the colour; this carries the number. */
  .section-editor__group-count {
    font-weight: var(--font-normal);
    text-transform: none;
    letter-spacing: normal;
    color: var(--color-text-secondary);
  }

  /* A toggle labels itself beside its box rather than above it. */
  .section-editor__field--inline {
    flex-direction: row;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .section-editor__check {
    inline-size: var(--space-4);
    block-size: var(--space-4);
    accent-color: var(--color-interactive);
    flex: none;
  }

  .section-editor__check:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }

  .section-editor__axes {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .section-editor__fields {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .section-editor__field {
    /* Anchors the revealed hint below the row (see `[data-hint='reveal']`). */
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .section-editor__field-label {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
  }

  .section-editor__input {
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background-color: var(--color-surface);
    color: var(--color-text);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    transition: var(--transition-colors);
  }

  .section-editor__input--area {
    resize: vertical;
    line-height: var(--leading-normal);
  }

  /* Placeholders stay MUTED on purpose: they are the one string here that must
     read as absent-until-typed, and WCAG treats placeholder text as exempt only
     while it is not the field's only label — every field above has a real
     `<label>`. */
  .section-editor__input::placeholder {
    color: var(--color-text-muted);
  }

  .section-editor__input:focus-visible {
    outline: none;
    border-color: var(--color-interactive);
    box-shadow: var(--shadow-focus-ring);
  }

  /* `--color-text-secondary`, not `--color-text-muted`: measured by canvas readback
     on this panel, muted at `--text-xs` is 2.52:1 light / 3.19:1 dark, and 13px is
     not WCAG "large text", so it needed the full 4.5. Secondary reads 7.81 / 10.21.
     Applies to the pre-existing field hints too, which had the same defect. */
  .section-editor__hint {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    line-height: var(--leading-snug);
  }

  /*
    A CONTENT field's hint is revealed on hover or focus rather than held in flow.
    Scoped by `[data-hint='reveal']` AND a direct-child selector on purpose:
    `.section-editor__hint` is shared by five call sites, two of which must never
    hide — the DESIGN group's one-line explanation of inheritance, and the media
    library's `role="status"` / `role="alert"` read-out. A bare
    `.section-editor__hint` rule here would silence a load failure.

    `opacity`, NOT `display: none` or `visibility: hidden`: the hint is the target
    of the control's `aria-describedby`, and those two remove a node from the
    accessibility tree — which would unwire the description with no visual symptom.
  */
  .section-editor__field[data-hint='reveal'] > .section-editor__hint {
    position: absolute;
    inset-inline: 0;
    top: 100%;
    z-index: var(--z-tooltip);
    margin: 0;
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-sm);
    background-color: var(--color-surface-secondary);
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--duration-fast) var(--ease-out);
  }

  /* Hover AND focus-within: hover alone is unreachable by keyboard and by touch. */
  .section-editor__field[data-hint='reveal']:hover > .section-editor__hint,
  .section-editor__field[data-hint='reveal']:focus-within > .section-editor__hint {
    opacity: 1;
  }

  /*
    `data-hint='pinned'` is the axis-gated case and stays in flow, deliberately.
    A gated control is `disabled`, so it is NOT focusable and touch offers no
    hover — a revealed reason would be the one thing neither a keyboard nor a
    touch user could reach. `variant-picker.svelte.test.ts` documents this exact
    trap for the descoped composition card; this is the same rule for fields.
  */

  /* The media read-failure notice. Same surface and same tokens as
     `PageMediaPanel`'s `.panel__warn`, because it reports the same fact from the
     same store — two treatments for one failure would read as two failures. */
  .section-editor__warn {
    margin: 0;
    padding: var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-warning-200);
    border-radius: var(--radius-md);
    background-color: var(--color-warning-50);
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--color-warning-700);
  }

  .section-editor__foot {
    display: flex;
    gap: var(--space-2);
    padding-top: var(--space-3);
    border-top: var(--border-width) var(--border-style) var(--color-border-subtle);
  }

  .section-editor__foot-btn {
    flex: 1;
    padding: var(--space-2);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: none;
    color: var(--color-text-secondary);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .section-editor__foot-btn:hover {
    color: var(--color-text);
    background-color: var(--color-surface-secondary);
  }

  .section-editor__foot-btn--danger:hover {
    color: var(--color-error-600, var(--color-error));
    border-color: color-mix(in oklab, var(--color-error, red) 40%, transparent);
  }
</style>
