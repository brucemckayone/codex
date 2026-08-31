/**
 * THE PAGE-LEVEL PANEL SWEEP — every control on all five page-mode panels.
 *
 * `field-inventory-sweep.svelte.test.ts` walks the 98 PER-SECTION fields.
 * The page-mode panels are the other half of the builder's inputs and had never
 * been enumerated as a set: Look, Pricing, Media, Brand & theme, SEO & web
 * address — 34 controls between them. Three of the five have a behavioural test
 * of their WRITES (`page-seo-panel`, `page-brand-panel`, `builder-chrome-i18n`
 * for their copy); none had a sweep of whether each control is NAMED and
 * KEYBOARD-REACHABLE, which is what this file is.
 *
 * ── WHAT IT FOUND ────────────────────────────────────────────────────────────
 * THREE FOCUSABLE, UNNAMED FILE INPUTS on the Media panel. The cover, hero-still
 * and signature upload frames each render
 *
 *     <input class="cover__file" {...form.fields.x.as('file')} …>
 *
 * styled with the sr-only recipe (`position:absolute; width:1px; clip-path:
 * inset(50%)`), which HIDES IT VISUALLY AND LEAVES IT IN THE TAB ORDER AND IN THE
 * ACCESSIBILITY TREE. So a keyboard user tabbing the Media panel hit three file
 * inputs with no accessible name whatsoever — announced as "file upload button",
 * three times, with nothing to say which was the cover and which the signature —
 * each one immediately before a visible, correctly-named button that does exactly
 * the same job (`onclick={() => fileInput?.click()}`).
 *
 * That is a duplicate tab stop for every upload, and the duplicate is the
 * anonymous one. Naming the input would be the wrong fix — it would leave two
 * tab stops per upload doing one job. The panel deliberately drives uploads
 * through the visible button ("the file input stays visually hidden and the
 * styled button opens it"), so the input is the MECHANISM and belongs out of the
 * tab order: `tabindex="-1"`, placed after the field spread so it wins. NOT
 * `aria-hidden` and not `display: none` — it is a real form control that has to
 * submit, and Safari will not reliably submit a `display: none` file input's
 * selection. The reasoning is recorded on the three inputs themselves.
 *
 * ── AND THE RULE THAT CATCHES THE OPPOSITE MISTAKE ───────────────────────────
 * `aria-hidden="true"` on a control that can still be reached is itself a
 * violation — the user lands on something the tree says is not there. So the
 * sweep asserts BOTH directions: nothing focusable is unnamed, and nothing
 * aria-hidden is focusable. A future fix that hides one of these by marking it
 * `aria-hidden` while leaving it reachable fails the second rule.
 */

import type { PageBuilderState, PageSection } from '@codex/shared-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

// THE TWO REMOTE MODULES ARE MOCKED, and not for convenience: an UNMOCKED
// `query()` throws SYNCHRONOUSLY in jsdom (`app.hooks` is undefined), before its
// promise exists — so `sellMedia.open()`'s `.catch()` never attaches and the
// whole call rejects. `PageMediaPanel` cannot mount without a loaded store
// (its upload forms declare a hidden `pageId` and SvelteKit's dev guard throws on
// a hidden input with an empty value), so the panel is unmountable without this.
// A CLOSED factory, like `sell-media-store.test.ts`'s.
const listMedia = vi.fn();

/**
 * A stand-in for a SvelteKit remote `form()`.
 *
 * `fields` is a PROXY rather than a fixed object because the panel reaches for
 * `fields.pageId`, `fields.cover` and `fields.image` and each field's `.as(type)`
 * spreads real attributes onto the input — a `{}` here throws "cannot read
 * properties of undefined (reading 'as')" at mount and the panel never renders,
 * which is a mock failure that looks exactly like a component bug.
 *
 * `.as()` returns the `name` and `type` a real remote form would, so the rendered
 * inputs keep the shape the sweep is judging.
 */
function formStub() {
  return {
    enhance: () => ({}),
    result: undefined,
    pending: 0,
    fields: new Proxy(
      {},
      {
        get: (_t, key: string) => ({
          as: (type: string, value?: string) => ({
            name: key,
            type,
            ...(value === undefined ? {} : { value }),
          }),
        }),
      }
    ),
  };
}

vi.mock('$lib/remote/journeys.remote', () => ({
  getJourneySellMedia: vi.fn(async () => null),
  updateJourneySellMedia: vi.fn(),
  uploadJourneyCoverForm: formStub(),
  deleteJourneyCover: vi.fn(),
  uploadJourneyHeroImageForm: formStub(),
  deleteJourneyHeroImage: vi.fn(),
  uploadJourneySignatureImageForm: formStub(),
  deleteJourneySignatureImage: vi.fn(),
}));
vi.mock('$lib/remote/media.remote', () => ({
  listMedia: (input: unknown) => listMedia(input),
}));

const { SECTION_DESIGN_AXES } = await import('$lib/page-builder');
const { pageBuilder } = await import(
  '$lib/page-builder/page-builder-store.svelte'
);
const { sellMedia } = await import('$lib/page-builder/sell-media-store.svelte');
const { SECTION_DESIGN_PRESETS } = await import('./design-vocabulary');
const PageBrandPanel = (await import('./PageBrandPanel.svelte')).default;
const PageDesignPanel = (await import('./PageDesignPanel.svelte')).default;
const PageMediaPanel = (await import('./PageMediaPanel.svelte')).default;
const PagePricingPanel = (await import('./PagePricingPanel.svelte')).default;
const PageSeoPanel = (await import('./PageSeoPanel.svelte')).default;

const PAGE_ID = '00000000-0000-4000-8000-00000000e001';
const COURSE_ID = '00000000-0000-4000-8000-00000000e0c0';

function draft(): PageBuilderState {
  return {
    pageType: 'course',
    slug: 'panel-sweep',
    title: 'Panel sweep',
    status: 'draft',
    subjectType: 'course',
    subjectId: COURSE_ID,
    brandOverrides: null,
    sections: [
      { id: 'sec-hero', type: 'hero', enabled: true, props: {} } as PageSection,
    ],
  } as PageBuilderState;
}

/**
 * The accessible name of a control, by the steps this app relies on — and the
 * SOURCE, so a placeholder-only name cannot pass as a name. Same helper shape as
 * the per-field sweep's; kept local because the two files sweep different DOMs
 * and a shared one would have to grow branches for both.
 */
function accessibleName(el: HTMLElement): { name: string; from: string } {
  const aria = el.getAttribute('aria-label');
  if (aria?.trim()) return { name: aria.trim(), from: 'aria-label' };

  const byIds = (attr: string): string =>
    (el.getAttribute(attr) ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ')
      .trim();
  const labelled = byIds('aria-labelledby');
  if (labelled) return { name: labelled, from: 'aria-labelledby' };

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
  if (
    (el.tagName === 'BUTTON' || el.tagName === 'A') &&
    el.textContent?.trim()
  ) {
    return { name: el.textContent.trim(), from: 'content' };
  }
  const group = el.closest('[role="group"]');
  if (group) {
    const gl = group.getAttribute('aria-label');
    if (gl?.trim()) return { name: gl.trim(), from: 'group aria-label' };
    const gIds = (group.getAttribute('aria-labelledby') ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .map((gid) => document.getElementById(gid)?.textContent ?? '')
      .join(' ')
      .trim();
    if (gIds) return { name: gIds, from: 'group aria-labelledby' };
  }
  const title = el.getAttribute('title');
  if (title?.trim()) return { name: title.trim(), from: 'title' };
  const placeholder = el.getAttribute('placeholder');
  if (placeholder?.trim()) {
    return { name: placeholder.trim(), from: 'PLACEHOLDER ONLY' };
  }
  return { name: '', from: 'NONE' };
}

/** Everything a keyboard user can land on. */
const FOCUSABLE =
  'input:not([type="hidden"]), textarea, select, button, a[href], [tabindex]';

function focusableControls(): HTMLElement[] {
  return [...document.body.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.getAttribute('tabindex') !== '-1'
  );
}

function describeEl(el: HTMLElement): string {
  const type = el.getAttribute('type');
  return `${el.tagName.toLowerCase()}${type ? `[type=${type}]` : ''}.${
    el.className.split(' ').filter((c) => !c.startsWith('svelte-'))[0] ?? '?'
  }`;
}

/**
 * Mount one panel with the store state it needs to render at all.
 *
 * `PageMediaPanel` requires a page id in the sell-media store before it can
 * mount: its upload forms declare a HIDDEN `pageId` field, and SvelteKit's dev
 * guard throws on a hidden input with an empty value. `hasCourse: false` skips
 * the attached-media read; the library read fails soft inside the store. Same
 * preparation `builder-chrome-i18n.svelte.test.ts` documents.
 */
async function mountPanel(name: string) {
  pageBuilder.open(PAGE_ID, draft());
  if (name === 'PageMediaPanel') {
    await sellMedia.open(PAGE_ID, { hasCourse: false });
  }
  // A `switch` rather than a lookup table: the five panels are five distinct
  // component types, and a table would union them into something `mount()`'s
  // props parameter cannot accept without a cast.
  const target = document.body;
  const component =
    name === 'PageDesignPanel'
      ? mount(PageDesignPanel, { target })
      : name === 'PagePricingPanel'
        ? mount(PagePricingPanel, { target })
        : name === 'PageMediaPanel'
          ? mount(PageMediaPanel, { target })
          : name === 'PageBrandPanel'
            ? mount(PageBrandPanel, { target })
            : name === 'PageSeoPanel'
              ? mount(PageSeoPanel, { target })
              : null;
  if (!component) throw new Error(`no panel named ${name}`);
  flushSync();
  return component;
}

const PANELS = [
  'PageDesignPanel',
  'PagePricingPanel',
  'PageMediaPanel',
  'PageBrandPanel',
  'PageSeoPanel',
] as const;

beforeEach(() => {
  pageBuilder.close();
  sellMedia.close();
  listMedia.mockReset();
  listMedia.mockResolvedValue({ items: [] });
});

afterEach(() => {
  document.body.innerHTML = '';
  pageBuilder.close();
  sellMedia.close();
});

describe('3 · every page-panel control a keyboard user can reach is NAMED', () => {
  for (const name of PANELS) {
    it(`${name}`, async () => {
      const component = await mountPanel(name);
      const controls = focusableControls();
      // Not vacuous: every panel has controls. A panel that rendered nothing
      // would otherwise pass this silently.
      expect(controls.length, `${name} rendered no controls`).toBeGreaterThan(
        0
      );

      const failures = controls
        .map((el) => ({ el, ...accessibleName(el) }))
        .filter(({ name: n, from }) => !n || from === 'PLACEHOLDER ONLY')
        .map(({ el, name: n, from }) => `${describeEl(el)} → "${n}" (${from})`);

      unmount(component);
      expect(failures).toEqual([]);
    });
  }
});

describe('5 · nothing hidden from assistive tech is still reachable', () => {
  for (const name of PANELS) {
    it(`${name}`, async () => {
      const component = await mountPanel(name);
      // The other direction of the same rule. An `aria-hidden` control that
      // still takes a tab stop lands the user on something the tree says is not
      // there — so a fix that hides a control must also remove it from the tab
      // order, and this is what stops one being done without the other.
      const contradictions = focusableControls()
        .filter((el) => el.closest('[aria-hidden="true"]'))
        .map(describeEl);
      unmount(component);
      expect(contradictions).toEqual([]);
    });
  }

  for (const name of PANELS) {
    it(`${name} — no positive tabindex`, async () => {
      const component = await mountPanel(name);
      const positive = [
        ...document.body.querySelectorAll<HTMLElement>('[tabindex]'),
      ]
        .filter((el) => Number(el.getAttribute('tabindex')) > 0)
        .map(describeEl);
      unmount(component);
      expect(positive).toEqual([]);
    });
  }
});

describe('1+2 · the Look panel writes the whole preset, not a single axis', () => {
  it('writes all nine axes for every one of the eight presets', () => {
    // A preset is a coherent bundle — the panel's header says so ("the
    // page-level control writes all nine or none"), because the research
    // measures contrast per family. A preset that wrote eight axes would leave
    // the ninth inheriting from whatever the previous preset set, so the page
    // would show a look no preset describes.
    pageBuilder.open(PAGE_ID, draft());
    const component = mount(PageDesignPanel, { target: document.body });
    flushSync();

    expect(SECTION_DESIGN_PRESETS.length).toBe(8);
    const failures: string[] = [];

    for (const preset of SECTION_DESIGN_PRESETS) {
      const card = [
        ...document.body.querySelectorAll<HTMLButtonElement>('button.preset'),
      ].find((b) => b.textContent?.includes(preset.name));
      if (!card) {
        failures.push(`${preset.id}: no card`);
        continue;
      }
      card.click();
      flushSync();
      const stored = pageBuilder.pending?.design as
        | Record<string, string>
        | undefined;
      for (const axis of SECTION_DESIGN_AXES) {
        if (stored?.[axis] !== preset.design[axis]) {
          failures.push(
            `${preset.id}.${axis}: stored ${stored?.[axis]}, preset ${preset.design[axis]}`
          );
        }
      }
      // And the card says it is the one selected, so the panel and the draft
      // cannot disagree about which look the page has.
      if (card.getAttribute('aria-pressed') !== 'true') {
        failures.push(`${preset.id}: card is not aria-pressed after selection`);
      }
    }

    unmount(component);
    expect(failures).toEqual([]);
  });
});
