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
  import { pageBuilder } from '$lib/page-builder/page-builder-store.svelte';
  import { sellMedia } from '$lib/page-builder/sell-media-store.svelte';
  import {
    findSectionDefinition,
    resolveDesign,
    resolveVariant,
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
  import VariantPicker from './VariantPicker.svelte';

  interface Props {
    section: PageSection;
  }

  const { section }: Props = $props();

  const definition = $derived(findSectionDefinition(section.type));
  const fields = $derived(fieldsForSectionType(section.type));
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
  /** `media` is inert on 6 of 11 types — hidden there rather than shown dead. */
  const designAxes = $derived(axesForSectionType(section.type));
  const overriddenCount = $derived(
    designAxes.filter((axis) => section.design?.[axis] !== undefined).length
  );

  /** Read a prop as a string for a control `value` (non-strings coerce to ''). */
  function valueOf(key: string): string {
    const v = section.props[key];
    return typeof v === 'string' ? v : '';
  }

  function onInput(key: string, event: Event): void {
    const target = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    pageBuilder.setSectionProp(section.id, key, target.value);
  }

  // Resettable only when it exists in the saved baseline (a new section has none).
  const canReset = $derived(
    !!pageBuilder.saved?.sections.some((s) => s.id === section.id)
  );
</script>

<div class="section-editor">
  <header class="section-editor__head">
    <div class="section-editor__title">
      <span class="section-editor__glyph" aria-hidden="true">{definition?.icon ?? '◌'}</span>
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
        title="Reset this section to its saved values"
      >
        Reset
      </button>
    {/if}
  </header>

  {#if variants.length >= 2}
    <div class="section-editor__group">
      <p class="section-editor__group-label">Layout · options</p>
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
      Design
      {#if overriddenCount > 0}
        <span class="section-editor__group-count">
          · {overriddenCount} set here
        </span>
      {/if}
    </p>
    <p class="section-editor__hint">
      Inherited from the page's look unless you change it here.
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
    <p class="section-editor__group-label">Content</p>
    {#each fields as field (field.key)}
      <!--
        Hoist the narrowed slot BEFORE the handler closure: Svelte 5 does not
        carry `field.mediaSlot`'s non-null narrowing into a callback, so the
        `{@const}` is what keeps `setSlot` typed without a cast.
      -->
      {#if field.control === 'media' && field.mediaSlot}
        {@const slot = field.mediaSlot}
        <div class="section-editor__field">
          <span class="section-editor__field-label">{field.label}</span>
          <MediaPicker
            mediaItems={sellMedia.options}
            value={sellMedia.slot(slot)}
            name={`section-media-${slot}`}
            showLibraryLink
            onchange={(mediaItemId) => sellMedia.setSlot(slot, mediaItemId)}
          />
          {#if field.hint}
            <span class="section-editor__hint">{field.hint}</span>
          {/if}
        </div>
      {:else}
      <label class="section-editor__field">
        <span class="section-editor__field-label">{field.label}</span>
        {#if field.control === 'textarea'}
          <textarea
            class="section-editor__input section-editor__input--area"
            rows="3"
            placeholder={field.placeholder}
            value={valueOf(field.key)}
            oninput={(e) => onInput(field.key, e)}
          ></textarea>
        {:else if field.control === 'select'}
          <select
            class="section-editor__input"
            value={valueOf(field.key)}
            onchange={(e) => onInput(field.key, e)}
          >
            {#each field.options ?? [] as opt (opt.value)}
              <option value={opt.value}>{opt.label}</option>
            {/each}
          </select>
        {:else}
          <input
            type="text"
            class="section-editor__input"
            placeholder={field.placeholder}
            value={valueOf(field.key)}
            oninput={(e) => onInput(field.key, e)}
          />
        {/if}
        {#if field.hint}
          <span class="section-editor__hint">{field.hint}</span>
        {/if}
      </label>
      {/if}
    {/each}
  </div>

  <footer class="section-editor__foot">
    <button type="button" class="section-editor__foot-btn" onclick={() => pageBuilder.duplicateSection(section.id)}>
      Duplicate
    </button>
    <button type="button" class="section-editor__foot-btn" onclick={() => pageBuilder.toggleSection(section.id)}>
      {section.enabled ? 'Hide' : 'Show'}
    </button>
    <button
      type="button"
      class="section-editor__foot-btn section-editor__foot-btn--danger"
      onclick={() => pageBuilder.removeSection(section.id)}
    >
      Delete
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

  .section-editor__axes {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .section-editor__fields {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .section-editor__field {
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
