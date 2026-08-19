/**
 * Public section renderer (Codex-2pryk.3.1 · WP-3).
 *
 * Locks the render contract:
 *   - ENABLED + KNOWN sections render, in stored order;
 *   - DISABLED sections are dropped;
 *   - UNKNOWN types are dropped (forward-compatible — a widened `type` never
 *     throws, it simply isn't rendered);
 *   - the resolved `variant` REACHES the component (Codex-qcgo3 — it was absent
 *     from the props type entirely, so all 37 declared variants were unreachable);
 *   - the resolved design axes reach the DOM as `data-jp-*`;
 *   - DOM ids are unique even when a page holds several sections of one type
 *     (Codex-yxkj7 — the golden page served two `<section id="ache">`).
 *
 * `selectRenderableSections` is the pure heart (asserted directly); the mount
 * test proves the same rules produce the right `<section>` DOM in jsdom.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { PageSection } from '$lib/page-builder';
import { resolveVariant, SECTION_DESIGN_AXES } from '$lib/page-builder';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import SectionPropsProbe from './__tests__/SectionPropsProbe.svelte';
import SectionRenderer from './SectionRenderer.svelte';
import {
  SECTION_COMPONENTS,
  selectRenderableSections,
} from './section-registry';
import type { JourneySalesContext } from './types';

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
  // No offer read in this harness — sections must degrade to a price-less CTA
  // rather than falling back to authored numbers (Codex-2pryk.2.4.3).
  offer: null,
  sellPreview: Promise.resolve(null),
};

const sections: PageSection[] = [
  { id: 's-hero', type: 'hero', enabled: true, props: {} },
  { id: 's-ache', type: 'ache', enabled: false, props: { beats: ['x'] } },
  { id: 's-bogus', type: 'retreat-only-future', enabled: true, props: {} },
  { id: 's-invite', type: 'invite', enabled: true, props: {} },
];

describe('selectRenderableSections', () => {
  it('keeps enabled + known sections in order, drops disabled and unknown', () => {
    const result = selectRenderableSections(sections);
    expect(result.map((r) => r.section.type)).toEqual(['hero', 'invite']);
    for (const r of result) {
      expect(r.Component).not.toBeNull();
    }
  });

  it('returns an empty array when everything is disabled or unknown', () => {
    expect(
      selectRenderableSections([
        { id: 'a', type: 'hero', enabled: false, props: {} },
        { id: 'b', type: 'nope', enabled: true, props: {} },
      ])
    ).toEqual([]);
  });

  it('preserves stored order even when it differs from catalogue order', () => {
    const reordered: PageSection[] = [
      { id: 'i', type: 'invite', enabled: true, props: {} },
      { id: 'h', type: 'hero', enabled: true, props: {} },
    ];
    expect(
      selectRenderableSections(reordered).map((r) => r.section.type)
    ).toEqual(['invite', 'hero']);
  });
});

describe('selectRenderableSections — anchor ids (Codex-yxkj7)', () => {
  it('gives the FIRST section of a type its type-named id', () => {
    // Existing in-page anchors (`#map`, `#invite`) must keep resolving to the
    // section a reader expects, so the first of a type keeps the bare type.
    expect(selectRenderableSections(sections).map((r) => r.anchorId)).toEqual([
      'hero',
      'invite',
    ]);
  });

  it('gives DUPLICATE types unique ids', () => {
    // `duplicateSection()` clones a section with the SAME type, so two
    // `<section id="ache">` was a real served document, not a hypothetical.
    const duped: PageSection[] = [
      { id: 'a1', type: 'ache', enabled: true, props: {} },
      { id: 'a2', type: 'ache', enabled: true, props: {} },
      { id: 'a3', type: 'ache', enabled: true, props: {} },
    ];
    const ids = selectRenderableSections(duped).map((r) => r.anchorId);
    expect(ids).toEqual(['ache', 'ache-2', 'ache-3']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never lets a generated id collide with a real section type', () => {
    const ids = selectRenderableSections([
      { id: 'x', type: 'ache', enabled: true, props: {} },
      // A future type literally named like a generated id.
      { id: 'y', type: 'ache-2', enabled: true, props: {} },
      { id: 'z', type: 'ache', enabled: true, props: {} },
    ]).map((r) => r.anchorId);
    // `ache-2` is taken by the (unknown-type, therefore dropped) sibling only if
    // it renders; whatever renders, no two ids may match.
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('does not let a disabled or unknown section consume an ordinal', () => {
    // Otherwise toggling a section off would silently renumber its neighbours'
    // anchors — a stored deep link would start landing somewhere else.
    const ids = selectRenderableSections([
      { id: '1', type: 'ache', enabled: false, props: {} },
      { id: '2', type: 'ache', enabled: true, props: {} },
      { id: '3', type: 'not-a-real-type', enabled: true, props: {} },
      { id: '4', type: 'ache', enabled: true, props: {} },
    ]).map((r) => r.anchorId);
    expect(ids).toEqual(['ache', 'ache-2']);
  });
});

describe('SectionRenderer (mount)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders one <section data-section-type> per renderable section, in order', () => {
    const component = mount(SectionRenderer, {
      target: document.body,
      props: { sections, context },
    });
    flushSync();

    const rendered = [...document.body.querySelectorAll('.jp-sec')].map((el) =>
      el.getAttribute('data-section-type')
    );
    expect(rendered).toEqual(['hero', 'invite']);

    unmount(component);
  });

  it('passes the RESOLVED variant and design down TO THE COMPONENT (Codex-qcgo3)', () => {
    // Asserted against what the component actually RECEIVED, via a probe swapped
    // into the registry — not against the wrapper's attributes. `variant` was
    // absent from `SectionComponentProps` entirely, so an assertion on the
    // wrapper alone would pass while every section still got nothing.
    const real = SECTION_COMPONENTS.hero;
    SECTION_COMPONENTS.hero = SectionPropsProbe as typeof real;
    try {
      const component = mount(SectionRenderer, {
        target: document.body,
        props: {
          sections: [
            {
              id: 'h',
              type: 'hero',
              enabled: true,
              // A declared hero variant, so it survives resolution intact.
              variant: 'split',
              props: { headline: 'x' },
              design: { density: 'airy' },
            },
          ],
          context,
          pageDesign: { width: 'narrow' },
        },
      });
      flushSync();

      const probe = document.body.querySelector('[data-probe="section-props"]');
      expect(probe).not.toBeNull();
      expect(probe?.getAttribute('data-probe-variant')).toBe('split');
      expect(probe?.getAttribute('data-probe-density')).toBe('airy');
      expect(probe?.getAttribute('data-probe-width')).toBe('narrow');
      expect(probe?.getAttribute('data-probe-config-keys')).toBe('headline');
      // The public renderer is read-only: it must never arm the edit seam.
      expect(probe?.getAttribute('data-probe-editable')).toBe('false');
      expect(probe?.getAttribute('data-probe-on-edit')).toBe('undefined');

      unmount(component);
    } finally {
      SECTION_COMPONENTS.hero = real;
    }
  });

  it('resolves an UNKNOWN stored variant to the type default before passing it', () => {
    const real = SECTION_COMPONENTS.hero;
    SECTION_COMPONENTS.hero = SectionPropsProbe as typeof real;
    try {
      const component = mount(SectionRenderer, {
        target: document.body,
        props: {
          sections: [
            {
              id: 'h',
              type: 'hero',
              enabled: true,
              variant: 'bogus-future-variant',
              props: {},
            },
          ],
          context,
        },
      });
      flushSync();
      expect(
        document.body
          .querySelector('[data-probe="section-props"]')
          ?.getAttribute('data-probe-variant')
      ).toBe(resolveVariant({ type: 'hero', variant: undefined }));
      unmount(component);
    } finally {
      SECTION_COMPONENTS.hero = real;
    }
  });

  it('emits one data-jp-* attribute per axis, resolved section-over-page', () => {
    const component = mount(SectionRenderer, {
      target: document.body,
      props: {
        sections: [
          {
            id: 'h',
            type: 'hero',
            enabled: true,
            props: {},
            design: { density: 'vast' },
          },
        ],
        context,
        pageDesign: { width: 'full', density: 'compact', motion: 'none' },
      },
    });
    flushSync();

    const el = document.body.querySelector('.jp-sec');
    expect(el).not.toBeNull();
    // Section wins its own axis; the page's other axes still apply; unstated
    // axes fall to the defaults — and EVERY axis is present, never blank.
    expect(el?.getAttribute('data-jp-density')).toBe('vast');
    expect(el?.getAttribute('data-jp-width')).toBe('full');
    expect(el?.getAttribute('data-jp-motion')).toBe('none');
    for (const axis of SECTION_DESIGN_AXES) {
      expect(el?.getAttribute(`data-jp-${axis}`)).toBeTruthy();
    }

    unmount(component);
  });

  it('renders unique ids for duplicate section types', () => {
    const component = mount(SectionRenderer, {
      target: document.body,
      props: {
        sections: [
          { id: 'a1', type: 'ache', enabled: true, props: { beats: ['x'] } },
          { id: 'a2', type: 'ache', enabled: true, props: { beats: ['y'] } },
        ],
        context,
      },
    });
    flushSync();

    const ids = [...document.body.querySelectorAll('.jp-sec')].map(
      (el) => el.id
    );
    expect(ids).toEqual(['ache', 'ache-2']);

    unmount(component);
  });
});
