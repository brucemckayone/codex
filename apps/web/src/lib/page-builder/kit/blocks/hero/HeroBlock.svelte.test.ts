import { tick } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import type { JourneySalesContext } from '../../../render/types';
import { COPY } from '../../model/copy';
import { SECTION_LAYOUTS } from '../../model/ids';
import { type SampleOfferState, sampleContext } from '../../model/sample';
import type { BlockEdit, ResolvedSection } from '../../model/types';
import HeroBlock from './HeroBlock.svelte';

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
});

function section(layout: string, headingLevel: 1 | 2 = 1): ResolvedSection {
  return {
    id: 'hero-1',
    anchor: 'hero',
    type: 'hero',
    index: 0,
    layout,
    scheme: 'brand',
    spacing: 'regular',
    headingLevel,
  };
}

async function render(
  props: Record<string, unknown>,
  options: {
    layout?: string;
    headingLevel?: 1 | 2;
    offer?: SampleOfferState;
    context?: JourneySalesContext;
    edit?: BlockEdit | null;
  } = {}
) {
  app = mount(HeroBlock, {
    target: document.body,
    props: {
      props,
      section: section(options.layout ?? 'statement', options.headingLevel),
      context:
        options.context ??
        sampleContext({
          offer: options.offer ?? 'buy',
          media: { heroImageUrl: '/hero.jpg' },
        }),
      edit: options.edit ?? null,
    },
  });
  flushSync();
  // Let the streamed sell-preview resolve.
  await tick();
  await Promise.resolve();
  flushSync();
}

const links = () => [...document.body.querySelectorAll('a')];

describe('HeroBlock', () => {
  it.each(
    SECTION_LAYOUTS.hero
  )('renders the %s layout with one h1 and its call to action', async (layout) => {
    await render(
      { heading: 'Find your steady ground', body: 'Six calm weeks.' },
      { layout }
    );
    const h1s = document.body.querySelectorAll('h1');
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toBe('Find your steady ground');
    expect(document.body.textContent).toContain('Six calm weeks.');
    expect(
      links().some(
        (a) => a.getAttribute('href') === '/journeys/steady-ground/checkout'
      )
    ).toBe(true);
  });

  it('draws a duplicate hero at h2, never a second h1', async () => {
    await render({ heading: 'Again' }, { headingLevel: 2 });
    expect(document.body.querySelector('h1')).toBeNull();
    expect(document.body.querySelector('h2')?.textContent).toBe('Again');
  });

  it('falls back to the course title — and borrows nothing else', async () => {
    await render({});
    const context = sampleContext();
    expect(document.body.querySelector('h1')?.textContent).toBe(
      context.course.title
    );
    // The course HAS a lede; an empty hero body must not show it.
    expect(document.body.textContent).not.toContain(
      String(context.course.lede)
    );
  });

  it('uses the creator label to buy', async () => {
    await render({
      heading: 'H',
      ctaLabel: 'Start the course',
      note: 'Start any time.',
    });
    const buy = links().find(
      (a) => a.textContent?.trim() === 'Start the course'
    );
    expect(buy?.getAttribute('href')).toBe('/journeys/steady-ground/checkout');
    expect(document.body.textContent).toContain('Start any time.');
  });

  it('says "Continue" to a member and drops the sales small print', async () => {
    await render(
      { heading: 'H', ctaLabel: 'Buy', note: 'Start any time.' },
      { offer: 'enrolled' }
    );
    const next = links().find(
      (a) => a.textContent?.trim() === COPY.cta.continue
    );
    expect(next?.getAttribute('href')).toBe(
      '/journeys/steady-ground/dashboard'
    );
    expect(document.body.textContent).not.toContain('Buy');
    expect(document.body.textContent).not.toContain('Start any time.');
  });

  it('says so when enrolment is closed, with no checkout link', async () => {
    await render({ heading: 'H', ctaLabel: 'Buy' }, { offer: 'unavailable' });
    expect(document.body.textContent).toContain(COPY.cta.unavailableTitle);
    expect(
      links().some((a) => a.getAttribute('href')?.includes('checkout'))
    ).toBe(false);
  });

  it('shows the hero image once the streamed media arrives, and none when asked not to', async () => {
    await render({ heading: 'H' }, { layout: 'split' });
    expect(document.body.querySelector('img')?.getAttribute('src')).toBe(
      '/hero.jpg'
    );
    unmount(app);
    await render({ heading: 'H', media: 'none' }, { layout: 'split' });
    expect(document.body.querySelector('img')).toBeNull();
  });

  it('carries editing attributes only on the canvas', async () => {
    await render({ heading: 'Find your steady ground' });
    expect(document.body.querySelector('[contenteditable]')).toBeNull();
    unmount(app);

    const edits: [string, string][] = [];
    await render(
      { heading: 'Find your steady ground' },
      { edit: { commit: (key, value) => edits.push([key, value]) } }
    );
    const h1 = document.body.querySelector('h1');
    expect(h1?.getAttribute('contenteditable')).toBe('true');
    expect(h1?.getAttribute('aria-label')).toBe('Hero — Headline');
    h1!.textContent = 'New headline';
    h1!.dispatchEvent(new Event('input', { bubbles: true }));
    expect(edits).toEqual([['heading', 'New headline']]);
  });
});
