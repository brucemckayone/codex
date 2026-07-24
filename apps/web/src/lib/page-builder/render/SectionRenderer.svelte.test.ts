/**
 * Public section renderer (Codex-2pryk.3.1 · WP-3).
 *
 * Locks the render contract:
 *   - ENABLED + KNOWN sections render, in stored order;
 *   - DISABLED sections are dropped;
 *   - UNKNOWN types are dropped (forward-compatible — a widened `type` never
 *     throws, it simply isn't rendered).
 *
 * `selectRenderableSections` is the pure heart (asserted directly); the mount
 * test proves the same rules produce the right `<section>` DOM in jsdom.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { PageSection } from '$lib/page-builder';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import SectionRenderer from './SectionRenderer.svelte';
import { selectRenderableSections } from './section-registry';
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

    const rendered = [...document.body.querySelectorAll('.jp-section')].map(
      (el) => el.getAttribute('data-section-type')
    );
    expect(rendered).toEqual(['hero', 'invite']);

    unmount(component);
  });
});
