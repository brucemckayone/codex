/**
 * creatorToCard (Codex-7104r.6): a creator as one card, with the words the
 * creator cards use today. Avatar → image (or none: the initial glyph), role →
 * kicker, name → the one action, bio → description, count → a meta fact.
 */
import { describe, expect, it } from 'vitest';
import { creatorToCard } from './creator-card';

const BASE = {
  name: 'Ada Lovelace',
  action: { href: '/explore?creator=ada' },
} as const;

describe('creatorToCard', () => {
  it('is a creator tile whose title is the name and whose action is the given one', () => {
    const card = creatorToCard(BASE);
    expect(card).toMatchObject({
      kind: 'creator',
      layout: 'tile',
      title: 'Ada Lovelace',
      action: { href: '/explore?creator=ada' },
      image: null,
      desc: null,
      meta: [],
      cta: 'View profile',
    });
    expect(card.badge).toBeUndefined();
    expect(card.price).toBeUndefined();
    expect(card.progress).toBeUndefined();
  });

  it.each([
    ['owner', 'Owner'],
    ['admin', 'Admin'],
    ['creator', 'Creator'],
    ['member', 'Creator'],
    [null, 'Creator'],
  ])('words the %s role as %s', (role, word) => {
    expect(creatorToCard({ ...BASE, role }).kicker).toBe(word);
  });

  it('counts content the way the cards do, and shows no count at zero', () => {
    expect(creatorToCard({ ...BASE, contentCount: 1 }).meta).toEqual([
      { key: 'count', text: '1 content item' },
    ]);
    expect(creatorToCard({ ...BASE, contentCount: 12 }).meta).toEqual([
      { key: 'count', text: '12 content items' },
    ]);
    expect(creatorToCard({ ...BASE, contentCount: 0 }).meta).toEqual([]);
  });

  it('keeps a bio, trimmed; a blank one is none', () => {
    expect(creatorToCard({ ...BASE, bio: '  Stillness.  ' }).desc).toBe(
      'Stillness.'
    );
    expect(creatorToCard({ ...BASE, bio: '   ' }).desc).toBeNull();
  });

  it('draws an avatar whose folder does not record its size from one file', () => {
    const image = creatorToCard({
      ...BASE,
      avatarUrl: 'https://cdn.example/avatars/u1/lg.webp',
      fallbackSize: 'md',
    }).image;
    expect(image?.src).toContain('md.webp');
    expect(image?.ratio).toBeUndefined();
    expect(image?.srcset).toBeUndefined();
  });

  it('takes a button action for the creators page drawer', () => {
    const onclick = () => {};
    expect(creatorToCard({ ...BASE, action: { onclick } }).action).toEqual({
      onclick,
    });
  });
});
