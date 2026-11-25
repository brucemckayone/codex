/**
 * The switch inside the shared cards (Codex-7104r, plan D4).
 *
 * ContentCard and JourneyEntryCard read the org's card style from context.
 * Today (the default, and what any page with no org layout reads) is their
 * own markup, unchanged; any other style draws StyledCard from the same props.
 * The context is set by a harness the way the org layout sets it.
 */
import type { CardStyle } from '@codex/validation';
import type { ComponentProps } from 'svelte';
import { afterEach, describe, expect, test } from 'vitest';
import JourneyEntryCard from '$lib/components/journeys/JourneyEntryCard.svelte';
import type { JourneyEntryCardProps } from '$lib/components/journeys/journey-entry-card';
import {
  createRawSnippet,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import ContentCard from '../ContentCard/ContentCard.svelte';
import CardStyleHarness from './CardStyleHarness.test.svelte';

const CONTENT: ComponentProps<typeof ContentCard> = {
  id: 'c1',
  title: 'Morning breath',
  href: '/content/morning-breath',
  contentType: 'video',
  duration: 300,
  price: { amount: 1000, currency: 'GBP' },
  contentAccessType: 'paid',
};

const JOURNEY: JourneyEntryCardProps = {
  href: '/journeys/stillness',
  title: 'Stillness',
  kicker: 'Foundation course',
  stats: [
    { value: 2, label: 'stages', key: 'stages' },
    { value: 3, label: 'practices', key: 'practices' },
  ],
  priceCents: 5000,
};

let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

function underStyle(
  style: CardStyle,
  card: {
    content?: ComponentProps<typeof ContentCard>;
    journey?: JourneyEntryCardProps;
  },
  vars: Record<string, string> = {}
) {
  component = mount(CardStyleHarness, {
    target: document.body,
    props: { style, vars, ...card },
  });
}

/** The card's own markup (the harness adds an anchor comment of its own). */
const markup = (selector: string) =>
  document.querySelector(selector)?.outerHTML;

describe('ContentCard: the switch', () => {
  test('no card-style context (a platform page): Today, no styled card', () => {
    component = mount(ContentCard, { target: document.body, props: CONTENT });
    expect(document.querySelector('article.cc')).not.toBeNull();
    expect(document.querySelector('.sc')).toBeNull();
  });

  test('Today under an org layout is the very markup a platform page gets', () => {
    component = mount(ContentCard, { target: document.body, props: CONTENT });
    const bare = markup('article.cc');
    unmount(component);
    component = null;
    document.body.innerHTML = '';
    underStyle('today', { content: CONTENT });
    expect(bare).toBeTruthy();
    expect(markup('article.cc')).toBe(bare);
  });

  test('a style: the styled card, in that style, with its dials', () => {
    underStyle(
      'glass-sheet',
      { content: CONTENT },
      { '--card-glass-opacity': '0.5' }
    );
    expect(document.querySelector('.cc')).toBeNull();
    expect(
      document.querySelector('.sc-scope')?.getAttribute('data-card-style')
    ).toBe('glass-sheet');
    const article = document.querySelector<HTMLElement>('article.sc');
    expect(article?.dataset.kind).toBe('video');
    expect(article?.style.getPropertyValue('--card-glass-opacity')).toBe('0.5');
    expect(article?.querySelectorAll('.sc__link')).toHaveLength(1);
  });

  test('a loading card keeps its own skeleton under any style', () => {
    underStyle('glass-sheet', { content: { ...CONTENT, loading: true } });
    expect(document.querySelector('.cc--loading')).not.toBeNull();
    expect(document.querySelector('.sc')).toBeNull();
  });

  test('a revoked card brings its way back, above the link', () => {
    underStyle('glass-sheet', {
      content: { ...CONTENT, accessState: 'revoked' },
    });
    const access = document.querySelector('.sc__controls a.sc__access');
    expect(access?.getAttribute('href')).toBe('/account/subscriptions');
    expect(
      document.querySelector('article.sc')?.hasAttribute('data-dimmed')
    ).toBe(true);
  });

  test("the caller's actions come along", () => {
    const actions = createRawSnippet(() => ({
      render: () => '<button type="button" class="lib-action">Remove</button>',
    }));
    underStyle('glass-sheet', { content: { ...CONTENT, actions } });
    expect(document.querySelector('.sc__controls .lib-action')).not.toBeNull();
  });
});

describe('JourneyEntryCard: the switch', () => {
  test('no card-style context: Today, no styled card', () => {
    component = mount(JourneyEntryCard, {
      target: document.body,
      props: JOURNEY,
    });
    expect(document.querySelector('a.jec')).not.toBeNull();
    expect(document.querySelector('.sc')).toBeNull();
  });

  test('Today under an org layout is the very markup a platform page gets', () => {
    component = mount(JourneyEntryCard, {
      target: document.body,
      props: JOURNEY,
    });
    const bare = markup('a.jec');
    unmount(component);
    component = null;
    document.body.innerHTML = '';
    underStyle('today', { journey: JOURNEY });
    expect(bare).toBeTruthy();
    expect(markup('a.jec')).toBe(bare);
  });

  test('a style: the styled portal card', () => {
    underStyle('cinema', { journey: JOURNEY });
    expect(document.querySelector('.jec')).toBeNull();
    const article = document.querySelector<HTMLElement>('article.sc');
    expect(article?.dataset.kind).toBe('portal');
    expect(article?.querySelector('.sc__link')?.getAttribute('href')).toBe(
      '/journeys/stillness'
    );
    expect(article?.querySelector('.sc__track[data-preview]')).not.toBeNull();
  });
});
