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
import { TEXT_EMPTY, textDefinition } from './definition';
import TextBlock from './TextBlock.svelte';

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
});

const SAMPLE = textDefinition.sample;
const LONG = [
  'For years I began every day already behind, reaching for the phone before I had properly woken up, answering other people before I had asked myself anything at all.',
  'Then a teacher suggested twenty minutes of nothing but breath and a notebook. I thought it was a waste of a morning. It turned out to be the only part of the day that was mine.',
  'This course is those twenty minutes, taught properly: why the breath comes first, what to write when you think you have nothing to say, and how to keep going on the days it feels pointless.',
  'You do not need an hour. You need a place to start, and a reason to come back tomorrow.',
].join('\n\n');

async function render(
  props: Record<string, unknown>,
  options: {
    layout?: string;
    headingLevel?: 1 | 2;
    offer?: SampleOfferState;
    edit?: BlockEdit | null;
    mediaBaseUrl?: string;
  } = {}
) {
  const section: ResolvedSection = {
    id: 'text-1',
    anchor: 'text',
    type: 'text',
    index: 3,
    layout: options.layout ?? 'statement',
    scheme: 'base',
    spacing: 'regular',
    headingLevel: options.headingLevel ?? 2,
  };
  app = mount(TextBlock, {
    target: document.body,
    props: {
      props,
      section,
      context: sampleContext({
        offer: options.offer ?? 'buy',
        mediaBaseUrl: options.mediaBaseUrl,
      }),
      edit: options.edit ?? null,
    },
  });
  flushSync();
  await tick();
}

function rerender(...args: Parameters<typeof render>) {
  if (app) unmount(app);
  app = null;
  return render(...args);
}

const text = () => document.body.textContent ?? '';
const one = (selector: string) => document.body.querySelector(selector);
const paragraphs = () =>
  [...document.body.querySelectorAll('.text__body p')].map(
    (p) => p.textContent
  );

describe('TextBlock', () => {
  it.each(
    SECTION_LAYOUTS.text
  )('%s: shows the heading and every paragraph as its own', async (layout) => {
    await render({ ...SAMPLE, eyebrow: 'My story' }, { layout });
    expect(one('h2')?.textContent).toBe(SAMPLE.heading);
    expect(text()).toContain('My story');
    expect(paragraphs()).toEqual(SAMPLE.body?.split('\n\n'));
  });

  it.each(SECTION_LAYOUTS.text)('%s: holds one short line', async (layout) => {
    await render({ body: 'Every morning is a fresh start.' }, { layout });
    expect(paragraphs()).toEqual(['Every morning is a fresh start.']);
    expect(one('.text')?.hasAttribute('data-long')).toBe(false);
  });

  it.each(
    SECTION_LAYOUTS.text
  )('%s: reads several long paragraphs at body size', async (layout) => {
    await render({ heading: 'Why I made this', body: LONG }, { layout });
    expect(paragraphs()).toHaveLength(4);
    expect(one('.text')?.hasAttribute('data-long')).toBe(true);
    expect(one('.text__body')?.getAttribute('data-size')).toBe('body');
  });

  it('statement: a quiet title over a large first paragraph, or the statement itself when alone', async () => {
    await render(SAMPLE, { layout: 'statement' });
    expect(one('h2')?.getAttribute('data-size')).toBe('title');
    await rerender({ heading: SAMPLE.heading }, { layout: 'statement' });
    expect(one('h2')?.getAttribute('data-size')).toBe('heading');
    await rerender({ heading: 'H', body: LONG }, { layout: 'statement' });
    expect(one('.text')?.hasAttribute('data-long-lead')).toBe(false);
    const run = 'A first paragraph that goes on for a good while. '.repeat(6);
    await rerender(
      { heading: 'H', body: `${run}\n\nThen a second.` },
      { layout: 'statement' }
    );
    expect(one('.text')?.hasAttribute('data-long-lead')).toBe(true);
  });

  it('takes its heading level from the section', async () => {
    await render(SAMPLE, { headingLevel: 1 });
    expect(one('h1')?.textContent).toBe(SAMPLE.heading);
    await rerender(SAMPLE);
    expect(one('h1')).toBeNull();
  });

  it.each(
    SECTION_LAYOUTS.text
  )('%s: with no text, the page shows only the heading and the canvas asks for words', async (layout) => {
    await render({ heading: 'H' }, { layout });
    expect(one('.text__body')).toBeNull();
    expect(text()).not.toContain(TEXT_EMPTY);
    await rerender({ heading: 'H' }, { layout, edit: { commit: () => {} } });
    expect(text()).toContain(TEXT_EMPTY);
  });

  it('renders only its own words', async () => {
    await render({});
    expect(one('h2')).toBeNull();
    const course = sampleContext().course;
    expect(text()).not.toContain(course.title);
    expect(text()).not.toContain(String(course.lede));
  });

  it('offers a way in only when the creator writes one, in every state', async () => {
    await render(SAMPLE, { layout: 'centered' });
    expect(one('a')).toBeNull();
    await rerender(
      { ...SAMPLE, ctaLabel: 'Start the course', note: 'Pay once.' },
      { layout: 'centered' }
    );
    expect(one('a')?.getAttribute('href')).toBe(
      '/journeys/steady-ground/checkout'
    );
    expect(one('.lp-actions')?.getAttribute('data-align')).toBe('center');
    expect(text()).toContain('Pay once.');
    await rerender(
      { ...SAMPLE, ctaLabel: 'Start the course' },
      { offer: 'enrolled' }
    );
    expect(one('a')?.textContent?.trim()).toBe(COPY.cta.continue);
    await rerender(
      { ...SAMPLE, ctaLabel: 'Start the course' },
      { offer: 'unavailable' }
    );
    expect(text()).toContain(COPY.cta.unavailableTitle);
  });

  it('edits the heading and the text in place, keeping paragraphs apart', async () => {
    await render(SAMPLE);
    expect(one('[contenteditable]')).toBeNull();

    const edits: [string, string][] = [];
    await rerender(SAMPLE, {
      edit: { commit: (key, value) => edits.push([key, value]) },
    });
    expect(one('h2')?.getAttribute('aria-label')).toBe('Text — Heading');
    const body = one('.text__body') as HTMLElement;
    expect(body.getAttribute('contenteditable')).toBe('true');
    const [first, second] = body.querySelectorAll('p');
    first.textContent = 'One quiet morning.';
    second.textContent = 'Then another.';
    body.dispatchEvent(new Event('input', { bubbles: true }));
    expect(edits).toEqual([['body', 'One quiet morning.\n\nThen another.']]);
  });

  it('starts a new section from the course title, in real sentences', () => {
    const starter = textDefinition.starter({ courseTitle: 'Steady Ground' });
    expect(starter.heading).toContain('Steady Ground');
    expect(starter.body).toContain('Steady Ground');
    expect(starter.body?.split('\n\n').length).toBeGreaterThanOrEqual(2);
  });

  describe('the creator image (contract A5)', () => {
    const CDN = 'https://cdn.test';
    const image = {
      key: 'landing-pages/p1/images/t1',
      alt: 'A notebook by a window',
    };
    const url = `${CDN}/${image.key}/lg.webp`;

    it('columns: sits in the heading column, beside the text', async () => {
      await render(
        { ...SAMPLE, image },
        { layout: 'columns', mediaBaseUrl: CDN }
      );
      const img = document.body.querySelector('.text__head img');
      expect(img?.getAttribute('src')).toBe(url);
      expect(img?.getAttribute('alt')).toBe(image.alt);
    });

    it('columns: still shows with no heading to sit under', async () => {
      await render(
        { body: SAMPLE.body, image },
        { layout: 'columns', mediaBaseUrl: CDN }
      );
      expect(
        document.body.querySelector('.text__head img')?.getAttribute('src')
      ).toBe(url);
      expect(document.body.querySelector('h2')).toBeNull();
    });

    it.each([
      'statement',
      'centered',
    ])('%s: leads the passage, above the words', async (layout) => {
      await render({ ...SAMPLE, image }, { layout, mediaBaseUrl: CDN });
      const first = document.body.querySelector('.text')?.firstElementChild;
      expect(first?.querySelector('img')?.getAttribute('src')).toBe(url);
      expect(document.body.querySelector('.text__head img')).toBeNull();
    });

    it.each(
      SECTION_LAYOUTS.text
    )('%s without a CDN base draws no image and no empty header', async (layout) => {
      await render({ body: SAMPLE.body, image }, { layout });
      expect(
        document.body.querySelector('img, .text__media, .text__head')
      ).toBeNull();
    });
  });
});
