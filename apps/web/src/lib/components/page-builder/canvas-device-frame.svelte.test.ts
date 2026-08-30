/**
 * The builder canvas's DEVICE FRAME and its BLOCK ACTIONS.
 *
 * WHY THIS FILE EXISTS. Two defects on the same component, and neither was
 * observable from either side alone:
 *
 *  1. The device toggle relabelled ONE fixed column. Measured live at a 1440
 *     viewport, `of-blood-and-bones/bone-deep`: the published page's `.jp-sec`
 *     was 1376px and the canvas's was 674px while the toggle reported
 *     `aria-pressed="true"` on "Desktop". `.jp-sec` carries
 *     `container-type: inline-size`, so 8 of the 19 `@container` rules in the
 *     journey CSS resolved to the opposite branch — including
 *     `HeroSection.svelte`'s `@container (max-width: 48rem)`, which stacks
 *     `hero.split-media` into one column and lifts the media above the copy.
 *     `grid-template-columns` on `.hero__inner`, both at 1440: canvas
 *     `593.125px`, page `506.094px 457.898px`. Two of the six hero compositions
 *     an author picks from were authored as one composition and published as
 *     another.
 *  2. The block toolbar's move buttons indexed the FULL section list while the
 *     canvas draws only the renderable ones. With one hidden section between two
 *     visible ones — one click of the rail's eye toggle — the button was
 *     ENABLED, the store mutated, the page went dirty, and nothing moved.
 *
 * WHAT jsdom CAN AND CANNOT SAY HERE. It implements neither `container-type` nor
 * transforms, so it cannot measure the fix — the geometry proof is a browser
 * measurement, recorded above and repeated in the e2e spec. What it CAN pin is
 * the two things that regress in source: the device presets carrying real
 * widths, and the toolbar operating in the ordering the author can see. The
 * `ResizeObserver` is a no-op stub in this environment (`src/tests/setup.ts`), so
 * the scale resolves to 1 and every assertion below is about structure, never
 * about pixels.
 */

import type { CourseOffer, PageSection } from '@codex/shared-types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pageBuilder } from '$lib/page-builder/page-builder-store.svelte';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import JourneyBuilderCanvas from './JourneyBuilderCanvas.svelte';
import {
  JOURNEY_PREVIEW_DEVICES,
  journeyPreviewDevice,
  journeyPreviewScale,
} from './journey-preview-canvas';

// ─────────────────────────────────────────────────────────────────────────────
// The device presets + the scale
// ─────────────────────────────────────────────────────────────────────────────

describe('journey preview devices carry REAL widths', () => {
  it('declares a numeric device width for all three presets', () => {
    // The guard's own guard: an empty or partial list makes everything below
    // pass vacuously, which is the shape that let a relabelled column survive
    // four rounds of review.
    expect(JOURNEY_PREVIEW_DEVICES).toHaveLength(3);
    for (const device of JOURNEY_PREVIEW_DEVICES) {
      expect(
        Number.isFinite(device.width) && device.width > 0,
        `${device.id} has no real width`
      ).toBe(true);
      // The label must state the number, not a mood: "Fluid" was the old
      // desktop label, and it was true of the column and false of the device.
      expect(device.widthLabel).toBe(`${device.width}px`);
    }
  });

  it('gives desktop a width no `@container` breakpoint can flip', () => {
    // 864px (54rem) is the largest breakpoint in the section CSS; the assertion
    // that matters is in `canvas-public-parity`, which derives the number from
    // the stylesheets rather than trusting this one.
    expect(journeyPreviewDevice('desktop').width).toBeGreaterThan(864);
  });

  it('pins tablet and mobile heights, and leaves desktop on the live viewport', () => {
    // `svh` cannot be re-pointed, so a phone's ASPECT is only previewable
    // against a pinned height (see `--jp-stage-vh` in `journey-design.css`).
    // Desktop is `null` deliberately: there the studio window IS a desktop
    // viewport, and pinning 900px would misreport a tall or short monitor.
    expect(journeyPreviewDevice('desktop').height).toBeNull();
    expect(journeyPreviewDevice('tablet').height).toBe(1112);
    expect(journeyPreviewDevice('mobile').height).toBe(844);
  });

  it('falls back to desktop rather than to undefined for an unknown id', () => {
    expect(
      journeyPreviewDevice('nope' as 'desktop').id,
      'an unknown device id must not resolve to undefined — the canvas reads .width off it'
    ).toBe('desktop');
  });
});

describe('journeyPreviewScale', () => {
  it('fits the device width into the column', () => {
    expect(journeyPreviewScale(676, 1440)).toBeCloseTo(0.4694, 4);
    expect(journeyPreviewScale(676, 834)).toBeCloseTo(0.8106, 4);
  });

  it('NEVER magnifies — a wide monitor is not a licence to blow the page up', () => {
    // The other lie available here: an author on a 2560px display editing a
    // 1440 design at 178%.
    expect(journeyPreviewScale(2000, 1440)).toBe(1);
    expect(journeyPreviewScale(390, 390)).toBe(1);
  });

  it('returns 1 before the column has been measured', () => {
    // A `ResizeObserver`'s first callback lands after layout, so one frame
    // renders with no measurement. 1 is the only value that cannot divide by
    // zero or collapse the frame to nothing.
    expect(journeyPreviewScale(0, 1440)).toBe(1);
    expect(journeyPreviewScale(-1, 1440)).toBe(1);
    expect(journeyPreviewScale(676, 0)).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The block toolbar, over a page with a HIDDEN section in the middle
// ─────────────────────────────────────────────────────────────────────────────

/** hero · ache (HIDDEN) · invite — the state that made the arrows inert. */
const withHiddenMiddle = (): PageSection[] =>
  [
    { id: 's-hero', type: 'hero', enabled: true, props: {} },
    { id: 's-ache', type: 'ache', enabled: false, props: {} },
    { id: 's-invite', type: 'invite', enabled: true, props: {} },
  ] as PageSection[];

const OFFER: CourseOffer = {
  courseId: 'c1',
  organizationId: 'o1',
  paths: ['purchase'],
  purchase: { priceCents: 2700 },
  // Both required on CourseOffer and both meaningfully NULL/EMPTY here: this
  // fixture is a ONE-OFF-only offer, which is the shape that exercises a single
  // priced path. `subscription: null` + `tiers: []` is what the service returns
  // for a course with no plan and no tier grant — the state 5 of the 7 seeded
  // courses are in.
  subscription: null,
  tiers: [],
  entitled: false,
};

function openStore(sections: PageSection[]): void {
  // A distinct page id per test, because `open()` restores a same-id draft from
  // sessionStorage and would otherwise hand one test the previous test's edits.
  pageBuilder.open(`p-${Math.random().toString(36).slice(2)}`, {
    pageType: 'course',
    slug: 'demo',
    title: 'Demo',
    status: 'draft',
    subjectType: 'course',
    subjectId: null,
    brandOverrides: null,
    sections,
  });
}

/** The blocks the canvas actually DREW, in DOM order, by section id. */
const renderedOrder = (): string[] =>
  [...document.body.querySelectorAll('.jbc-block')].map(
    (el) => el.getAttribute('data-sec') ?? ''
  );

const btn = (label: string): HTMLButtonElement | null =>
  document.body.querySelector(`.jbc-block__btn[aria-label="${label}"]`);

let component: ReturnType<typeof mount> | null = null;

function mountCanvas(props: Record<string, unknown> = {}): void {
  component = mount(JourneyBuilderCanvas, {
    target: document.body,
    props: {
      course: { id: 'c1', slug: 'demo', title: 'Demo' },
      checkoutUrl: '/journeys/demo/checkout',
      dashboardUrl: '/journeys/demo/dashboard',
      ...props,
    },
  });
  flushSync();
}

beforeEach(() => {
  try {
    sessionStorage.clear();
  } catch {
    // A storage-less environment is fine; `open()` falls through to a clean clone.
  }
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  pageBuilder.close();
  document.body.innerHTML = '';
});

describe('the block toolbar moves in the VISIBLE ordering', () => {
  it('reorders the rendered blocks when a hidden section sits between them', () => {
    openStore(withHiddenMiddle());
    pageBuilder.selectSection('s-hero');
    mountCanvas();

    expect(renderedOrder()).toEqual(['s-hero', 's-invite']);

    const down = btn('Move hero down');
    expect(
      down,
      'no accessible Move-down button on the selected block'
    ).not.toBeNull();
    expect(
      down?.disabled,
      'Move down is disabled on the FIRST visible block'
    ).toBe(false);

    down?.click();
    flushSync();

    // THE ASSERTION THAT FAILS ON THE OLD CODE. `moveSection(id, +1)` swapped
    // `hero` with the hidden `ache`, so the stored list changed, the page went
    // dirty, and this order came back unchanged.
    expect(
      renderedOrder(),
      'the canvas order did not change — the move swapped with a section that is not drawn'
    ).toEqual(['s-invite', 's-hero']);
    // And the hidden section is still there: a move must not drop it.
    expect(pageBuilder.sections.map((s) => s.id)).toHaveLength(3);
    expect(pageBuilder.sections.some((s) => s.id === 's-ache')).toBe(true);
  });

  it('disables the arrows at the VISIBLE ends, not the stored ones', () => {
    // `invite` is the last stored section AND the last visible one, so it alone
    // cannot distinguish the two rules. `hero` can: it is the first of both, but
    // after the hidden `ache` is moved above it, it is the first VISIBLE section
    // while no longer the first stored one.
    openStore([
      { id: 's-ache', type: 'ache', enabled: false, props: {} },
      { id: 's-hero', type: 'hero', enabled: true, props: {} },
      { id: 's-invite', type: 'invite', enabled: true, props: {} },
    ] as PageSection[]);
    pageBuilder.selectSection('s-hero');
    mountCanvas();

    expect(renderedOrder()).toEqual(['s-hero', 's-invite']);
    expect(
      btn('Move hero up')?.disabled,
      'Move up is ENABLED on the first VISIBLE block — one click and nothing moves'
    ).toBe(true);
    expect(btn('Move hero down')?.disabled).toBe(false);
  });

  it('names every one of the five actions, and names its target', () => {
    // They were named ONLY by `title`, which never appears on touch and is not
    // reachable by keyboard — and a destructive Delete sits immediately beside
    // Duplicate.
    openStore(withHiddenMiddle());
    pageBuilder.selectSection('s-hero');
    mountCanvas();

    const names = [
      ...document.body.querySelectorAll('.jbc-block--selected .jbc-block__btn'),
    ].map((el) => el.getAttribute('aria-label'));
    // Phrased exactly as the rail phrases its row controls
    // (`SectionList.svelte:122` — `Move {label} up`): the same five verbs on the
    // same sections, so the two panes must not name one control two ways. The
    // article the first pass used also read badly against real data — the seeded
    // sections are named "The ache" and "The map", which announced as
    // "Move the The ache section up".
    expect(names).toEqual([
      'Move hero up',
      'Move hero down',
      'Duplicate hero',
      'Add a section after hero',
      'Delete hero',
    ]);
    expect(
      document.body
        .querySelector('.jbc-block--selected .jbc-block__bar')
        ?.getAttribute('aria-label')
    ).toBe('hero actions');
  });

  it('leaves Delete undoable, which is why it does not confirm', () => {
    openStore(withHiddenMiddle());
    pageBuilder.selectSection('s-hero');
    mountCanvas();

    expect(pageBuilder.canUndo, 'a freshly opened page has no history').toBe(
      false
    );
    btn('Delete hero')?.click();
    flushSync();

    expect(renderedOrder()).toEqual(['s-invite']);
    expect(
      pageBuilder.canUndo,
      'Delete pushed no undo step — then it needs a confirm dialog after all'
    ).toBe(true);
    pageBuilder.undo();
    flushSync();
    expect(renderedOrder()).toEqual(['s-hero', 's-invite']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The page's own links, inside an EDITOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dispatch a real bubbling click and report whether anything cancelled it.
 * `dispatchEvent` returns false iff a listener called `preventDefault`.
 */
function clickAndReport(el: Element): boolean {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  const notPrevented = el.dispatchEvent(event);
  return !notPrevented;
}

describe('canvas CTAs do not navigate while editing (Codex-4wun2 follow-on)', () => {
  it('cancels a click on a live CTA and selects that block instead', () => {
    // The cost of the fidelity win: with a real offer and a real checkoutUrl the
    // canvas's CTAs are LIVE links, so clicking a price card to edit its copy
    // navigated the author out of the builder with unsaved work.
    openStore(withHiddenMiddle());
    pageBuilder.selectSection('s-hero');
    mountCanvas({ offer: OFFER });

    const anchors = [
      ...document.body.querySelectorAll('.jbc-page a[href]'),
    ] as HTMLAnchorElement[];
    expect(
      anchors.length,
      'no live anchor rendered — this case would pass for the wrong reason'
    ).toBeGreaterThan(0);

    const inviteAnchor = anchors.find(
      (a) => a.closest('[data-sec]')?.getAttribute('data-sec') === 's-invite'
    );
    expect(inviteAnchor, 'the invite section drew no CTA').toBeDefined();
    expect(inviteAnchor?.getAttribute('href')).toContain(
      '/journeys/demo/checkout'
    );

    expect(inviteAnchor && clickAndReport(inviteAnchor)).toBe(true);
    flushSync();
    expect(pageBuilder.selectedSectionId).toBe('s-invite');
  });

  it('LEAVES PREVIEW MODE ALONE — there the author asked to see the page behave', () => {
    // The other direction, and the one an over-eager fix breaks: `editable`
    // false is Preview mode, where the links are the page.
    //
    // jsdom prints "Not implemented: navigation to another Document" while this
    // case runs. That line is the assertion's own fingerprint — it is jsdom
    // reporting that the anchor's DEFAULT ACTION ran. Do not silence it by
    // neutering the href; a dead href would make this case pass for the wrong
    // reason, which is exactly how the canvas's dead `'#'` CTAs hid Codex-4wun2.
    openStore(withHiddenMiddle());
    mountCanvas({ offer: OFFER, editable: false });

    const anchor = document.body.querySelector('.jbc-page a[href]');
    expect(anchor, 'preview mode rendered no CTA to test').not.toBeNull();
    expect(
      anchor && clickAndReport(anchor),
      'preview mode cancelled the page’s own link'
    ).toBe(false);
  });
});

describe('a block is reachable from the keyboard', () => {
  it('focuses and activates with Enter, and names itself', () => {
    // There was no keyboard path at all: selection was `onmousedown` on a plain
    // `<div>`, so the block toolbar could only be reached after selecting from
    // the rail.
    openStore(withHiddenMiddle());
    pageBuilder.selectSection('s-hero');
    mountCanvas();

    const invite = document.body.querySelector(
      '.jbc-block[data-sec="s-invite"]'
    ) as HTMLElement;
    expect(invite.getAttribute('tabindex')).toBe('0');
    expect(invite.getAttribute('role')).toBe('group');
    // The fixture sections carry no `name`, so the label falls back to the
    // TYPE — which is the point: the name must always resolve to something a
    // screen reader can distinguish, never to "section".
    expect(invite.getAttribute('aria-label')).toBe('invite section');

    invite.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      })
    );
    flushSync();
    expect(pageBuilder.selectedSectionId).toBe('s-invite');
  });

  it('does not swallow a Space press that belongs to the copy being typed', () => {
    openStore(withHiddenMiddle());
    pageBuilder.selectSection('s-hero');
    mountCanvas();

    const field = document.body.querySelector(
      '.jbc-page [contenteditable="true"]'
    ) as HTMLElement;
    expect(field, 'no editable field rendered').not.toBeNull();
    const event = new KeyboardEvent('keydown', {
      key: ' ',
      bubbles: true,
      cancelable: true,
    });
    field.dispatchEvent(event);
    expect(
      event.defaultPrevented,
      'Space inside a contenteditable was captured as block selection — every space bar press would be eaten'
    ).toBe(false);
  });

  it('gives no tabindex and no name in preview mode', () => {
    openStore(withHiddenMiddle());
    mountCanvas({ editable: false });
    const block = document.body.querySelector('.jbc-block');
    expect(block?.getAttribute('tabindex')).toBeNull();
    expect(block?.getAttribute('aria-label')).toBeNull();
  });
});
