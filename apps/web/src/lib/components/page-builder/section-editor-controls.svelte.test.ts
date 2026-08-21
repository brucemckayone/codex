/**
 * `SectionEditor` renders only the control kinds it can actually author
 * (A29 / A72 · `Codex-28ifd`).
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
 * WHEN THE GENERIC ARRAY CONTROL LANDS these tests fail, and that is the point:
 * come here, move the kind out of `UNBUILT_CONTROLS`, and assert the new control
 * renders instead. Do not delete the file — the last assertion is what stops a
 * ninth control kind silently inheriting the text input.
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

/** The kinds F-C declared and consolidation has not built. */
const UNBUILT = ['number', 'toggle', 'list', 'repeater'] as const;
/** The kinds the dispatch has a real branch for. */
const BUILT = ['text', 'textarea', 'select', 'media'] as const;

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
        .filter((f) => (UNBUILT as readonly string[]).includes(f.control))
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

  it('renders NO input for a declared-but-unbuilt control kind', () => {
    // `guide.facts` is declared `repeater` with `itemFields: [{label},{detail}]`,
    // and its label is "Credentials". Before the fix this rendered a writable
    // text input; a creator's typing persisted as a bare string and was discarded
    // at read.
    const component = mount(SectionEditor, {
      target: document.body,
      props: { section: guideSection },
    });
    flushSync();

    const labels = [
      ...document.body.querySelectorAll('.section-editor__field-label'),
    ].map((el) => el.textContent?.trim());
    expect(labels).not.toContain('Credentials');

    unmount(component);
  });

  it('renders every BUILT field for the same section', () => {
    // The counterpart assertion: skipping the unbuilt kinds must not skip
    // anything else. `guide` declares role/heading/body/quote (text+textarea),
    // three media pickers, plus clip and duration.
    const component = mount(SectionEditor, {
      target: document.body,
      props: { section: guideSection },
    });
    flushSync();

    const rendered = document.body.querySelectorAll(
      '.section-editor__field'
    ).length;
    const expected = fieldsForSectionType('guide').filter((f) =>
      (BUILT as readonly string[]).includes(f.control)
    ).length;
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
