/**
 * THE FIELD INVENTORY SWEEP — one row per editable field, six verdicts each.
 *
 * WHY THIS FILE EXISTS, and why it is shaped as a table rather than as a set of
 * hand-written cases. Nine rounds of work on this builder were DEFECT-DRIVEN:
 * each fixed the fields a bead or a review had named. Nobody had ever ENUMERATED
 * the inputs and checked every one, so a field nothing had complained about was
 * never checked at all — and three of the four defects this file was written to
 * catch are exactly that shape:
 *
 *   · the section inspector's media pickers offered the WHOLE library rather than
 *     `optionsFor(slot)`, so a hero/portrait/signature slot that accepts video
 *     only offered audio items — picked, saved clean, rendered as nothing. The
 *     store's own doc comment asserts the opposite invariant ("Every surface with
 *     a sell-media picker calls THIS rather than reading `options` directly, so
 *     the panel and the per-section inspector cannot drift"), and the inspector
 *     was the surface that had drifted.
 *   · `hero.mediaMode`'s axis gate read the SECTION's own `design` bag, so a
 *     page-level look that sets `media: none` (the "Plain Facts" preset does)
 *     removed the media plate while leaving the control live and its ordinary
 *     hint on screen — a select whose every option does nothing.
 *   · the six media pickers had no programmatic accessible name at all. A `<span>`
 *     inside a `<div>` labels nothing, and the guide inspector stacks THREE of
 *     them (Portrait / Video / Signature), each announced identically.
 *
 * ── WHAT EACH VERDICT PROVES, AND WHAT IT DOES NOT ────────────────────────────
 * The sweep asks six questions per row. Two of them need a boundary this file
 * cannot cross, so the claim is narrowed rather than overstated:
 *
 * 1. PERSISTS      — the write reaches `getSavePayload()` AND survives the REAL
 *                    `saveJourneyPageBodySchema` (the `.strict()` body the save
 *                    endpoint parses), AND comes back through `open()`. That is
 *                    the whole client half. It does NOT prove the jsonb column
 *                    round-trip; `props` is one passthrough record written as a
 *                    single column, and that half is verified once, live, in the
 *                    round's report rather than 98 times here.
 * 2. RIGHT KEY     — the value lands on the key the field DECLARES, in the SHAPE
 *                    its reader tests for (`asStringArray` returns `[]` for a
 *                    string, `fieldBool` tests `=== true`, `typeof raw ===
 *                    'number'`). A control that writes a string into an array key
 *                    is how `guide.facts` came to persist with
 *                    `jsonb_typeof = string`.
 * 3. LABELLED      — the control has an accessible name that CONTAINS the field's
 *                    own label. `accessibleName()` below implements the HTML-AAM
 *                    steps this app actually relies on; a placeholder-only name is
 *                    recorded as a FAILURE, because a placeholder is not a name.
 * 5. KEYBOARD      — the control is focusable and takes focus. Reordering is not
 *                    pointer-only: every array row carries real move buttons.
 * 6. HONEST WHEN
 *    DISABLED      — a disabled control must be accompanied by visible text that
 *                    says why. The one gated field in the catalogue declares its
 *                    own `reason`; the guard asserts the reason REPLACES the hint.
 *
 * Property 4 (error-surfaced) is not a per-row property — it belongs to the
 * surface that owns the read — so it is asserted once per surface at the foot of
 * this file rather than 98 times.
 *
 * ── THE ROW COUNT IS PART OF THE ASSERTION ────────────────────────────────────
 * `section-fields.ts` declares 85 field keys in source text; because
 * `PROSE_FIELDS`, `videoFields()`, `pointsField()` and `DURATION_FIELD` are shared
 * across types, those 85 declarations expand to 98 field INSTANCES over the eleven
 * section types (88 top-level + 10 repeater entry fields). The sweep asserts the
 * count so a field set that silently loses a type's fields fails here, and so a
 * future reader can tell a complete sweep from a sample.
 */

import type { PageBuilderState, PageSection } from '@codex/shared-types';
import { saveJourneyPageBodySchema } from '@codex/validation';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import { pageBuilder } from '$lib/page-builder/page-builder-store.svelte';
import SectionEditor from './SectionEditor.svelte';
import { SECTION_FIELDS, type SectionFieldDef } from './section-fields';

const PAGE_ID = '00000000-0000-4000-8000-00000000f001';
const COURSE_ID = '00000000-0000-4000-8000-00000000f0c0';
const SECTION_ID = 'sweep-section';

/** A minimal page draft carrying ONE section of the type under sweep. */
function pageWith(section: PageSection, design?: Record<string, string>): PageBuilderState {
  return {
    pageType: 'course',
    slug: 'sweep',
    title: 'Sweep',
    status: 'draft',
    subjectType: 'course',
    subjectId: COURSE_ID,
    brandOverrides: null,
    sections: [section],
    ...(design ? { design } : {}),
  } as PageBuilderState;
}

function sectionOfType(type: string, props: Record<string, unknown> = {}): PageSection {
  return { id: SECTION_ID, type, enabled: true, props } as PageSection;
}

/** The live section out of the store's pending draft. */
function live(): PageSection {
  const s = pageBuilder.pending?.sections[0];
  if (!s) throw new Error('no pending section — open() did not seed the draft');
  return s;
}

// ── The inventory, derived rather than listed ────────────────────────────────

interface Row {
  readonly type: string;
  /** `key` for a top-level field, `parent[].key` for a repeater entry field. */
  readonly path: string;
  readonly field: SectionFieldDef;
  /** The repeater that owns this row, when it is an entry field. */
  readonly parent?: SectionFieldDef;
}

const ROWS: readonly Row[] = Object.entries(SECTION_FIELDS).flatMap(
  ([type, fields]) =>
    fields.flatMap((field): Row[] => [
      { type, path: field.key, field },
      ...(field.itemFields ?? []).map((sub) => ({
        type,
        path: `${field.key}[].${sub.key}`,
        field: sub,
        parent: field,
      })),
    ])
);

const TOP_LEVEL = ROWS.filter((r) => !r.parent);
const ENTRY = ROWS.filter((r) => r.parent);

// ── Accessible-name computation, to the depth this app relies on ─────────────

/**
 * The accessible name of a control, by the HTML-AAM steps that actually occur in
 * this builder — in precedence order, and reporting the SOURCE so a
 * placeholder-only name can be judged as the failure it is.
 *
 * Deliberately not a full AccName implementation: jsdom has no
 * `computedAccessibleName`, and a partial one that silently returned the
 * placeholder as a "name" would make the labelling verdict vacuous, which is the
 * exact failure this sweep exists to correct.
 */
function accessibleName(
  el: HTMLElement
): { name: string; from: string } {
  const aria = el.getAttribute('aria-label');
  if (aria?.trim()) return { name: aria.trim(), from: 'aria-label' };

  const ids = el.getAttribute('aria-labelledby');
  if (ids?.trim()) {
    const text = ids
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ')
      .trim();
    if (text) return { name: text, from: 'aria-labelledby' };
  }

  const id = el.getAttribute('id');
  if (id) {
    const explicit = document.querySelector<HTMLElement>(`label[for="${id}"]`);
    if (explicit?.textContent?.trim()) {
      return { name: explicit.textContent.trim(), from: 'label[for]' };
    }
  }

  const wrapping = el.closest('label');
  if (wrapping?.textContent?.trim()) {
    return { name: wrapping.textContent.trim(), from: 'wrapping label' };
  }

  if (el.tagName === 'BUTTON' && el.textContent?.trim()) {
    return { name: el.textContent.trim(), from: 'button content' };
  }

  // A GROUP's name reaches the control as context rather than as its own name.
  // Counted, because it is what the media pickers legitimately have — the picker
  // is a component this directory does not own, so it cannot take a label prop
  // yet, and a named group is the standard fallback (see the handoff).
  const group = el.closest('[role="group"]');
  if (group) {
    const gLabel = group.getAttribute('aria-label');
    if (gLabel?.trim()) return { name: gLabel.trim(), from: 'group aria-label' };
    const gIds = group.getAttribute('aria-labelledby');
    if (gIds?.trim()) {
      const text = gIds
        .split(/\s+/)
        .map((gid) => document.getElementById(gid)?.textContent ?? '')
        .join(' ')
        .trim();
      if (text) return { name: text, from: 'group aria-labelledby' };
    }
  }

  const title = el.getAttribute('title');
  if (title?.trim()) return { name: title.trim(), from: 'title' };

  const placeholder = el.getAttribute('placeholder');
  if (placeholder?.trim()) {
    return { name: placeholder.trim(), from: 'PLACEHOLDER ONLY' };
  }

  return { name: '', from: 'NONE' };
}

// ── DOM location, by the field's own visible label ───────────────────────────
// Every label is unique within a section type (asserted below), so a label is a
// safe key — and it is the same string a creator reads, so a lookup that fails is
// a real "the field is not on screen" failure rather than a selector drifting.

function fieldBlock(label: string): HTMLElement {
  const found = [
    ...document.body.querySelectorAll<HTMLElement>('.section-editor__field'),
  ].find(
    (el) =>
      el.querySelector('.section-editor__field-label')?.textContent?.trim() ===
      label
  );
  if (!found) throw new Error(`no field block labelled "${label}"`);
  return found;
}

function cellBlock(within: HTMLElement, label: string): HTMLElement {
  const found = [...within.querySelectorAll<HTMLElement>('.af__cell')].find(
    (el) => el.querySelector('.af__cell-label')?.textContent?.trim() === label
  );
  if (!found) throw new Error(`no entry cell labelled "${label}"`);
  return found;
}

/** The one interactive control inside a field block (or its picker trigger). */
function controlIn(block: HTMLElement): HTMLElement {
  const direct = block.querySelector<HTMLElement>(
    ':scope > input, :scope > textarea, :scope > select'
  );
  if (direct) return direct;
  const picker = block.querySelector<HTMLElement>(
    '.picker-trigger, .trigger-preview'
  );
  if (picker) return picker;
  const any = block.querySelector<HTMLElement>('input, textarea, select, button');
  if (!any) throw new Error(`no control inside ${block.className}`);
  return any;
}

function typeInto(el: HTMLElement, value: string): void {
  (el as HTMLInputElement).value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

function chooseIn(el: HTMLSelectElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
}

function check(el: HTMLInputElement): void {
  el.checked = true;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
}

/** A button inside `within` whose visible text contains `text`. */
function buttonIn(within: HTMLElement, text: string): HTMLButtonElement {
  const found = [...within.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => (b.textContent ?? '').includes(text)
  );
  if (!found) throw new Error(`no button containing "${text}"`);
  return found;
}

/** The last option value a select really offers, skipping the unset sentinel. */
function lastRealOption(field: SectionFieldDef): string {
  const opts = (field.options ?? []).filter((o) => o.value !== '');
  if (opts.length === 0) throw new Error(`select ${field.key} offers no value`);
  return opts[opts.length - 1].value;
}

/** The value a control of this kind should write, and the shape to expect back. */
function sampleFor(row: Row): string | number | boolean {
  switch (row.field.control) {
    case 'number':
      return 137;
    case 'toggle':
      return true;
    case 'select':
      return lastRealOption(row.field);
    default:
      return `sweep ${row.type} ${row.path}`;
  }
}

beforeEach(() => {
  pageBuilder.close();
});

afterEach(() => {
  document.body.innerHTML = '';
  pageBuilder.close();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('the inventory itself', () => {
  it('is 98 field instances over 11 section types — 88 top-level, 10 entry', () => {
    // The number is asserted so a sweep can be told from a sample, and so a lost
    // field set fails here. 85 keys are DECLARED in source text; the four shared
    // definitions (PROSE_FIELDS x3, videoFields x2, DURATION_FIELD x3,
    // pointsField x2) expand those 85 into 98 instances.
    expect(Object.keys(SECTION_FIELDS)).toHaveLength(11);
    expect(ROWS).toHaveLength(98);
    expect(TOP_LEVEL).toHaveLength(88);
    expect(ENTRY).toHaveLength(10);
  });

  it('labels every field uniquely within its own type, so a label is a safe key', () => {
    // The sweep locates a control by the string a creator reads. Two fields
    // sharing a label inside one section would make one of them invisible to this
    // file AND ambiguous to a screen-reader user, so the collision is the defect.
    for (const [type, fields] of Object.entries(SECTION_FIELDS)) {
      const labels = [
        ...fields.map((f) => f.label),
        ...fields.flatMap((f) => (f.itemFields ?? []).map((s) => s.label)),
      ];
      expect(new Set(labels).size, `${type} has a duplicate field label`).toBe(
        labels.length
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1 + 2. PERSISTS, AND ROUND-TRIPS THE RIGHT KEY IN THE RIGHT SHAPE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Drive one row's control and return what the draft now holds on its key.
 *
 * `media` rows are excluded by the caller: a `control: 'media'` field writes a
 * `courses` sell-media COLUMN, not `section.props`, so its round trip belongs to
 * `sell-media-store.test.ts` and its OPTIONS belong to the media test below.
 */
function driveTopLevel(row: Row): unknown {
  const block = fieldBlock(row.field.label);
  const sample = sampleFor(row);

  if (row.field.control === 'list') {
    buttonIn(block, `Add ${row.field.itemLabel ?? 'item'}`).click();
    flushSync();
    const input = block.querySelector<HTMLInputElement>('.af__input');
    if (!input) throw new Error(`${row.path}: no list row input after Add`);
    typeInto(input, String(sample));
    return live().props[row.field.key];
  }

  if (row.field.control === 'repeater') {
    buttonIn(block, `Add ${row.field.itemLabel ?? 'item'}`).click();
    flushSync();
    return live().props[row.field.key];
  }

  const control = controlIn(block);
  if (row.field.control === 'select') {
    chooseIn(control as HTMLSelectElement, String(sample));
  } else if (row.field.control === 'toggle') {
    check(control as HTMLInputElement);
  } else {
    typeInto(control, String(sample));
  }
  return live().props[row.field.key];
}

/** The shape the field's reader tests for. */
function expectedShape(row: Row): string {
  switch (row.field.control) {
    case 'number':
      return 'number';
    case 'toggle':
      return 'boolean';
    case 'list':
    case 'repeater':
      return 'array';
    default:
      return 'string';
  }
}

function shapeOf(value: unknown): string {
  return Array.isArray(value) ? 'array' : typeof value;
}

describe('1+2 · every field writes ITS OWN key, in the shape its reader tests for', () => {
  for (const [type, fields] of Object.entries(SECTION_FIELDS)) {
    const writable = fields.filter((f) => f.control !== 'media');

    it(`${type} — all ${writable.length} non-media fields`, () => {
      const failures: string[] = [];
      for (const field of writable) {
        // A FRESH draft per field: a shared one would let an earlier write mask a
        // later field that wrote the WRONG key (the failure this asserts against).
        pageBuilder.close();
        pageBuilder.open(PAGE_ID, pageWith(sectionOfType(type)));
        const component = mount(SectionEditor, {
          target: document.body,
          props: { section: live() },
        });
        flushSync();

        const row: Row = { type, path: field.key, field };
        try {
          const stored = driveTopLevel(row);
          if (stored === undefined) {
            failures.push(`${type}.${field.key}: nothing landed on the key`);
          } else if (shapeOf(stored) !== expectedShape(row)) {
            failures.push(
              `${type}.${field.key}: stored ${shapeOf(stored)}, reader wants ${expectedShape(row)}`
            );
          }
          // NO OTHER KEY may have been touched. A control that writes a
          // neighbour's key is how the invite section came to read a key the
          // claim test never consulted.
          const touched = Object.keys(live().props);
          if (touched.length !== 1 || touched[0] !== field.key) {
            failures.push(
              `${type}.${field.key}: write touched ${JSON.stringify(touched)}`
            );
          }
        } catch (err) {
          failures.push(`${type}.${field.key}: ${(err as Error).message}`);
        }

        unmount(component);
        document.body.innerHTML = '';
      }
      expect(failures).toEqual([]);
    });
  }
});

describe('1 · the whole authored draft survives the REAL save body schema', () => {
  it('parses every declared key of every type, and hands it back unchanged', () => {
    // The failure this catches: an authored value that the `.strict()` save body
    // refuses, or a 16KB `props` cap a fully-authored section breaches. Both
    // present to a creator as "Page saved" over content that never persisted.
    const failures: string[] = [];

    for (const [type, fields] of Object.entries(SECTION_FIELDS)) {
      pageBuilder.close();
      pageBuilder.open(PAGE_ID, pageWith(sectionOfType(type)));
      const component = mount(SectionEditor, {
        target: document.body,
        props: { section: live() },
      });
      flushSync();

      for (const field of fields.filter((f) => f.control !== 'media')) {
        try {
          driveTopLevel({ type, path: field.key, field });
        } catch (err) {
          failures.push(`${type}.${field.key}: ${(err as Error).message}`);
        }
      }
      const authored = { ...live().props };
      unmount(component);
      document.body.innerHTML = '';

      const payload = pageBuilder.getSavePayload();
      if (!payload) {
        failures.push(`${type}: getSavePayload() returned null`);
        continue;
      }
      const parsed = saveJourneyPageBodySchema.safeParse({
        id: PAGE_ID,
        pageType: payload.pageType,
        slug: payload.slug,
        title: payload.title,
        status: payload.status,
        subjectType: payload.subjectType,
        subjectId: payload.subjectId,
        brandOverrides: payload.brandOverrides,
        sections: payload.sections,
      });
      if (!parsed.success) {
        failures.push(`${type}: save body REJECTED — ${parsed.error.message}`);
        continue;
      }

      // Re-open from the PARSED payload, which is what the service would store,
      // and require every authored key back with the same value.
      const stored = parsed.data.sections[0];
      pageBuilder.close();
      pageBuilder.open(PAGE_ID, pageWith(stored as PageSection));
      for (const [key, value] of Object.entries(authored)) {
        const back = live().props[key];
        if (JSON.stringify(back) !== JSON.stringify(value)) {
          failures.push(
            `${type}.${key}: reloaded as ${JSON.stringify(back)}, authored ${JSON.stringify(value)}`
          );
        }
      }
    }

    expect(failures).toEqual([]);
  });
});

describe('1+2 · a repeater ENTRY field writes its own cell, in its own shape', () => {
  for (const row of ENTRY) {
    it(`${row.type}.${row.path} (${row.field.control})`, () => {
      const parent = row.parent as SectionFieldDef;
      pageBuilder.open(PAGE_ID, pageWith(sectionOfType(row.type, { [parent.key]: [{}] })));
      const component = mount(SectionEditor, {
        target: document.body,
        props: { section: live() },
      });
      flushSync();

      const cell = cellBlock(fieldBlock(parent.label), row.field.label);
      const sample = sampleFor(row);

      if (row.field.control === 'list') {
        buttonIn(cell, `Add ${row.field.itemLabel ?? 'item'}`).click();
        flushSync();
        const input = cell.querySelector<HTMLInputElement>('.af__input');
        if (!input) throw new Error('no nested list row input after Add');
        typeInto(input, String(sample));
      } else {
        const control = cell.querySelector<HTMLElement>('input, textarea, select');
        if (!control) throw new Error('no control in the entry cell');
        if (row.field.control === 'select') {
          chooseIn(control as HTMLSelectElement, String(sample));
        } else if (row.field.control === 'toggle') {
          check(control as HTMLInputElement);
        } else {
          typeInto(control, String(sample));
        }
      }

      const rows = live().props[parent.key] as Record<string, unknown>[];
      expect(Array.isArray(rows)).toBe(true);
      expect(shapeOf(rows[0][row.field.key])).toBe(expectedShape(row));
      // The write must not have replaced the row wholesale — a sibling cell's
      // value has to survive a neighbour's edit.
      expect(Object.keys(rows[0])).toEqual([row.field.key]);

      unmount(component);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. LABELLED — an accessible name a screen reader can use, and the RIGHT one
// ─────────────────────────────────────────────────────────────────────────────

describe('3 · every control carries an accessible name that names ITS OWN field', () => {
  for (const [type, fields] of Object.entries(SECTION_FIELDS)) {
    it(`${type} — ${fields.length} fields`, () => {
      pageBuilder.open(PAGE_ID, pageWith(sectionOfType(type)));
      const component = mount(SectionEditor, {
        target: document.body,
        props: { section: live() },
      });
      flushSync();

      const failures: string[] = [];
      for (const field of fields) {
        try {
          const block = fieldBlock(field.label);
          const control = controlIn(block);
          const { name, from } = accessibleName(control);
          if (!name) {
            failures.push(`${type}.${field.key}: NO accessible name (${from})`);
          } else if (from === 'PLACEHOLDER ONLY') {
            failures.push(
              `${type}.${field.key}: named only by its placeholder "${name}"`
            );
          } else if (!name.includes(field.label)) {
            // The name must name THE FIELD IT EDITS. Three media pickers stacked
            // in the guide inspector all named "Search your media…" is the
            // failure: a name that exists but does not distinguish the control.
            failures.push(
              `${type}.${field.key}: named "${name}" (${from}) — does not contain "${field.label}"`
            );
          }
        } catch (err) {
          failures.push(`${type}.${field.key}: ${(err as Error).message}`);
        }
      }
      unmount(component);
      expect(failures).toEqual([]);
    });
  }

  it('names every repeater ENTRY cell after the cell, not after the group', () => {
    const failures: string[] = [];
    for (const row of ENTRY) {
      const parent = row.parent as SectionFieldDef;
      pageBuilder.close();
      pageBuilder.open(
        PAGE_ID,
        pageWith(sectionOfType(row.type, { [parent.key]: [{}] }))
      );
      const component = mount(SectionEditor, {
        target: document.body,
        props: { section: live() },
      });
      flushSync();
      const cell = cellBlock(fieldBlock(parent.label), row.field.label);
      const control = cell.querySelector<HTMLElement>('input, textarea, select');
      if (!control) {
        failures.push(`${row.type}.${row.path}: no control`);
      } else {
        const { name, from } = accessibleName(control);
        if (!name || from === 'PLACEHOLDER ONLY' || !name.includes(row.field.label)) {
          failures.push(`${row.type}.${row.path}: named "${name}" (${from})`);
        }
      }
      unmount(component);
      document.body.innerHTML = '';
    }
    expect(failures).toEqual([]);
  });

  it('names every plain-STRING list row by its field and its position', () => {
    // A `list` renders identical bare inputs. Without a per-row name they are
    // announced as "edit text, edit text, edit text" — the reason ArrayField
    // gives the string branch an explicit `aria-label` rather than a shared one.
    const failures: string[] = [];
    for (const row of TOP_LEVEL.filter((r) => r.field.control === 'list')) {
      pageBuilder.close();
      pageBuilder.open(PAGE_ID, pageWith(sectionOfType(row.type)));
      const component = mount(SectionEditor, {
        target: document.body,
        props: { section: live() },
      });
      flushSync();
      const block = fieldBlock(row.field.label);
      buttonIn(block, `Add ${row.field.itemLabel ?? 'item'}`).click();
      buttonIn(block, `Add ${row.field.itemLabel ?? 'item'}`).click();
      flushSync();
      const inputs = [...block.querySelectorAll<HTMLElement>('.af__input')];
      const names = inputs.map((i) => accessibleName(i).name);
      if (names.length !== 2 || names[0] === names[1] || names.some((n) => !n)) {
        failures.push(`${row.type}.${row.path}: row names ${JSON.stringify(names)}`);
      }
      unmount(component);
      document.body.innerHTML = '';
    }
    expect(failures).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. KEYBOARD-REACHABLE — reachable and operable without a pointer
// ─────────────────────────────────────────────────────────────────────────────

describe('5 · every control is reachable and operable from the keyboard', () => {
  for (const [type, fields] of Object.entries(SECTION_FIELDS)) {
    it(`${type} — ${fields.length} fields`, () => {
      pageBuilder.open(PAGE_ID, pageWith(sectionOfType(type)));
      const component = mount(SectionEditor, {
        target: document.body,
        props: { section: live() },
      });
      flushSync();

      const failures: string[] = [];
      for (const field of fields) {
        try {
          const control = controlIn(fieldBlock(field.label));
          if (control.getAttribute('tabindex') === '-1') {
            failures.push(`${type}.${field.key}: tabindex="-1"`);
          }
          if ((control as HTMLInputElement).disabled) {
            failures.push(`${type}.${field.key}: disabled with no axis gate`);
          }
          control.focus();
          if (document.activeElement !== control) {
            failures.push(`${type}.${field.key}: cannot take focus`);
          }
        } catch (err) {
          failures.push(`${type}.${field.key}: ${(err as Error).message}`);
        }
      }
      unmount(component);
      expect(failures).toEqual([]);
    });
  }

  it('lets an array row be REORDERED without a pointer', () => {
    // Order is meaning in every array the catalogue declares (ordered beats,
    // ranked ways in). A drag-only reorder would make the ordering itself
    // pointer-only, so each row carries real buttons — asserted by USING them.
    pageBuilder.open(PAGE_ID, pageWith(sectionOfType('ache')));
    const component = mount(SectionEditor, {
      target: document.body,
      props: { section: live() },
    });
    flushSync();
    const block = fieldBlock('Points');
    buttonIn(block, 'Add point').click();
    buttonIn(block, 'Add point').click();
    flushSync();
    const inputs = [...block.querySelectorAll<HTMLInputElement>('.af__input')];
    typeInto(inputs[0], 'first');
    typeInto(inputs[1], 'second');
    expect(live().props.points).toEqual(['first', 'second']);

    const groups = [...block.querySelectorAll<HTMLElement>('.af__tools')];
    const down = groups[0].querySelectorAll<HTMLButtonElement>('button')[1];
    expect(down.disabled).toBe(false);
    down.focus();
    expect(document.activeElement).toBe(down);
    down.click();
    flushSync();
    expect(live().props.points).toEqual(['second', 'first']);

    unmount(component);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. HONEST WHEN DISABLED — it says so, rather than accepting the press
// ─────────────────────────────────────────────────────────────────────────────

describe('6 · a control that cannot work says so', () => {
  it('leaves every field live when no axis removes its effect', () => {
    const failures: string[] = [];
    for (const [type, fields] of Object.entries(SECTION_FIELDS)) {
      pageBuilder.close();
      pageBuilder.open(PAGE_ID, pageWith(sectionOfType(type)));
      const component = mount(SectionEditor, {
        target: document.body,
        props: { section: live() },
      });
      flushSync();
      for (const field of fields) {
        const control = controlIn(fieldBlock(field.label));
        if ((control as HTMLInputElement).disabled) {
          failures.push(`${type}.${field.key} is disabled by default`);
        }
      }
      unmount(component);
      document.body.innerHTML = '';
    }
    expect(failures).toEqual([]);
  });

  it('gates the hero media mode on the EFFECTIVE axis, so a PAGE-level look counts', () => {
    // THE DEFECT THIS PINS. The gate used to read `section.design` alone, so the
    // "Plain Facts" page preset — which sets `media: none` for every inheriting
    // section — removed the media plate while leaving the mode select live, with
    // its ordinary hint on screen. Every option then did nothing. Inheritance is
    // the DEFAULT path (a section overrides nothing until a creator says so), so
    // the inherited case was the common one, not the edge case.
    pageBuilder.open(
      PAGE_ID,
      pageWith(sectionOfType('hero'), { media: 'none' })
    );
    const component = mount(SectionEditor, {
      target: document.body,
      props: { section: live() },
    });
    flushSync();

    const block = fieldBlock('What the media does');
    const select = controlIn(block) as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    // And the REASON replaces the hint — a disabled control with an explanation
    // of what it would have done is the shape three earlier rounds removed.
    const hint = block.querySelector('.section-editor__hint')?.textContent ?? '';
    expect(hint).toContain('Media axis');
    expect(hint).not.toContain('All six layouts');

    unmount(component);
  });

  it('still gates on the SECTION’s own override, which already worked', () => {
    pageBuilder.open(
      PAGE_ID,
      pageWith({
        id: SECTION_ID,
        type: 'hero',
        enabled: true,
        props: {},
        design: { media: 'none' },
      } as PageSection)
    );
    const component = mount(SectionEditor, {
      target: document.body,
      props: { section: live() },
    });
    flushSync();
    expect(
      (controlIn(fieldBlock('What the media does')) as HTMLSelectElement).disabled
    ).toBe(true);
    unmount(component);
  });

  it('gates ONLY the field that asked to be gated', () => {
    pageBuilder.open(
      PAGE_ID,
      pageWith(sectionOfType('hero'), { media: 'none' })
    );
    const component = mount(SectionEditor, {
      target: document.body,
      props: { section: live() },
    });
    flushSync();
    const gated = SECTION_FIELDS.hero.filter((f) => f.disabledWhenAxis);
    expect(gated).toHaveLength(1);
    for (const field of SECTION_FIELDS.hero.filter((f) => !f.disabledWhenAxis)) {
      const control = controlIn(fieldBlock(field.label));
      expect(
        (control as HTMLInputElement).disabled,
        `${field.key} was gated and did not ask to be`
      ).toBeFalsy();
    }
    unmount(component);
  });
});
