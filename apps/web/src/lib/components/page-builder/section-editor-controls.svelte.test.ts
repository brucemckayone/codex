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
    const allDeclared = [
      ...new Set(
        Object.values(SECTION_FIELDS).flatMap((fields) =>
          fields.map((f) => f.control)
        )
      ),
    ].sort();
    const accountedFor = [...BUILT, ...UNBUILT].sort();
    const unaccounted = allDeclared.filter((c) => !accountedFor.includes(c));
    expect(unaccounted).toEqual([]);
  });
});
