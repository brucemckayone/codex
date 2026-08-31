/**
 * A FIELD'S HINT IS ITS DESCRIPTION, NOT PART OF ITS NAME.
 *
 * WHAT WAS WRONG, measured live before the change. Every content field was a
 * `<label>` wrapping its own label text, its control AND its hint. A `<label>`
 * that wraps a control contributes ALL of its text to that control's ACCESSIBLE
 * NAME, so the hero's accent field announced as:
 *
 *   "Accent ending Set in italic accent at the end of the headline. Leave blank
 *    for none."
 *
 * — and `aria-describedby` was `null` on all twelve fields. The guidance was
 * therefore unskippable for a screen-reader user (it is in the name, read on every
 * focus and in every form-controls list) while being unreachable AS guidance.
 *
 * The fix moves the hint out of the label and onto `aria-describedby`, which also
 * frees it from the flow so it can be revealed on hover/focus instead of standing
 * permanently. Both halves are asserted here because either one alone regresses
 * silently: putting the hint back inside the label restores the verbose name with
 * no visual change, and hiding it with `display: none` empties the description
 * with no visual change either.
 *
 * WHY `field-inventory-sweep` DOES NOT COVER THIS. It asserts every control HAS a
 * name, resolving `label[for]` first and a wrapping label second — so both shapes
 * satisfy it. It cannot see that one of them makes the name three sentences long.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PageSection } from '@codex/shared-types';
import { afterEach, describe, expect, it } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import SectionEditor from './SectionEditor.svelte';
import { SECTION_FIELDS } from './section-fields';

let component: ReturnType<typeof mount> | undefined;

afterEach(() => {
  if (component) unmount(component);
  component = undefined;
  document.body.innerHTML = '';
});

function heroSection(design?: Record<string, string>): PageSection {
  return {
    id: 's-hero',
    type: 'hero',
    enabled: true,
    props: {},
    design,
  } as PageSection;
}

function render(design?: Record<string, string>): void {
  component = mount(SectionEditor, {
    target: document.body,
    props: { section: heroSection(design) },
  });
  flushSync();
}

/** The `.section-editor__field` whose visible label reads `text`. */
function fieldByLabel(text: string): HTMLElement {
  const label = [
    ...document.body.querySelectorAll('.section-editor__field-label'),
  ].find((el) => el.textContent?.trim() === text);
  const field = label?.closest('.section-editor__field');
  if (!field) throw new Error(`no field labelled "${text}"`);
  return field as HTMLElement;
}

const SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'SectionEditor.svelte'),
  'utf8'
);

/** The hint field on the hero that carries a real hint. */
const HINTED = 'Accent ending';
/** The hero field a design axis can gate — disabled under `media: none`. */
const GATED = 'What the media does';

describe('SectionEditor — a content field describes, it does not over-name', () => {
  it('names the control with the label ALONE, with the hint outside it', () => {
    render();
    const field = fieldByLabel(HINTED);
    const label = field.querySelector('.section-editor__field-label');
    const hint = field.querySelector('.section-editor__hint');
    const control = field.querySelector('input, textarea, select');

    expect(label?.textContent?.trim()).toBe(HINTED);
    expect(hint?.textContent).toContain('Set in italic accent');

    // THE REGRESSION THIS CATCHES: a hint nested inside the label is a hint
    // folded into the accessible name. It must be a sibling, not a descendant.
    expect(label?.contains(hint as Node)).toBe(false);
    // And the label must be a real label pointing AT the control, since it no
    // longer wraps it.
    expect(label?.tagName).toBe('LABEL');
    expect(label?.getAttribute('for')).toBe(control?.getAttribute('id'));
    expect(control?.getAttribute('id')).toBeTruthy();
  });

  it('reaches the hint through aria-describedby instead', () => {
    render();
    const field = fieldByLabel(HINTED);
    const control = field.querySelector('input, textarea, select');
    const id = control?.getAttribute('aria-describedby');
    expect(id).toBeTruthy();
    const described = document.getElementById(id as string);
    expect(described?.textContent).toContain('Set in italic accent');
  });

  it('leaves a field with NO hint undescribed rather than pointing at nothing', () => {
    // The negative control. A blanket `aria-describedby` would dangle on the
    // fields the catalogue gives no hint, and a dangling reference is announced
    // as nothing while looking correct in the markup.
    render();
    const field = fieldByLabel('Headline');
    const control = field.querySelector('input, textarea, select');
    expect(control?.getAttribute('aria-describedby')).toBeNull();
    expect(field.dataset.hint).toBe('none');
  });

  it('PINS a gated field’s reason in flow, because a disabled control cannot be focused', () => {
    // `media: none` disables the media-mode control and replaces its hint with the
    // reason. A disabled control is not focusable and touch has no hover, so a
    // reveal-on-focus reason would be the one thing neither a keyboard nor a touch
    // user could reach — the same trap `variant-picker.svelte.test.ts` documents
    // for the descoped composition card.
    render({ media: 'none' });
    const field = fieldByLabel(GATED);
    expect(field.querySelector('select')?.disabled).toBe(true);
    expect(field.dataset.hint).toBe('pinned');
    expect(field.querySelector('.section-editor__hint')?.textContent).toContain(
      'Media axis'
    );

    // Negative control: the same field is REVEAL when the axis allows a plate, so
    // `pinned` above is a response to the gate and not the default for every field.
    unmount(component!);
    component = undefined;
    document.body.innerHTML = '';
    render({ media: 'bleed' });
    expect(fieldByLabel(GATED).dataset.hint).toBe('reveal');
  });

  it('keeps the un-ported toggle branch unreachable, or fails and says so', () => {
    /*
     * THE COMMENT ABOVE THAT BRANCH, MADE ENFORCEABLE.
     *
     * `SectionEditor`'s `toggle` branch still wraps its control AND its hint in one
     * `<label>` — exactly the verbose-accessible-name defect the rest of this file
     * prevents. It was NOT ported because nothing renders it: the catalogue's only
     * `control: 'toggle'` is `invite.offers[].best`, nested in `itemFields` and
     * therefore drawn by `ArrayField`. Porting a branch I could not render would
     * have been an unverifiable change.
     *
     * A prose "port this first" note would not survive, because nothing forces
     * anyone to read it. This does: it fails on the commit that makes the branch
     * reachable, which is exactly when the port is needed.
     */
    const topLevelToggles = Object.entries(SECTION_FIELDS).flatMap(
      ([type, defs]) =>
        defs
          .filter((d) => d.control === 'toggle')
          .map((d) => `${type}.${d.key}`)
    );
    expect(
      topLevelToggles,
      "a TOP-LEVEL toggle is now declared, so SectionEditor's toggle branch renders \u2014 port it to the `label[for]` + `aria-describedby` shape the text/select branch uses (its hint currently sits inside the wrapping label, which folds it into the checkbox's accessible name), then delete this guard"
    ).toEqual([]);
  });

  it('hides the revealed hint with opacity, and ONLY inside a reveal field', () => {
    // Two failures in one assertion, both invisible on screen:
    //  · `display: none` / `visibility: hidden` drop the node from the
    //    accessibility tree, emptying the `aria-describedby` above;
    //  · an UNSCOPED `.section-editor__hint` hide rule would also silence the
    //    DESIGN group's one-line inheritance note and — worse — the media
    //    library's `role="status"` / `role="alert"` read-out, which is how a
    //    failed media load becomes indistinguishable from an empty library.
    const at = SOURCE.indexOf(
      ".section-editor__field[data-hint='reveal'] > .section-editor__hint {"
    );
    expect(
      at,
      'the reveal rule must be scoped by data-hint AND direct child'
    ).toBeGreaterThan(-1);
    const rule = SOURCE.slice(at, SOURCE.indexOf('}', at));
    expect(rule).toContain('opacity: 0');
    expect(rule).not.toContain('display: none');
    expect(rule).not.toContain('visibility: hidden');

    // Reveal on focus as well as hover: hover alone is unreachable by keyboard.
    expect(SOURCE).toContain(
      ".section-editor__field[data-hint='reveal']:focus-within > .section-editor__hint"
    );
  });
});
