/**
 * The builder CANVAS versus the PUBLIC page — machine-checked parity
 * (`Codex-sf7t6`).
 *
 * WHY THIS FILE EXISTS. An audit measured, by hand and browser, that the canvas
 * and the published page disagreed on 5 of 12 stored sections while agreeing on
 * the resolved variant id in all 12. None of it was caught by any test, because
 * every existing test asserted ONE tree at a time. This file asserts the
 * relationship between them.
 *
 * WHAT CHANGED, AND WHY THE FILE IS STILL HERE. There are no longer two
 * component trees to compare: `render-edit/`'s eight static twins are deleted and
 * both surfaces mount the same `SectionFrame`. Parity is now a property of the
 * STRUCTURE rather than a coincidence two trees have to keep re-earning — but it
 * is not free, because the canvas keeps its OWN section loop (it interleaves
 * per-block editing chrome between sections, which `SectionRenderer`'s
 * array-level loop cannot do). So the two mount paths remain, and what this file
 * guards is that they stay two paths over ONE tree: the same component, the same
 * resolved composition, the same emitted axes. A re-forked registry is the
 * regression it exists to catch.
 *
 * WHAT IT CAN AND CANNOT DO. jsdom implements neither `container-type`/`cqw` nor
 * `color-mix()`, so it can say nothing true about what an axis PAINTS or about
 * geometry. The audit's arrangement fingerprint (x-position clusters,
 * side-by-side pairs, aspect ratio) therefore belongs in Playwright, not here.
 * What jsdom CAN pin down is structure: which component each path picks, which
 * composition each resolves, and which attributes each emits.
 *
 * NO CHARACTERISATION ASSERTIONS REMAIN. Two of these used to pin known-wrong
 * canvas behaviour so it could not worsen silently; both gaps are now closed, one
 * inverted in place (axis emission) and one deleted with its subject
 * (`Codex-eqcpz`'s dead modifier rules went when the canvas stylesheet did).
 *
 * It lives under `components/page-builder` because it reads the canvas component
 * itself, and the import boundary forbids `$lib/page-builder` from importing
 * `$lib/components/page-builder`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PageSection } from '@codex/shared-types';
import { tick } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import {
  resolveVariant,
  SECTION_CATALOG,
  SECTION_DESIGN_AXES,
} from '$lib/page-builder';
import {
  builderSalesContext,
  SECTION_COMPONENTS as PUBLIC_COMPONENTS,
  selectRenderableSections,
} from '$lib/page-builder/render';
import SectionFrame from '$lib/page-builder/render/SectionFrame.svelte';
import PublicSectionRenderer from '$lib/page-builder/render/SectionRenderer.svelte';
import type { JourneySalesContext } from '$lib/page-builder/render/types';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const HERE = dirname(fileURLToPath(import.meta.url));
/** `$lib/page-builder`, from here. */
const PUBLIC_LIB = join(HERE, '../../page-builder');

/** Minimal but real sales context — mirrors `SectionRenderer.svelte.test.ts`. */
const context: JourneySalesContext = {
  course: {
    id: 'c1',
    slug: 'demo',
    title: 'Demo course',
    kicker: 'A course',
    lede: 'A short lede.',
    status: 'published',
    priceCents: 4500,
    stageCount: 1,
    practiceCount: 3,
  },
  stages: [],
  testimonials: [],
  checkoutUrl: 'http://lvh.me:3000/journeys/demo/checkout',
  dashboardUrl: 'http://lvh.me:3000/journeys/demo/dashboard',
  enrolled: false,
  offer: null,
  sellPreview: Promise.resolve(null),
};

/** One enabled section per catalogue type, carrying no authored props. */
const oneOfEveryType: PageSection[] = SECTION_CATALOG.map((def) => ({
  id: `s-${def.type}`,
  type: def.type,
  enabled: true,
  props: {},
}));

afterEach(() => {
  document.body.innerHTML = '';
});

describe('canvas ↔ public: one registry, two mount paths', () => {
  it('gives every catalogue type a component in the one registry', () => {
    // This used to check TWO registries and tolerate a consolidation — eight
    // `render-edit` twins covering eleven types, with three types having no twin
    // at all. There is one registry now, so the assertion is simply that it is
    // complete: a catalogue type with no component renders nothing, on both
    // surfaces at once.
    expect(SECTION_CATALOG).toHaveLength(11);
    const missing = SECTION_CATALOG.filter(
      (def) => !PUBLIC_COMPONENTS[def.type]
    ).map((def) => def.type);
    expect(missing).toEqual([]);
  });

  it('leaves the canvas no registry of its own to diverge with', () => {
    // The structural half of parity, and the one worth guarding: two trees drift
    // because two trees CAN. `render-edit/` is deleted, and the canvas reaches
    // components only through `SectionFrame` — so re-forking means either
    // recreating that directory or importing a section component directly, and
    // both fail here.
    expect(
      existsSync(join(PUBLIC_LIB, 'render-edit')),
      'render-edit/ is back — the second tree that this file exists to prevent'
    ).toBe(false);

    const canvas = readFileSync(
      join(HERE, 'JourneyBuilderCanvas.svelte'),
      'utf8'
    );
    expect(canvas).toContain('SectionFrame');
    expect(canvas, 'canvas imports a section component directly').not.toMatch(
      /from '[^']*render\/sections\//
    );
  });
});

describe('canvas ↔ public: the resolved composition', () => {
  it('resolves the SAME variant in both trees for the same stored section', () => {
    // Both trees call the same `resolveVariant`, so they cannot disagree on the
    // ID. That makes this a cheap regression guard rather than a live bug — it
    // exists because the founding defect (Codex-qcgo3) was precisely that the
    // canvas honoured a variant the public renderer discarded, and a future
    // divergence would be silent.
    for (const section of oneOfEveryType) {
      const resolved = resolveVariant(section);
      expect(resolved, `${section.type} resolves to nothing`).toBeTruthy();
      // A resolved id must be a composition the catalogue actually declares —
      // otherwise the class each tree emits matches no rule in either.
      const declared = SECTION_CATALOG.find(
        (d) => d.type === section.type
      )?.variants.map((v) => v.id);
      expect(declared, `${section.type} declares no variants`).toBeDefined();
      expect(declared).toContain(resolved);
    }
  });

  it('honours a STORED variant over the default, in both trees', () => {
    // The stored-variant path is the one 0087 and 0089 had to migrate, so it is
    // worth pinning that a non-default stored id survives resolution.
    const guide = SECTION_CATALOG.find((d) => d.type === 'guide');
    const nonDefault = guide?.variants.find(
      (v) => v.id !== guide.defaultVariant
    );
    expect(nonDefault).toBeDefined();
    const stored: PageSection = {
      id: 's-guide',
      type: 'guide',
      enabled: true,
      props: {},
      variant: nonDefault?.id,
    } as PageSection;
    expect(resolveVariant(stored)).toBe(nonDefault?.id);
  });
});

describe('canvas ↔ public: axis emission (CHARACTERISATION — Codex-6nrsk)', () => {
  it('emits the axis attributes on the PUBLIC tree', () => {
    const component = mount(PublicSectionRenderer, {
      target: document.body,
      props: { sections: [oneOfEveryType[0]], context },
    });
    flushSync();

    const sec = document.body.querySelector('.jp-sec');
    expect(sec, 'public tree rendered no .jp-sec').not.toBeNull();
    const emitted = SECTION_DESIGN_AXES.filter((axis) =>
      sec?.hasAttribute(`data-jp-${axis}`)
    );
    // All nine axes, on every section, resolved by `resolveDesign`.
    expect(emitted).toEqual([...SECTION_DESIGN_AXES]);

    unmount(component);
  });

  it('emits all nine on the CANVAS path too — the gap is closed', () => {
    // This assertion is the inverse of the one it replaces. It used to read
    // "emits NONE of them on the canvas tree", because the canvas rendered its
    // own component set and `resolveDesign` was never called for it: a creator
    // could change any of the nine axes, watch the panel's resolved-value readout
    // update, and see the canvas beside it not move.
    //
    // The canvas now mounts the same `SectionFrame` the public renderer does, so
    // there is no second tree to diverge. Kept (rather than deleted) and INVERTED
    // deliberately: the old test's own note said to delete it and let the
    // public-tree case cover both, but the canvas reaches the frame by its own
    // loop, so "the public tree emits" would no longer witness the canvas at all.
    const component = mount(SectionFrame, {
      target: document.body,
      props: {
        renderable: selectRenderableSections([oneOfEveryType[0]])[0],
        context,
        editable: true,
      },
    });
    flushSync();

    const sec = document.body.querySelector('.jp-sec');
    expect(sec, 'canvas path rendered no .jp-sec').not.toBeNull();
    const emitted = SECTION_DESIGN_AXES.filter((axis) =>
      sec?.hasAttribute(`data-jp-${axis}`)
    );
    expect(emitted).toEqual([...SECTION_DESIGN_AXES]);

    unmount(component);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The sell media (Codex-bvhcr)
// ─────────────────────────────────────────────────────────────────────────────

const HERO_STILL = 'https://cdn.test/hero/still.jpg';

/**
 * One hero on a PLATE-LED composition. `full-bleed` matters: `stage`, `oversized`
 * and `banner` have nowhere to draw a plate, so they paint no still no matter what
 * media resolves, and a test built on one of them would pass for the wrong reason.
 */
const heroWithPlate: PageSection = {
  id: 's-hero',
  type: 'hero',
  enabled: true,
  props: {},
  variant: 'full-bleed',
} as PageSection;

/**
 * Let the media reads land: the plate's own `{#await}` plus the `$effect` that
 * mirrors the same promise into state. Two microtask turns, because the mirror
 * resolves a `.then` off the promise the await block is already consuming — the
 * same reason `HeroSection.svelte.test.ts` settles twice.
 */
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  flushSync();
  await tick();
}

/**
 * Mount ONE of the two paths, read the still the hero actually painted, tear it
 * down. Returning the `src` rather than asserting inside keeps each `it` to one
 * mount at a time, so no teardown needs a non-null assertion to reach its handle.
 */
async function heroStillVia(
  path: 'canvas' | 'public',
  section: PageSection,
  context: JourneySalesContext
): Promise<string | null> {
  const component =
    path === 'canvas'
      ? mount(SectionFrame, {
          target: document.body,
          props: {
            renderable: selectRenderableSections([section])[0],
            context,
            editable: true,
          },
        })
      : mount(PublicSectionRenderer, {
          target: document.body,
          props: { sections: [section], context },
        });
  flushSync();
  await settle();

  const src =
    document.body.querySelector('.hero__img')?.getAttribute('src') ?? null;

  unmount(component);
  document.body.innerHTML = '';
  return src;
}

describe('canvas ↔ public: the sell media (Codex-bvhcr)', () => {
  it('forwards a sellPreview from the canvas into the shared context', () => {
    // SOURCE-level, deliberately. This was never a rendering fault:
    // `builderSalesContext` takes `sellPreview` as OPTIONAL and defaults it to
    // null, so a canvas that simply never passed one type-checked, mounted and
    // rendered — showing all four media-bearing sections (`hero`, `introVideo`,
    // `reel`, `guide`) their media-less fallback. No assertion over the canvas
    // ALONE could witness it, because "no media" is also the correct output for a
    // course that has picked none. The defect was the disagreement with the public
    // page, and what hid it was that the disagreement sat between a DEFAULT and a
    // value rather than between two visible behaviours.
    const canvas = readFileSync(
      join(HERE, 'JourneyBuilderCanvas.svelte'),
      'utf8'
    );
    const opens = canvas.indexOf('builderSalesContext({');
    expect(opens, 'canvas no longer builds a context here').toBeGreaterThan(-1);
    const call = canvas.slice(opens, canvas.indexOf('})', opens));
    expect(
      call,
      'builderSalesContext is called without sellPreview — the canvas is blind to the course media again'
    ).toContain('sellPreview');
  });

  it('paints the SAME hero still on both paths from one context', async () => {
    const context = builderSalesContext({
      course: { id: 'c1', slug: 'demo', title: 'Demo course' },
      stages: [],
      offer: null,
      sellPreview: { intro: null, reel: null, heroImageUrl: HERO_STILL },
    });

    const canvasSrc = await heroStillVia('canvas', heroWithPlate, context);
    const publicSrc = await heroStillVia('public', heroWithPlate, context);

    expect(canvasSrc, 'the canvas painted no hero still').toBe(HERO_STILL);
    expect(publicSrc, 'the two paths disagree on the hero still').toBe(
      canvasSrc
    );
  });

  it('agrees on NO media when the course has picked none', async () => {
    // The other half, and the reason the case above cannot stand alone: a canvas
    // that INVENTED media the page does not have would satisfy it just as well.
    // Parity is an equality, so it needs both directions pinned.
    const context = builderSalesContext({
      course: { id: 'c1', slug: 'demo', title: 'Demo course' },
      stages: [],
      offer: null,
    });

    expect(await heroStillVia('canvas', heroWithPlate, context)).toBeNull();
    expect(await heroStillVia('public', heroWithPlate, context)).toBeNull();
  });
});
