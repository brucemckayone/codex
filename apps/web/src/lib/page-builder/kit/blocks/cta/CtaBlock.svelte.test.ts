import { tick } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import { COPY } from '../../model/copy';
import { SECTION_LAYOUTS } from '../../model/ids';
import { type SampleOfferState, sampleContext } from '../../model/sample';
import type { BlockEdit, ResolvedSection } from '../../model/types';
import CtaBlock from './CtaBlock.svelte';

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
});

async function render(
  props: Record<string, unknown>,
  layout: string,
  offer: SampleOfferState = 'buy',
  edit: BlockEdit | null = null,
  mediaBaseUrl: string | null = null
) {
  const section: ResolvedSection = {
    id: 'cta-1',
    anchor: 'cta',
    type: 'cta',
    index: 9,
    layout,
    scheme: 'brand',
    spacing: 'regular',
    headingLevel: 2,
  };
  app = mount(CtaBlock, {
    target: document.body,
    props: {
      props,
      section,
      context: sampleContext({ offer, mediaBaseUrl }),
      edit,
    },
  });
  flushSync();
  await tick();
}

const text = () => document.body.textContent ?? '';
const link = (label: string) =>
  [...document.body.querySelectorAll('a')].find(
    (a) => a.textContent?.trim() === label
  );

describe('CtaBlock', () => {
  it.each(
    SECTION_LAYOUTS.cta
  )('%s: an invitation with a way in', async (layout) => {
    await render(
      { heading: 'Begin this week', body: 'The first practice is waiting.' },
      layout
    );
    expect(document.body.querySelector('h2')?.textContent).toBe(
      'Begin this week'
    );
    expect(text()).toContain('The first practice is waiting.');
    expect(link(COPY.cta.buy)?.getAttribute('href')).toBe(
      '/journeys/steady-ground/checkout'
    );
  });

  it('prices the split panel from the live offer only', async () => {
    await render({ heading: 'Join' }, 'split', 'tiers');
    expect(text()).toContain('£15 per month');
    unmount(app);
    await render({ heading: 'Join' }, 'split', 'unknown');
    expect(text()).not.toMatch(/£/);
    expect(link(COPY.cta.buy)).toBeDefined();
  });

  it.each(
    SECTION_LAYOUTS.cta
  )('%s: "Continue" for a member, a notice when closed', async (layout) => {
    await render({ heading: 'Join', ctaLabel: 'Buy it' }, layout, 'enrolled');
    expect(link(COPY.cta.continue)?.getAttribute('href')).toBe(
      '/journeys/steady-ground/dashboard'
    );
    unmount(app);
    await render(
      { heading: 'Join', ctaLabel: 'Buy it' },
      layout,
      'unavailable'
    );
    expect(text()).toContain(COPY.cta.unavailableTitle);
    expect(link('Buy it')).toBeUndefined();
  });

  it('renders only its own words', async () => {
    await render({}, 'band');
    expect(document.body.querySelector('h2')).toBeNull();
    expect(text()).not.toContain(sampleContext().course.title);
  });

  it('carries editing attributes only on the canvas', async () => {
    await render({ heading: 'Join' }, 'band');
    expect(document.body.querySelector('[contenteditable]')).toBeNull();
    unmount(app);
    await render({ heading: 'Join' }, 'band', 'buy', { commit: () => {} });
    expect(document.body.querySelector('h2')?.getAttribute('aria-label')).toBe(
      'Call to action — Heading'
    );
  });

  describe('the band background image (contract A5)', () => {
    const CDN = 'https://cdn.test';
    const background = { key: 'landing-pages/p1/images/bg' };
    const root = () => document.body.querySelector('.cta');

    it('fills the band on the media ink set, decorative unless described', async () => {
      await render({ heading: 'Join', background }, 'band', 'buy', null, CDN);
      const img = document.body.querySelector('img');
      expect(img?.getAttribute('src')).toBe(`${CDN}/${background.key}/lg.webp`);
      expect(img?.getAttribute('alt')).toBe('');
      expect(root()?.hasAttribute('data-lp-on-media')).toBe(true);
      expect(document.body.querySelector('.cta__atmos')).toBeNull();
      expect(link(COPY.cta.buy)).toBeDefined();
    });

    it.each(['split', 'compact'])('%s ignores it', async (layout) => {
      await render({ heading: 'Join', background }, layout, 'buy', null, CDN);
      expect(document.body.querySelector('img')).toBeNull();
      expect(root()?.hasAttribute('data-lp-on-media')).toBe(false);
    });

    it('without a CDN base, draws the band exactly as without an image', async () => {
      await render({ heading: 'Join', background }, 'band');
      expect(document.body.querySelector('img')).toBeNull();
      expect(root()?.hasAttribute('data-lp-on-media')).toBe(false);
      expect(document.body.querySelector('.cta__atmos')).not.toBeNull();
    });
  });
});
