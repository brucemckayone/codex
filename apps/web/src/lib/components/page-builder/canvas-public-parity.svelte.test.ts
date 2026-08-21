/**
 * The builder CANVAS versus the PUBLIC page — machine-checked parity, and the
 * two gaps that are real (`Codex-sf7t6`).
 *
 * WHY THIS FILE EXISTS. An audit measured, by hand and browser, that the canvas
 * and the published page disagree on 5 of 12 stored sections while agreeing on
 * the resolved variant id in all 12. None of it was caught by any test, because
 * every existing test asserts ONE tree at a time. This file asserts the
 * relationship between them.
 *
 * WHAT IT CAN AND CANNOT DO. jsdom implements neither `container-type`/`cqw` nor
 * `color-mix()`, so it can say nothing true about what an axis PAINTS or about
 * geometry. The audit's arrangement fingerprint (x-position clusters,
 * side-by-side pairs, aspect ratio) therefore belongs in Playwright, not here.
 * What jsdom CAN pin down is structure: which component each tree picks, which
 * composition each resolves, and which attributes each emits. Those are the
 * dimensions all four of the audit's canvas findings live on.
 *
 * TWO OF THESE ASSERTIONS ARE CHARACTERISATION, NOT APPROVAL. They pin the
 * CURRENT, KNOWN-WRONG behaviour of the canvas so it cannot get worse silently —
 * and so that the moment someone fixes it, the test fails and makes them come
 * here and say so deliberately. Each names its bead. Do not "fix" a failing
 * characterisation by loosening it; fix it by deleting it once the gap is closed.
 *
 * It lives under `components/page-builder` rather than beside the renderers
 * because the import boundary forbids `$lib/page-builder` importing
 * `$lib/components/page-builder`, and this needs to see both trees.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CourseSectionType, PageSection } from '@codex/shared-types';
import { afterEach, describe, expect, it } from 'vitest';
import {
  resolveVariant,
  SECTION_CATALOG,
  SECTION_DESIGN_AXES,
} from '$lib/page-builder';
import {
  SECTION_COMPONENTS as PUBLIC_COMPONENTS,
  selectRenderableSections,
} from '$lib/page-builder/render';
import SectionFrame from '$lib/page-builder/render/SectionFrame.svelte';
import PublicSectionRenderer from '$lib/page-builder/render/SectionRenderer.svelte';
import type { JourneySalesContext } from '$lib/page-builder/render/types';
import { SECTION_COMPONENTS as CANVAS_COMPONENTS } from '$lib/page-builder/render-edit';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const HERE = dirname(fileURLToPath(import.meta.url));
const CANVAS_CSS_DIR = join(
  HERE,
  '../../page-builder/render-edit/journey-sections'
);

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

describe('canvas ↔ public: which component each tree picks', () => {
  it('covers every catalogue type in BOTH registries — nothing is missing from the canvas', () => {
    // `JourneyBuilderCanvas`'s own doc comment says "a section with no
    // `render-edit` twin does not appear here at all". That caveat is STALE: the
    // eight twins are CONSOLIDATED rather than one-to-one (VideoSection serves
    // introVideo + reel, ProseSection serves ache + turn + feel), so eight files
    // cover eleven types. This is that claim, machine-checked, so the doc cannot
    // drift back into being true.
    const missing = SECTION_CATALOG.filter(
      (def) => !CANVAS_COMPONENTS[def.type] || !PUBLIC_COMPONENTS[def.type]
    ).map((def) => def.type);
    expect(missing).toEqual([]);
  });

  it('maps eleven types onto eight distinct canvas twins', () => {
    // Pins the consolidation itself. If someone adds a twin per type, this
    // number moves and they should update the caveat above at the same time.
    const distinctTwins = new Set(
      SECTION_CATALOG.map((def) => CANVAS_COMPONENTS[def.type])
    );
    expect(SECTION_CATALOG).toHaveLength(11);
    expect(distinctTwins.size).toBe(8);
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

describe('canvas CSS ↔ catalogue: unreachable modifier rules (CHARACTERISATION — Codex-eqcpz)', () => {
  /**
   * Which catalogue types each canvas partial's class PREFIX serves.
   *
   * The twins are consolidated, so the prefix is not the type: `.jp-prose--*`
   * has to be checked against ache AND turn AND feel, because a rule is
   * reachable if ANY of the types sharing that prefix declares the id. Checking
   * ids type-blind would call `.jp-video--statement` reachable just because
   * `ache` declares `statement`.
   */
  const PREFIX_TYPES: Record<string, readonly CourseSectionType[]> = {
    hero: ['hero'],
    prose: ['ache', 'turn', 'feel'],
    video: ['introVideo', 'reel'],
    descent: ['map'],
    proof: ['proof'],
    guide: ['guide'],
    faq: ['faq'],
    invite: ['invite'],
  };

  /** Every `.jp-<prefix>--<id>` RULE the canvas partials declare, deduped. */
  const canvasRules = [
    ...new Set(
      readdirSync(CANVAS_CSS_DIR)
        .filter((f) => f.endsWith('.css'))
        .flatMap((f) => {
          const css = readFileSync(join(CANVAS_CSS_DIR, f), 'utf8');
          return [...css.matchAll(/\.jp-([a-z]+)--([a-z-]+)/g)].map(
            (m) => `${m[1]}--${m[2]}`
          );
        })
    ),
  ].sort();

  /** Composition ids declared per catalogue type. */
  const idsForType = new Map(
    SECTION_CATALOG.map((def) => [def.type, def.variants.map((v) => v.id)])
  );

  const isReachable = (rule: string): boolean => {
    const [prefix, id] = rule.split('--');
    return (PREFIX_TYPES[prefix] ?? []).some((type) =>
      (idsForType.get(type) ?? []).includes(id)
    );
  };

  it('finds the canvas rules and the declared compositions', () => {
    // Guards the guard: an empty either side makes the assertions below vacuous.
    // Note the two different counts, which are easy to conflate: the catalogue
    // declares 62 COMPOSITIONS (type-scoped), which dedupe to 45 distinct ID
    // STRINGS, because ids are shared across types — `column` belongs to guide,
    // feel and turn; `theatre` to introVideo and reel.
    const declarations = SECTION_CATALOG.flatMap((def) => def.variants);
    const distinctIds = new Set(declarations.map((v) => v.id));
    expect(declarations).toHaveLength(62);
    expect(distinctIds.size).toBe(45);
    expect(canvasRules).toHaveLength(16);
    expect(PREFIX_TYPES).toMatchObject({ prose: ['ache', 'turn', 'feel'] });
  });

  it('has exactly seven RULES that can never match, and names them', () => {
    // `resolveVariant` migrates a stored legacy id through
    // LEGACY_SECTION_VARIANTS and returns the NEW id BEFORE any class is
    // emitted, so a page storing `centered` emits `.jp-prose--column` and never
    // `.jp-prose--centered`. These rules can therefore never match anything.
    // None is syntactically dead, which is why no linter flags them.
    //
    // Seven RULES but only six distinct ids — `centered` appears under two
    // prefixes. Counting ids instead of rules undercounts, which is the mistake
    // this assertion is written to avoid.
    //
    // They also encode exactly the semantics the canvas can no longer render,
    // because 0085's collapse moved their meaning into the design-axis layer the
    // canvas lacks: hero.left became stage + align:start, hero.minimal became
    // stage + four axis overrides, and the prose trio became column with
    // align/width combinations or `paired`. So the two canvas defects are one
    // defect with two symptoms.
    //
    // WHEN YOU DELETE THEM THIS TEST FAILS. Intended — drop the expectation to
    // `[]` and KEEP the assertion, so a new dead rule still gets caught.
    expect(canvasRules.filter((r) => !isReachable(r))).toEqual([
      'guide--centered',
      'hero--left',
      'hero--minimal',
      'prose--centered',
      'prose--twocol',
      'prose--wide',
      'video--simple',
    ]);
  });

  it('covers only nine of the sixty-two declared compositions', () => {
    // 16 rules sounds like partial support. Nine reachable rules against 62
    // compositions reads like what it actually is — and the nine cover slightly
    // more than nine compositions, because a shared prefix serves several types
    // (`.jp-prose--statement` is one rule reaching ache, turn and feel).
    const reachable = canvasRules.filter(isReachable);
    expect(reachable).toHaveLength(9);
  });
});
