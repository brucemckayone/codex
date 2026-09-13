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

  test('the header reports its applied state, and only for its own look', () => {
    const signatureId = firstPreset?.variants[0].id ?? '';
    const { card } = render(signatureId);
    const head = card.querySelector('.presets__head');

    expect(head?.getAttribute('aria-pressed')).toBe('true');
    expect(head?.classList.contains('is-applied')).toBe(true);

    cleanup?.();
    cleanup = null;

    // A different look applied ⇒ this header is not pressed. Without this,
    // `aria-pressed={true}` hardcoded would pass the assertion above.
    const other = render(`${signatureId}--not-a-real-look`);
    const otherHead = other.card.querySelector('.presets__head');
    expect(otherHead?.getAttribute('aria-pressed')).toBe('false');
    expect(otherHead?.classList.contains('is-applied')).toBe(false);
  });

  test('no button is nested inside another, in any card', () => {
    // The a11y constraint the component note is about. Asserted across every
    // rendered card, not just the first.
    const { target } = render();
    expect(target.querySelectorAll('button button').length).toBe(0);
    expect(target.querySelectorAll('.presets__card').length).toBeGreaterThan(0);
  });
});
