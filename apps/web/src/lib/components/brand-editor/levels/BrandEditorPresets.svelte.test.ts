/**
 * The preset card APPLIES when you click it (`BrandEditorPresets`).
 *
 * WHY THIS FILE EXISTS. This component had no tests. Its card was an
 * `<article>` containing an inert `<header>` — swatches, name, description —
 * and a row of three small variant chips that were the only interactive
 * elements in it. Clicking the obvious target, the preset itself, did nothing
 * at all, which is indistinguishable from a broken editor. Nothing in the
 * suite noticed, because nothing asserted that the card was clickable.
 *
 * WHY THE ASSERTIONS LOOK LIKE THIS. Asserting `onapply` fired is not enough:
 * that callback only drives the parent's selection highlight, and a card wired
 * to it alone would still change no brand value. The load-bearing assertion is
 * that `brandEditor.applyPreset` — the store write path — receives the
 * SIGNATURE variant specifically. `variants[0]` is documented as identical to
 * the preset's own top-level values, so the check compares the applied look's
 * axes against the preset's own declared `axes`: wire the header to
 * `variants[1]` and that comparison fails, where an id-agnostic "was called"
 * check would not.
 *
 * The `tagName` assertion looks crude and is deliberate. It is the only thing
 * that fails if the header regresses to a non-interactive element, which is
 * exactly the defect this file was written for.
 *
 * NESTING IS THE CONSTRAINT, not an incidental detail. The original component
 * note records that an ancestor `<button>` cannot legally contain the variant
 * buttons and collapses for screen readers. So the last test asserts no button
 * is ever inside another — it is what stops this being "fixed" later by
 * wrapping the whole card.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  BRAND_PRESETS,
  brandEditor,
  PRESET_CATEGORY_ORDER,
} from '$lib/brand-editor';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import BrandEditorPresets from './BrandEditorPresets.svelte';

/**
 * The first card the component renders, derived the same way the component
 * derives it — first category in `PRESET_CATEGORY_ORDER` that has presets,
 * then its first preset. Pinning a preset id here would break whenever the
 * gallery is re-authored, for no gain.
 */
const firstCategory = PRESET_CATEGORY_ORDER.find((c) =>
  BRAND_PRESETS.some((p) => p.category === c)
);
const firstPreset = BRAND_PRESETS.find((p) => p.category === firstCategory);

let cleanup: (() => void) | null = null;
let applyPreset: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Spied rather than exercised: the store's own write semantics (the
  // tokenOverrides merge, Codex-oqv3r) belong to `presets.test.ts`. What is
  // under test here is whether a click reaches it at all, and with what.
  applyPreset = vi
    .spyOn(brandEditor, 'applyPreset')
    .mockImplementation(() => {});
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  vi.restoreAllMocks();
});

function render(appliedId: string | null = null) {
  const onapply = vi.fn();
  const target = document.createElement('div');
  document.body.appendChild(target);
  const component = mount(BrandEditorPresets, {
    target,
    props: { onapply, appliedId },
  });
  flushSync();
  cleanup = () => {
    unmount(component);
    target.remove();
  };
  const card = target.querySelector('.presets__card');
  if (!card) throw new Error('no preset card rendered');
  return { onapply, target, card };
}

describe('BrandEditorPresets · the card itself applies the preset', () => {
  test('the card header is a real button, not an inert element', () => {
    const { card } = render();
    const head = card.querySelector('.presets__head');

    // THE REGRESSION GUARD. This was a `<header>`, and every assertion below
    // is unreachable while it is.
    expect(head?.tagName).toBe('BUTTON');
    expect(head?.getAttribute('type')).toBe('button');
  });

  test('clicking the card writes the SIGNATURE look to the brand store', () => {
    const { card, onapply } = render();
    const head = card.querySelector<HTMLButtonElement>('.presets__head');

    head?.click();
    flushSync();

    expect(applyPreset).toHaveBeenCalledTimes(1);

    // The applied look must be the signature — the one the swatches and name
    // on this card advertise — not merely "some variant of it".
    const applied = applyPreset.mock.calls[0]?.[0] as {
      id: string;
      axes: unknown;
    };
    expect(applied.id).toBe(firstPreset?.variants[0].id);
    expect(applied.axes).toEqual(firstPreset?.axes);

    // ...and the parent is told, so its selection highlight follows.
    expect(onapply).toHaveBeenCalledWith(
      firstPreset?.variants[0].axes,
      firstPreset?.variants[0].id
    );
  });

  test('CONTROL: the variant chips still apply their own variant', () => {
    // The pre-existing path. It worked before this change and must keep
    // working — if the header swallowed the chips' clicks, this goes red.
    const { card, onapply } = render();
    const chips = card.querySelectorAll<HTMLButtonElement>('.presets__variant');
    expect(chips.length).toBeGreaterThan(1);

    // A chip that is NOT the signature, so this cannot pass on the header's
    // behaviour by coincidence.
    chips[1]?.click();
    flushSync();

    expect(applyPreset).toHaveBeenCalledTimes(1);
    const applied = applyPreset.mock.calls[0]?.[0] as { id: string };
    expect(applied.id).toBe(firstPreset?.variants[1].id);
    expect(onapply).toHaveBeenCalledWith(
      firstPreset?.variants[1].axes,
      firstPreset?.variants[1].id
    );
  });

  test('the CARD is marked applied for any of its looks, not just the signature', () => {
    // The card answers "which brand am I on?" and the chip answers "which of
    // its looks?". Before this the state lived only on the chip, so the only
    // way to read the active preset was to scan three chips across 27 cards.
    //
    // A NON-signature look is used on purpose: if the card's state were wired
    // to `appliedId === signature.id` it would pass with variants[0] and fail
    // here, which is the bug this asserts against.
    const alternate = firstPreset?.variants[1].id ?? '';
    const { card } = render(alternate);

    expect(card.classList.contains('is-applied')).toBe(true);
    // ...while the header reports only its OWN look as pressed.
    expect(
      card.querySelector('.presets__head')?.getAttribute('aria-pressed')
    ).toBe('false');
  });

  test('a card whose looks are all unapplied is not marked', () => {
    // Anti-vacuity for the assertion above: `is-applied` hardcoded true would
    // satisfy it.
    const { card } = render('not-a-real-look-id');
    expect(card.classList.contains('is-applied')).toBe(false);
  });

  test('the header reports pressed for its own signature', () => {
    const { card } = render(firstPreset?.variants[0].id ?? '');
    expect(
      card.querySelector('.presets__head')?.getAttribute('aria-pressed')
    ).toBe('true');
    expect(card.classList.contains('is-applied')).toBe(true);
  });

  test('the palette renders one stop per colour the preset declares', () => {
    // The palette IS the product; a card that advertises a palette it does not
    // render is the defect this guards. Counted from the preset's own values
    // rather than a fixed number, since presets declare 1-4 colours.
    const { card } = render();
    const declared = [
      firstPreset?.values.primaryColor,
      firstPreset?.values.secondaryColor,
      firstPreset?.values.accentColor,
      firstPreset?.values.backgroundColor,
    ].filter(Boolean).length;

    expect(card.querySelectorAll('.presets__stop').length).toBe(declared);
    expect(card.querySelectorAll('.presets__stop--primary').length).toBe(1);
  });

  test('no selected-state surface is painted in a BRAND-derived token', () => {
    /*
     * The durable form of the contrast bug. This gallery renders inside the
     * org-brand scope it edits, so a selected state painted in
     * --color-interactive* follows whatever brand is being trialled. Measured
     * in Chrome with a probe calibrated to 21.00 on white/black: applying a
     * dark preset put --color-text on --color-interactive-subtle at 2.55:1
     * (card), 2.58:1 (variant chip) and the same pair on the filter chip,
     * against a 4.5 floor — the preset's own name vanished.
     *
     * Asserted on the RULE rather than a computed colour on purpose. A
     * computed check needs a mounted brand to reproduce, and would go green
     * for the default palette while staying broken for dark brands — which is
     * exactly how this shipped. What must hold is the invariant: these three
     * state selectors name no brand token.
     */
    // Same idiom as `journey-design.test.ts`, which string-asserts its own
    // stylesheet in this exact jsdom environment.
    const here = dirname(fileURLToPath(import.meta.url));
    const css = readFileSync(join(here, 'BrandEditorPresets.svelte'), 'utf8');
    // Strip comments first, or the explanation above trips its own gate.
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');

    const stateSelectors = [
      '.presets__card.is-applied',
      '.presets__variant.is-applied',
      '.presets__filter-chip.is-active',
    ];

    for (const selector of stateSelectors) {
      const at = bare.indexOf(selector);
      expect(at, `${selector} is not declared`).toBeGreaterThan(-1);
      const block = bare.slice(at, bare.indexOf('}', at));
      expect(block, `${selector} paints a brand-derived surface`).not.toMatch(
        /--color-interactive/
      );
      // ...and does declare a neutral, theme-inverting tint instead.
      expect(block).toMatch(/color-mix\(in oklab, var\(--color-text\)/);
    }
  });

  test('category labels sit one level below the consumer h1', () => {
    // Lighthouse `heading-order`: BrandStudioGuided renders an <h1> and no
    // <h2>, so an <h3> here skipped a level. Asserted because the right level
    // is a property of the CONSUMER's hierarchy, which this file cannot see.
    const { target } = render();
    const labels = [...target.querySelectorAll('.presets__group-label')];
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) expect(label.tagName).toBe('H2');
  });

  test('no button is nested inside another, in any card', () => {
    // The a11y constraint the component note is about. Asserted across every
    // rendered card, not just the first.
    const { target } = render();
    expect(target.querySelectorAll('button button').length).toBe(0);
    expect(target.querySelectorAll('.presets__card').length).toBeGreaterThan(0);
  });
});
