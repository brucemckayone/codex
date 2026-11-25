/**
 * Creator cards follow the org's card style (Codex-7104r.6, plan D4/D8).
 *
 * The creators page's showcase cell and the landing's carousel card read the
 * style from context. Today (the default, and any page with no org layout) is
 * their own markup, unchanged. Any other style draws ONE StyledCard whose
 * whole surface is the card's one action: the drawer's button on the
 * creators page, the creator link in the carousel.
 */
import type { CardStyle } from '@codex/validation';
import type { ComponentProps } from 'svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount } from '$tests/utils/component-test-utils.svelte';
import CardStyleHarness from '../StyledCard/CardStyleHarness.test.svelte';
import type CreatorCard from './CreatorCard.svelte';
import type CreatorCarouselCard from './CreatorCarouselCard.svelte';

let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

function underStyle(
  style: CardStyle,
  card: {
    creator?: ComponentProps<typeof CreatorCard>;
    carousel?: ComponentProps<typeof CreatorCarouselCard>;
  }
) {
  component = mount(CardStyleHarness, {
    target: document.body,
    props: { style, ...card },
  });
}

const SHOWCASE: ComponentProps<typeof CreatorCard> = {
  variant: 'showcase',
  username: 'ada',
  displayName: 'Ada Lovelace',
  avatar: null,
  bio: 'Breathwork and stillness.',
  contentCount: 12,
  role: 'owner',
};

const CAROUSEL: ComponentProps<typeof CreatorCarouselCard> = {
  name: 'Ada Lovelace',
  username: 'ada',
  avatarUrl: null,
  bio: 'Breathwork and stillness.',
  role: 'owner',
};

describe('CreatorCard showcase under a card style', () => {
  test('Today keeps the showcase cell, with no styled card', () => {
    underStyle('today', { creator: SHOWCASE });
    expect(document.querySelector('article.showcase')).not.toBeNull();
    expect(document.querySelector('.sc')).toBeNull();
  });

  test('a style draws one creator card whose one action is the drawer button', () => {
    // currentTarget is only set while the event is dispatched: read it there.
    let target: EventTarget | null = null;
    const onclick = vi.fn((event: MouseEvent) => {
      target = event.currentTarget;
    });
    underStyle('glass-sheet', { creator: { ...SHOWCASE, onclick } });
    expect(document.querySelector('article.showcase')).toBeNull();
    const card = document.querySelector<HTMLElement>(
      '[data-card-style="glass-sheet"] article.sc'
    );
    expect(card?.dataset.kind).toBe('creator');
    const actions = card?.querySelectorAll('.sc__link') ?? [];
    expect(actions).toHaveLength(1);
    const button = actions[0] as HTMLButtonElement;
    expect(button.tagName).toBe('BUTTON');
    expect(card?.querySelector('a')).toBeNull();

    button.click();
    expect(onclick).toHaveBeenCalledTimes(1);
    // The drawer restores focus from the event's current target.
    expect(target).toBe(button);
  });

  test('the styled card keeps the cell’s words: role, name, bio, count', () => {
    underStyle('cinema', { creator: SHOWCASE });
    const card = document.querySelector('article.sc');
    expect(card?.querySelector('.sc__kicker')?.textContent?.trim()).toBe(
      'Owner'
    );
    expect(card?.querySelector('.sc__link')?.textContent?.trim()).toBe(
      'Ada Lovelace'
    );
    expect(card?.querySelector('.sc__desc')?.textContent?.trim()).toBe(
      'Breathwork and stillness.'
    );
    expect(card?.querySelector('[data-m="count"]')?.textContent?.trim()).toBe(
      '12 content items'
    );
    // No avatar: the initial glyph the creator rules expect.
    expect(card?.hasAttribute('data-noimage')).toBe(true);
    expect(
      card?.querySelector('.sc__glyph[data-glyph="initial"] b')?.textContent
    ).toBe('A');
  });

  test('the default and compact variants never switch', () => {
    underStyle('glass-sheet', { creator: { ...SHOWCASE, variant: 'default' } });
    expect(document.querySelector('.sc')).toBeNull();
  });
});

describe('CreatorCarouselCard under a card style', () => {
  test('Today keeps the masthead card, with no styled card', () => {
    underStyle('today', { carousel: CAROUSEL });
    expect(document.querySelector('a.contrib')).not.toBeNull();
    expect(document.querySelector('.sc')).toBeNull();
  });

  test('a style draws one creator card whose one link goes where today’s does', () => {
    underStyle('soft', { carousel: CAROUSEL });
    expect(document.querySelector('a.contrib')).toBeNull();
    const links = document.querySelectorAll<HTMLAnchorElement>(
      'article.sc[data-kind="creator"] .sc__link'
    );
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('/explore?creator=ada');
  });

  test('a creator with no username links to the creators page', () => {
    underStyle('soft', { carousel: { ...CAROUSEL, username: null } });
    expect(document.querySelector('.sc__link')?.getAttribute('href')).toBe(
      '/creators'
    );
  });
});
