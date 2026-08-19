/**
 * Preset → served attribute test (journey sections · F-B2).
 *
 * The last link in the chain the preset picker depends on: a creator picks
 * "Candlelit", the store writes the bundle to `PageBuilderState.design`, the
 * service persists it to `landing_pages.design`, the read path feeds it to
 * `SectionRenderer`'s `pageDesign` — and THIS is where it has to become nine
 * `data-jp-*` attributes on the wrapper, because that is the only thing
 * `journey-design.css` can select on.
 *
 * `SectionRenderer.svelte.test.ts` (F-A) proves the emission MECHANICS — one
 * attribute per axis, section-over-page resolution, never a blank value. This
 * proves the PRESETS specifically: every one of the eight, every axis, end to end
 * through the real component. A preset holding a value the renderer drops (a typo,
 * or a value retired from `SECTION_DESIGN_VALUES`) would otherwise be a picker
 * entry that silently renders as something else.
 */
import { describe, expect, it } from 'vitest';
import { SECTION_DESIGN_AXES } from '$lib/page-builder';
import type { JourneySalesContext } from '$lib/page-builder/render';
import SectionRenderer from '$lib/page-builder/render/SectionRenderer.svelte';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import { SECTION_DESIGN_PRESETS } from './design-vocabulary';

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

describe('design presets reach the DOM', () => {
  for (const preset of SECTION_DESIGN_PRESETS) {
    it(`${preset.name} emits all nine axes verbatim`, () => {
      const component = mount(SectionRenderer, {
        target: document.body,
        props: {
          sections: [{ id: 'h', type: 'hero', enabled: true, props: {} }],
          context,
          pageDesign: preset.design,
        },
      });
      flushSync();

      const el = document.body.querySelector('.jp-sec');
      expect(el).not.toBeNull();
      for (const axis of SECTION_DESIGN_AXES) {
        expect(
          el?.getAttribute(`data-jp-${axis}`),
          `${preset.id} · ${axis}`
        ).toBe(preset.design[axis]);
      }

      unmount(component);
      document.body.innerHTML = '';
    });
  }

  it('a section override beats the preset on that axis ONLY', () => {
    // The inheritance model, measured at the DOM: the panel promises per-axis
    // override, and this is the assertion that the promise is kept.
    const candlelit = SECTION_DESIGN_PRESETS.find((p) => p.id === 'candlelit');
    if (!candlelit) throw new Error('candlelit preset missing');

    const component = mount(SectionRenderer, {
      target: document.body,
      props: {
        sections: [
          {
            id: 'h',
            type: 'hero',
            enabled: true,
            props: {},
            design: { width: 'full' },
          },
        ],
        context,
        pageDesign: candlelit.design,
      },
    });
    flushSync();

    const el = document.body.querySelector('.jp-sec');
    expect(el?.getAttribute('data-jp-width')).toBe('full');
    for (const axis of SECTION_DESIGN_AXES) {
      if (axis === 'width') continue;
      expect(el?.getAttribute(`data-jp-${axis}`)).toBe(candlelit.design[axis]);
    }

    unmount(component);
    document.body.innerHTML = '';
  });
});
