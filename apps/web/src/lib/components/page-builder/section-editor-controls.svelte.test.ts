/**
 * `SectionEditor` renders a REAL control for every kind it declares
 * (A29 / A72 · `Codex-28ifd`, now closed).
 *
 * WHAT WENT WRONG, and why this file is behavioural rather than a source grep.
 * `section-fields.ts` declares eight control kinds and states the intent plainly:
 * "these fields are inert in the rail: `SectionEditor` renders the controls it
 * knows and skips the rest." It did not skip them. The dispatch branches `media`,
 * `textarea` and `select`, then falls through a catch-all `{:else}` to
 * `<input type="text">`, and `onInput` writes `target.value` — a STRING — into keys
 * that must hold an array or a number.
 *
 * A creator saw a field labelled "Credentials", hinted as "the hairline-ruled fact
 * list — years practising, students taught, qualifications", typed into it, saved,
 * and got nothing: `coerce.ts`'s `asObjectArray` discards a non-array at its first
 * line, without a warning. Proved end to end on a published page, where
 * `props.facts` persisted with `jsonb_typeof = string`.
 *
 * A source grep would not have caught it, because the catch-all is correct CSS-in-
 * Svelte and correct TypeScript — the bug is which BRANCH a declared kind lands in.
 * So these assertions mount the real component and look at the real DOM.
 *
 * THE ARRAY CONTROL HAS NOW LANDED, and this file did what its own note asked:
 * the four kinds moved out of the unbuilt set and the assertions were inverted to
 * require the control rather than forbid it. `UNBUILT` is deliberately kept as an
 * empty tuple rather than deleted — it is the seam a future declared-but-unbuilt
 * kind goes through, and the last assertion reads it.
 *
 * That last assertion is the one that outlives the rest: a ninth kind added to
 * `SectionFieldControl` with no branch in the dispatch would inherit the catch-all
 * text input and start corrupting whatever shape it names — exactly how the first
 * four got here. It must keep failing loudly.
 */

import type { PageSection } from '@codex/shared-types';
import { afterEach, describe, expect, it } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import SectionEditor from './SectionEditor.svelte';
import { fieldsForSectionType, SECTION_FIELDS } from './section-fields';

/**
 * Declared-but-unbuilt kinds. EMPTY, and that is the current truth — every kind
 * the catalogue declares now has a branch. Kept as the seam: a new kind lands
 * here first, and the coverage assertion below reads it.
 */
const UNBUILT = [] as const;
/** The kinds the dispatch has a real branch for. */
const BUILT = [
  'text',
  'textarea',
  'select',
  'media',
  'number',
  'toggle',
  'list',
  'repeater',
] as const;

const guideSection: PageSection = {
  id: 's-guide',
  type: 'guide',
  enabled: true,
  props: {},
} as PageSection;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('SectionEditor — only authorable control kinds reach the DOM', () => {
  it('still DECLARES the unbuilt fields — the skip must not hide a lost field set', () => {
    // If a future change drops these declarations instead of skipping their
    // controls, the renderer stops reading them and the compositions that depend
    // on them lose their data path silently. The declaration is the contract; the
    // control is the UI. Assert the contract survives.
    const declared = Object.entries(SECTION_FIELDS).flatMap(([type, fields]) =>
      fields
        .filter((f) =>
          ['list', 'repeater', 'number', 'toggle'].includes(f.control)
        )
        .map((f) => `${type}.${f.key}`)
    );
    // The six A72 names, plus any new one someone adds — the point is that the
    // set is non-empty and that its membership is visible here.
    expect(declared).toEqual([
      'ache.points',
      'turn.points',
      'feel.inclusions',
      'feel.previewDuration',
      'guide.facts',
      'invite.offers',
    ]);
  });

  it('renders the ARRAY control for a repeater field, not a bare text input', () => {
    // `guide.facts` is declared `repeater` with `itemFields: [{label},{detail}]`,
    // and its label is "Credentials". It rendered a writable text input once — a
    // creator's typing persisted as a bare string and was discarded at read — and
    // then rendered nothing at all. It must now render the real control.
    const component = mount(SectionEditor, {
      target: document.body,
      props: { section: guideSection },
    });
    flushSync();

    const labels = [
      ...document.body.querySelectorAll('.section-editor__field-label'),
    ].map((el) => el.textContent?.trim());
    expect(labels).toContain('Credentials');

    // And it is the array control, not the catch-all: an add affordance named
    // after the field's own `itemLabel`. Asserting the AFFORDANCE rather than a
    // class name is what distinguishes "the right control" from "any control" —
    // a text input would satisfy the label assertion above on its own.
    const addButtons = [...document.body.querySelectorAll('button')]
      .map((b) => b.textContent?.trim())
      .filter((t): t is string => !!t);
    expect(addButtons.some((t) => t.includes('credential'))).toBe(true);

    unmount(component);
  });

  it('renders EVERY declared field for the section — nothing is filtered out', () => {
    // The counterpart assertion. It used to allow for the skipped kinds; now it
    // requires their absence to be impossible, because the component no longer
    // filters at all.
    const component = mount(SectionEditor, {
      target: document.body,
      props: { section: guideSection },
    });
    flushSync();

    const rendered = document.body.querySelectorAll(
      '.section-editor__field'
    ).length;
    // EVERY declared field, with no filter — the whole point of closing the bead.
    const expected = fieldsForSectionType('guide').length;
    expect(rendered).toBe(expected);
    expect(expected).toBeGreaterThan(0);

    unmount(component);
  });

  it('accounts for EVERY declared control kind as either built or unbuilt', () => {
    // The assertion that outlives the others. A ninth kind added to
    // `SectionFieldControl` with no branch in the dispatch would inherit the
    // catch-all text input and start corrupting whatever shape it names — exactly
    // how the first four got here. This makes that addition fail loudly.
    //
    // IT DESCENDS INTO `itemFields` NOW, and that is the whole point of the
    // amendment: collecting with `fields.map((f) => f.control)` saw TOP-LEVEL
    // fields only, so the three kinds a repeater's ENTRY declares
    // (`invite.offers[].id` select, `.bullets` list, `.best` toggle) were never
    // in the declared set. They passed anyway, because all three ARE built at the
    // top level — the set was satisfied by a different dispatch than the one
    // rendering them.
    const allDeclared = [
      ...new Set(
        Object.values(SECTION_FIELDS).flatMap((fields) =>
          fields.flatMap((f) => [
            f.control,
            ...(f.itemFields ?? []).map((sub) => sub.control),
          ])
        )
      ),
    ].sort();
    const accountedFor = [...BUILT, ...UNBUILT].sort();
    const unaccounted = allDeclared.filter((c) => !accountedFor.includes(c));
    expect(unaccounted).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE SAME GUARD ONE NESTING LEVEL DOWN (`ArrayField`'s ENTRY dispatch).
//
// Descending into `itemFields` for the declared SET above is necessary and not
// sufficient: `select`, `list` and `toggle` are all built at the top level, so
// membership alone can never fail. The bug this section exists for is that
// `ArrayField` dispatched a repeater's entry fields on `textarea` ALONE and fell
// through to `<input type="text">` for everything else — `Codex-28ifd`'s exact
// defect, reintroduced one level down, on `invite.offers`: the editor for the
// copy at the page's primary conversion moment.
//
// Each of the three was traced to its READER, and each corrupts silently:
//   · `id`      free text, so the three legal path ids were never shown, and
//               `offer-paths.ts` drops an entry naming no real path.
//   · `bullets` a STRING into a key read by `fieldStringArray`, which returns
//               `[]` for a non-array — every bullet typed was discarded.
//   · `best`    a STRING into a key read by `fieldBool` (`=== true`), so no
//               value a creator could type ever flagged a way in as recommended.
//
// So the guard has to be BEHAVIOURAL, for the same reason the file's header
// gives: the catch-all is valid TypeScript and valid Svelte, and the bug is
// which BRANCH a declared kind lands in. It asserts the ELEMENT KIND each
// declared entry field reaches the DOM as, for every repeater in the catalogue.
// ─────────────────────────────────────────────────────────────────────────────

/** Every `(sectionType, repeaterField)` pair the catalogue declares. */
const REPEATERS = Object.entries(SECTION_FIELDS).flatMap(([type, fields]) =>
  fields
    .filter((f) => f.control === 'repeater' && (f.itemFields?.length ?? 0) > 0)
    .map((field) => ({ type, field }))
);

/** One row, so the entry cells exist — an empty repeater renders no cells. */
function sectionWithOneRow(type: string, key: string): PageSection {
  return {
    id: `s-${type}`,
    type,
    enabled: true,
    props: { [key]: [{}] },
  } as PageSection;
}

/** The `.af__cell` whose own label is `text`. */
function cellByLabel(text: string): HTMLElement | null {
  return (
    [...document.body.querySelectorAll<HTMLElement>('.af__cell')].find(
      (cell) =>
        cell.querySelector('.af__cell-label')?.textContent?.trim() === text
    ) ?? null
  );
}

describe('ArrayField — a repeater ENTRY field renders the control it declares', () => {
  it('declares at least one entry field of every array-shaped kind', () => {
    // Guards the guard: if the catalogue stopped declaring a nested `select`,
    // `list` or `toggle`, the assertions below would pass by vacuity rather than
    // by correctness. Naming the kinds here makes that visible.
    const nested = [
      ...new Set(
        REPEATERS.flatMap(({ field }) =>
          (field.itemFields ?? []).map((sub) => sub.control)
        )
      ),
    ].sort();
    expect(nested).toContain('select');
    expect(nested).toContain('list');
    expect(nested).toContain('toggle');
  });

  for (const { type, field } of REPEATERS) {
    for (const sub of field.itemFields ?? []) {
      it(`${type}.${field.key}[].${sub.key} (${sub.control}) is not a text box by default`, () => {
        const component = mount(SectionEditor, {
          target: document.body,
          props: { section: sectionWithOneRow(type, field.key) },
        });
        flushSync();

        const cell = cellByLabel(sub.label);
        expect(cell, `no cell labelled "${sub.label}"`).not.toBeNull();

        switch (sub.control) {
          case 'select': {
            const select = cell?.querySelector('select');
            expect(select, 'a select control').not.toBeNull();
            // Every declared option is offered — a free-text box could never
            // show them, which is how an entry naming no real path got authored.
            const offered = [...(select?.options ?? [])].map((o) => o.value);
            for (const opt of sub.options ?? []) {
              expect(offered).toContain(opt.value);
            }
            break;
          }
          case 'toggle':
            // A checkbox, because `fieldBool` tests `=== true`. A text input
            // here can only ever write the STRING "true".
            expect(
              cell?.querySelector('input[type="checkbox"]'),
              'a checkbox'
            ).not.toBeNull();
            break;
          case 'list': {
            // The nested array control, named by the sub-field's own itemLabel
            // ("Add bullet"). A single text input here writes a bare string into
            // a key `fieldStringArray` reads as `[]`.
            const noun = sub.itemLabel ?? 'item';
            const adds = [...(cell?.querySelectorAll('button') ?? [])]
              .map((b) => b.textContent?.trim() ?? '')
              .filter((t) => t.length > 0);
            expect(
              adds.some((t) => t.includes(noun)),
              `an add-${noun} affordance`
            ).toBe(true);
            break;
          }
          case 'textarea':
            expect(cell?.querySelector('textarea')).not.toBeNull();
            break;
          default:
            expect(
              cell?.querySelector('input[type="text"]'),
              'a text input'
            ).not.toBeNull();
            break;
        }

        unmount(component);
      });
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// THE AXIS GATE (`disabledWhenAxis` · `Codex-uj4jc`)
//
// The hero's `mediaMode` chooses WHICH asset appears; the `media` axis decides
// HOW it is shaped, and `media: none` means "no plate at all" — so the axis
// necessarily wins. Both alternatives were worse than saying so. Silently
// ignoring the mode leaves an author picking "silent looping video", seeing
// nothing, and having no way to find out why. Auto-lifting the axis mutates a
// DESIGN decision as a side effect of a CONTENT choice, which is exactly the
// conflation this field set exists to keep apart.
//
// `HeroSection.svelte.test.ts` asserts the renderer's half (the axis overrules
// the mode). This asserts the builder's half: the control is visibly unavailable
// and the reason is on screen. Both halves are needed — a disabled control with
// a renderer that ignored the axis would be a lie in the other direction.
// ─────────────────────────────────────────────────────────────────────────────

/** The `<label>` wrapping a field, found by its visible label text. */
function fieldByLabel(text: string): HTMLElement | null {
  const span = [
    ...document.body.querySelectorAll('.section-editor__field-label'),
  ].find((s) => s.textContent?.trim() === text);
  return (span?.closest('.section-editor__field') as HTMLElement) ?? null;
}

function heroSection(design?: Record<string, string>): PageSection {
  return {
    id: 's-hero',
    type: 'hero',
    enabled: true,
    props: {},
    design,
  } as PageSection;
}

describe('SectionEditor — a design axis can gate a content control', () => {
  it('leaves the media mode authorable while the axis allows a plate', () => {
    const component = mount(SectionEditor, {
      target: document.body,
      props: { section: heroSection({ media: 'bleed' }) },
    });
    flushSync();

    const field = fieldByLabel('What the media does');
    expect(field).not.toBeNull();
    const select = field?.querySelector('select');
    expect(select).not.toBeNull();
    expect(select?.disabled).toBe(false);

    unmount(component);
  });

  it('disables it under `media: none` and shows the reason instead of the hint', () => {
    const component = mount(SectionEditor, {
      target: document.body,
      props: { section: heroSection({ media: 'none' }) },
    });
    flushSync();

    const field = fieldByLabel('What the media does');
    expect(field?.querySelector('select')?.disabled).toBe(true);

    // The reason REPLACES the hint — a hint about what a control does is noise
    // while the control cannot do it.
    const hint =
      field?.querySelector('.section-editor__hint')?.textContent ?? '';
    expect(hint).toContain('Media axis');
    expect(hint).not.toContain('All six layouts');

    unmount(component);
  });

  it('gates only the field that asked to be gated', () => {
    // The mechanism is declarative and per-field. If it ever starts keying off
    // something broader than `disabledWhenAxis`, a hero under `media: none` would
    // go read-only wholesale — which would be a far worse bug than the one the
    // gate fixes, and silent.
    const component = mount(SectionEditor, {
      target: document.body,
      props: { section: heroSection({ media: 'none' }) },
    });
    flushSync();

    const gated = SECTION_FIELDS.hero.filter((f) => f.disabledWhenAxis).length;
    expect(gated).toBe(1);

    const disabled = [
      ...document.body.querySelectorAll<HTMLInputElement>(
        'input, select, textarea'
      ),
    ].filter((el) => el.disabled).length;
    expect(disabled).toBe(gated);

    unmount(component);
  });
});
