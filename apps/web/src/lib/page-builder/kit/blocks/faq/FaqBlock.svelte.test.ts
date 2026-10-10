import { tick } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import { COPY } from '../../model/copy';
import { SECTION_LAYOUTS } from '../../model/ids';
import { sampleContext } from '../../model/sample';
import type { BlockEdit, ResolvedSection } from '../../model/types';
import { contactHref } from './contact';
import { FAQ_EMPTY, faqDefinition } from './definition';
import FaqBlock from './FaqBlock.svelte';

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
});

const SAMPLE = faqDefinition.sample;
const ITEMS = SAMPLE.items ?? [];

function mountFaq(
  props: Record<string, unknown>,
  options: {
    layout?: string;
    headingLevel?: 1 | 2;
    edit?: BlockEdit | null;
  } = {}
) {
  const section: ResolvedSection = {
    id: 'faq-1',
    anchor: 'faq',
    type: 'faq',
    index: 12,
    layout: options.layout ?? 'accordion',
    scheme: 'base',
    spacing: 'regular',
    headingLevel: options.headingLevel ?? 2,
  };
  app = mount(FaqBlock, {
    target: document.body,
    props: {
      props,
      section,
      context: sampleContext(),
      edit: options.edit ?? null,
    },
  });
}

async function render(...args: Parameters<typeof mountFaq>) {
  mountFaq(...args);
  flushSync();
  await tick();
}

const text = () => document.body.textContent ?? '';
const toggles = () => [...document.body.querySelectorAll('button')];
const panel = (button: HTMLButtonElement) =>
  document.getElementById(button.getAttribute('aria-controls') ?? '');

describe('FaqBlock', () => {
  it.each(
    SECTION_LAYOUTS.faq
  )('%s: every question is a heading under the section heading, with its answer', async (layout) => {
    await render(SAMPLE, { layout });
    expect(document.body.querySelector('h2')?.textContent).toBe(SAMPLE.heading);
    const questions = [...document.body.querySelectorAll('h3')].map((h) =>
      h.textContent?.trim()
    );
    expect(questions).toEqual(ITEMS.map((item) => item.question));
    for (const item of ITEMS) expect(text()).toContain(item.answer);
  });

  it('accordion: every answer is open until the script runs', () => {
    // `mount` runs no effects; `onMount` (the enhancement) waits for a flush —
    // exactly the state a visitor without JS is left in.
    mountFaq(SAMPLE);
    expect(toggles()).toHaveLength(ITEMS.length);
    for (const button of toggles()) {
      expect(button.getAttribute('aria-expanded')).toBe('true');
      expect(panel(button)?.hasAttribute('hidden')).toBe(false);
    }
  });

  it('accordion: real buttons that control their own answer, opening independently', async () => {
    await render(SAMPLE);
    const [first, second] = toggles();
    for (const button of toggles()) {
      expect(button.getAttribute('aria-expanded')).toBe('false');
      // Closed, yet still found by find-in-page.
      expect(panel(button)?.getAttribute('hidden')).toBe('until-found');
    }
    expect(panel(first)?.textContent).toContain(ITEMS[0].answer);

    first.click();
    second.click();
    flushSync();
    expect(first.getAttribute('aria-expanded')).toBe('true');
    expect(second.getAttribute('aria-expanded')).toBe('true');
    expect(panel(first)?.hasAttribute('hidden')).toBe(false);

    first.click();
    flushSync();
    expect(first.getAttribute('aria-expanded')).toBe('false');
    expect(second.getAttribute('aria-expanded')).toBe('true');
  });

  it('accordion: opens an answer that find-in-page matched', async () => {
    await render(SAMPLE);
    const [first] = toggles();
    panel(first)?.dispatchEvent(new Event('beforematch'));
    flushSync();
    expect(first.getAttribute('aria-expanded')).toBe('true');
  });

  it('accordion: arrow keys, Home and End move between the questions', async () => {
    await render(SAMPLE);
    const all = toggles();
    const press = (from: HTMLButtonElement, key: string) => {
      from.focus();
      from.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    };
    press(all[0], 'ArrowDown');
    expect(document.activeElement).toBe(all[1]);
    press(all[0], 'ArrowUp');
    expect(document.activeElement).toBe(all.at(-1));
    press(all[2], 'Home');
    expect(document.activeElement).toBe(all[0]);
    press(all[0], 'End');
    expect(document.activeElement).toBe(all.at(-1));
  });

  it('columns: every answer on show, with nothing to open', async () => {
    await render(SAMPLE, { layout: 'columns' });
    expect(toggles()).toHaveLength(0);
    expect(document.body.querySelector('[hidden]')).toBeNull();
  });

  it('keeps an answer’s paragraphs', async () => {
    const items = [{ question: 'Why?', answer: 'First part.\n\nSecond part.' }];
    for (const layout of SECTION_LAYOUTS.faq) {
      await render({ items }, { layout });
      const answer = [...document.body.querySelectorAll('p')].map(
        (p) => p.textContent
      );
      expect(answer).toEqual(['First part.', 'Second part.']);
      unmount(app);
      app = null;
    }
  });

  // Codex-61zsk.37 (C1): with no heading, the contact sat alone at the top of
  // the side column, ahead of the questions it answers for.
  it.each(
    SECTION_LAYOUTS.faq
  )('%s: the contact closes the list, after the last answer, heading or not', async (layout) => {
    const contact = {
      contactLabel: SAMPLE.contactLabel,
      contactHref: SAMPLE.contactHref,
    };
    for (const props of [SAMPLE, { items: ITEMS, ...contact }]) {
      await render(props, { layout });
      const paragraph = (words?: string) =>
        [...document.body.querySelectorAll('p')].find(
          (p) => p.textContent?.trim() === words
        );
      const lastAnswer = paragraph(ITEMS.at(-1)?.answer);
      const ask = paragraph(COPY.faq.stillWondering);
      const link = [...document.body.querySelectorAll('a')].find(
        (a) => a.textContent?.trim() === contact.contactLabel
      );
      expect(
        lastAnswer && ask && link,
        `${layout}: the closing row`
      ).toBeTruthy();
      const follows = (a: Node, b: Node) =>
        Boolean(
          a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING
        );
      expect(follows(lastAnswer as Node, ask as Node)).toBe(true);
      expect(follows(ask as Node, link as Node)).toBe(true);
      // In the list's own column: as a row of its own after the list it would
      // fall under the side column, orphaned again.
      expect(
        ask?.closest('.faq > *'),
        `${layout}: in the questions' column`
      ).toBe(lastAnswer?.closest('.faq > *'));
      unmount(app);
      app = null;
    }
  });

  it('accordion with no words sets the list across the band, never beside an empty column', async () => {
    const sided = () =>
      document.body.querySelector('.faq')?.hasAttribute('data-sided');
    await render({
      items: ITEMS,
      contactLabel: SAMPLE.contactLabel,
      contactHref: SAMPLE.contactHref,
    });
    expect(sided()).toBe(false);
    unmount(app);
    await render({ items: ITEMS, ctaLabel: 'Join us' });
    expect(sided()).toBe(false);
  });

  it('links the contact words safely: a bare address becomes an email link', async () => {
    await render(
      { ...SAMPLE, contactHref: 'hello@example.com' },
      { layout: 'columns' }
    );
    const link = [...document.body.querySelectorAll('a')].find(
      (a) => a.textContent?.trim() === SAMPLE.contactLabel
    );
    expect(link?.getAttribute('href')).toBe('mailto:hello@example.com');
    expect(contactHref('javascript:alert(1)')).toBe('#');
    expect(contactHref('https://example.com/help')).toBe(
      'https://example.com/help'
    );
    expect(contactHref(undefined)).toBe('#');
  });

  it.each(
    SECTION_LAYOUTS.faq
  )('%s: no contact link or button unless the creator writes one', async (layout) => {
    await render({ heading: 'Questions', items: ITEMS }, { layout });
    expect(document.body.querySelector('a')).toBeNull();
    unmount(app);
    await render(
      { heading: 'Questions', items: ITEMS, ctaLabel: 'Join us' },
      { layout }
    );
    expect(document.body.querySelector('a')?.textContent?.trim()).toBe(
      'Join us'
    );
  });

  it.each(
    SECTION_LAYOUTS.faq
  )('%s: with no questions the public page keeps only the words', async (layout) => {
    await render({ heading: 'Questions' }, { layout });
    expect(document.body.querySelector('ul')).toBeNull();
    expect(text()).not.toContain(FAQ_EMPTY);
    unmount(app);
    await render(
      { heading: 'Questions' },
      { layout, edit: { commit: () => {} } }
    );
    expect(
      document.body.querySelector('[data-lp-edit-only]')?.textContent
    ).toBe(FAQ_EMPTY);
  });

  it('takes its levels from the section, never skipping one', async () => {
    await render(SAMPLE, { headingLevel: 1 });
    expect(document.body.querySelector('h1')?.textContent).toBe(SAMPLE.heading);
    expect(document.body.querySelectorAll('h2')).toHaveLength(ITEMS.length);
    unmount(app);
    await render({ items: ITEMS });
    expect(document.body.querySelectorAll('h2')).toHaveLength(ITEMS.length);
    expect(document.body.querySelector('h3')).toBeNull();
  });

  it('starts from the course, with real questions', () => {
    const starter = faqDefinition.starter({ courseTitle: 'Steady Ground' });
    expect(starter.items?.length).toBeGreaterThanOrEqual(2);
    expect(starter.items?.[0].question).toContain('Steady Ground');
  });

  it('carries editing attributes only on the canvas', async () => {
    await render(SAMPLE);
    expect(document.body.querySelector('[contenteditable]')).toBeNull();
    unmount(app);
    await render(SAMPLE, { edit: { commit: () => {} } });
    expect(document.body.querySelector('h2')?.getAttribute('aria-label')).toBe(
      'Questions — Heading'
    );
    expect(
      document.body
        .querySelector('[data-field="contactLabel"]')
        ?.getAttribute('aria-label')
    ).toBe('Questions — Contact link text');
  });
});
