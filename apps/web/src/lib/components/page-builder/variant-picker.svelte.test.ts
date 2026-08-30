/**
 * A DESCOPED composition is offered as unselectable, with its reason (Codex-wqxv4).
 *
 * WHAT WENT WRONG. `reel: strip` was declared in `section-catalog.ts`, hinted
 * "A row of clip thumbnails; one plays inline", and DESCOPED in the renderer:
 * `ReelSection.svelte`'s own `COMPOSITIONS` array excludes it and clamps anything
 * it does not know to `theatre`. Its header says so in capitals ("`strip` STAYS
 * DESCOPED per contract A27") — so the renderer knew and the picker did not.
 *
 * The clamp is why it survived: nothing crashed and nothing 500'd. A creator
 * clicked "Strip", the card took the selected state, the draft stored `strip`,
 * the save succeeded, and the published page rendered `theatre`. The builder's
 * core promise is that what an author sees while editing is what a visitor gets,
 * and for this one option it silently was not.
 *
 * `section-catalog.test.ts` owns the DATA half — it derives the expected set from
 * the eleven renderers' own `COMPOSITIONS` arrays, so a new unbuilt composition
 * fails there rather than shipping. This file owns the UI half, because a marker
 * nothing renders is the same defect one level up: the store would still be
 * writable through a card that looked ordinary.
 *
 * WHY `disabled` AND NOT HIDDEN. The composition is descoped, not retired — the
 * design exists and is blocked on an array-cardinality problem (3-5 clips against
 * a single `previewVideoMediaId`). Hiding it answers "why can't I do this?" with
 * nothing. And why the reason is rendered TEXT rather than a `title`: a tooltip
 * never appears on touch, and a disabled button is not focusable, so `title`
 * would be the one place neither a touch nor a keyboard user could reach.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { variantsForType } from '$lib/page-builder/section-catalog';
import { mount, unmount } from '$tests/utils/component-test-utils.svelte';
import VariantPicker from './VariantPicker.svelte';

let component: ReturnType<typeof mount> | undefined;

afterEach(() => {
  if (component) unmount(component);
  component = undefined;
  document.body.innerHTML = '';
});

/** Every option card, in catalogue order. */
const cards = (): HTMLButtonElement[] => [
  ...document.body.querySelectorAll<HTMLButtonElement>('.vp-opt'),
];

/** The card whose label is `label`. */
function card(label: string): HTMLButtonElement {
  const found = cards().find(
    (el) => el.querySelector('.vp-opt__label')?.textContent?.trim() === label
  );
  if (!found) throw new Error(`no option card labelled "${label}"`);
  return found;
}

const hintOf = (el: HTMLButtonElement): string =>
  el.querySelector('.vp-opt__hint')?.textContent?.trim() ?? '';

function render(
  type: string,
  selected: string,
  onselect: (id: string) => void = () => {}
): void {
  component = mount(VariantPicker, {
    target: document.body,
    props: { variants: variantsForType(type), selected, onselect },
  });
}

describe('VariantPicker — a composition that cannot be painted (Codex-wqxv4)', () => {
  it('renders every reel composition, including the descoped one', () => {
    render('reel', 'theatre');
    // Not hidden: the creator sees the design exists. Five declared, five drawn.
    expect(cards()).toHaveLength(variantsForType('reel').length);
    expect(
      cards().map((el) => el.querySelector('.vp-opt__label')?.textContent)
    ).toContain('Strip');
  });

  it('disables the descoped card and leaves the built ones alone', () => {
    render('reel', 'theatre');
    expect(card('Strip').disabled).toBe(true);
    // The negative control that makes the assertion above mean something: the
    // four BUILT compositions must stay selectable. A change that disabled the
    // whole picker would satisfy a one-sided check.
    for (const label of ['Theatre', 'Plain', 'Split', 'Waveform']) {
      expect(card(label).disabled, `${label} must stay selectable`).toBe(false);
    }
  });

  it('shows the REASON in place of the hint, as text a creator can read', () => {
    render('reel', 'theatre');
    const reason = hintOf(card('Strip'));
    // The catalogue's reason, not the composition's hint — the hint described a
    // layout the page will not render, which is the sentence that misled.
    expect(reason).toContain('Not built yet');
    expect(reason).not.toContain('A row of clip thumbnails');
    // And it is in the accessible name of the control, so it is announced with
    // the label rather than sitting somewhere only a mouse can reach.
    expect(card('Strip').textContent).toContain('Not built yet');
    // A built card still shows its own hint.
    expect(hintOf(card('Split'))).toBe('Copy beside the clip');
  });

  it('cannot write the descoped id into the draft', () => {
    // THE POINT OF THE WHOLE CHANGE. Before it, this click set the variant.
    const chosen: string[] = [];
    render('reel', 'theatre', (id: string) => {
      chosen.push(id);
    });
    card('Strip').click();
    expect(chosen).toEqual([]);
    // Negative control: a built card still calls back, so the assertion above is
    // not passing because `onselect` was never wired.
    card('Split').click();
    expect(chosen).toEqual(['split']);
  });

  it('leaves a type with no descoped composition entirely selectable', () => {
    // `hero` offers six, all built. If the marker leaked into the default path
    // every picker in the builder would go dead, which is the failure mode a
    // test on `reel` alone would not catch.
    render('hero', 'stage');
    expect(cards()).toHaveLength(6);
    for (const el of cards()) expect(el.disabled).toBe(false);
  });
});
