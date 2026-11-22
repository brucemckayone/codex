/**
 * The Delete dialog's Unpublish instead (Codex-a6ofh.3.5, owner D-b4,
 * Codex-dz997): offered only where the people who have a piece keep it.
 */
import { describe, expect, it } from 'vitest';
import * as m from '$paraglide/messages';
import { joinNames } from '../plan-picker/select-from-tier';
import { type DeletePiece, heldNotice, unpublishOffer } from './delete-words';

function held(id: string, fields: Partial<DeletePiece> = {}): DeletePiece {
  return {
    id,
    title: `Piece ${id}`,
    slug: `piece-${id}`,
    status: 'published',
    holderCount: 3,
    courseOnly: false,
    isTeamOnly: false,
    isFollowerGated: false,
    isTierGated: false,
    priceCents: 800,
    ...fields,
  };
}

/** A free lesson in a paid course: its course buyers have it. */
const freeLesson = (id: string) => held(id, { priceCents: null });

describe('unpublishOffer', () => {
  it('offers a priced piece: its people keep watching', () => {
    expect(unpublishOffer([held('a')])).toEqual({
      ids: ['a'],
      words: m.studio_content_delete_unpublish_keeps_it(),
    });
  });

  it('never offers a Free piece, and says unpublishing ends it too', () => {
    expect(unpublishOffer([freeLesson('a')])).toEqual({
      ids: [],
      words: m.studio_content_delete_unpublish_ends_it(),
    });
    expect(unpublishOffer([freeLesson('a'), freeLesson('b')])).toEqual({
      ids: [],
      words: m.studio_content_delete_unpublish_ends_them(),
    });
  });

  it('when every one is kept, they keep it; "them" is all of them', () => {
    expect(unpublishOffer([held('a'), held('b')])).toEqual({
      ids: ['a', 'b'],
      words: m.studio_content_delete_unpublish_keeps_them(),
    });
  });

  it('in a mix, names the ones that stay up first, then the ones the button takes down', () => {
    // One of each: each by its title; the button's "it" is the last named.
    expect(unpublishOffer([held('a'), freeLesson('c')])).toEqual({
      ids: ['a'],
      words: `${m.studio_content_delete_unpublish_ends_named_stays({ name: '“Piece c”' })} ${m.studio_content_delete_unpublish_keeps_named({ name: '“Piece a”' })}`,
    });
    const offer = unpublishOffer([
      held('a'),
      held('b'),
      freeLesson('c'),
      freeLesson('d'),
    ]);
    expect(offer.ids).toEqual(['a', 'b']);
    expect(offer.words).toBe(
      `${m.studio_content_delete_unpublish_ends_named_many_stays({ titles: joinNames(['“Piece c”', '“Piece d”']) })} ${m.studio_content_delete_unpublish_keeps_named_many({ titles: joinNames(['“Piece a”', '“Piece b”']) })}`
    );
  });

  it('names every piece, however many, so two groups never read alike', () => {
    // Four of each (a selection holds up to 15): never "4 of them" twice.
    const keeps = ['a', 'b', 'c', 'd'].map((id) => held(id));
    const ends = ['e', 'f', 'g', 'h'].map((id) => freeLesson(id));
    const offer = unpublishOffer([...keeps, ...ends]);
    const titles = (ids: string[]) =>
      joinNames(ids.map((id) => `“Piece ${id}”`));
    expect(offer.ids).toEqual(['a', 'b', 'c', 'd']);
    expect(offer.words).toBe(
      `${m.studio_content_delete_unpublish_ends_named_many_stays({ titles: titles(['e', 'f', 'g', 'h']) })} ${m.studio_content_delete_unpublish_keeps_named_many({ titles: titles(['a', 'b', 'c', 'd']) })}`
    );
    // Beside a draft, the live ones are named, not counted.
    expect(
      unpublishOffer([...keeps, held('z', { status: 'draft' })]).words
    ).toBe(
      m.studio_content_delete_unpublish_keeps_named_many({
        titles: titles(['a', 'b', 'c', 'd']),
      })
    );
  });

  it('gives a shared title its address, so two of a name never read alike', () => {
    const paid = held('p', { title: 'Introduction', slug: 'intro-paid' });
    const free = held('f', {
      title: 'Introduction',
      slug: 'intro-free',
      priceCents: null,
    });
    expect(unpublishOffer([paid, free, held('a')])).toEqual({
      ids: ['p', 'a'],
      words: `${m.studio_content_delete_unpublish_ends_named_stays({ name: '“Introduction” (/intro-free)' })} ${m.studio_content_delete_unpublish_keeps_named_many({ titles: joinNames(['“Introduction” (/intro-paid)', '“Piece a”']) })}`,
    });
  });

  it('gives a title shared with a deleted piece its address too', () => {
    const kept = held('b', { title: 'Introduction', slug: 'intro' });
    const going = held('o', {
      title: 'Introduction',
      slug: 'intro-old',
      holderCount: 0,
    });
    // The deleted one is weighed for names only: nobody has it.
    expect(unpublishOffer([going, kept, freeLesson('c')])).toEqual({
      ids: ['b'],
      words: `${m.studio_content_delete_unpublish_ends_named_stays({ name: '“Piece c”' })} ${m.studio_content_delete_unpublish_keeps_named({ name: '“Introduction” (/intro)' })}`,
    });
    expect(heldNotice('many', [going, kept], null)?.title).toBe(
      m.studio_content_delete_kept_one_title({
        name: '“Introduction” (/intro)',
      })
    );
  });

  it('says nothing of unpublishing a draft', () => {
    expect(
      unpublishOffer([held('a', { status: 'draft' }), freeLesson('b')])
    ).toEqual({
      ids: [],
      // Only the live one is weighed; beside a draft, it is named.
      words: m.studio_content_delete_unpublish_ends_named({
        name: '“Piece b”',
      }),
    });
    // Two that would lose it, beside a draft: by name, both of them.
    expect(
      unpublishOffer([
        held('z', { status: 'draft' }),
        freeLesson('b'),
        freeLesson('c'),
      ]).words
    ).toBe(
      m.studio_content_delete_unpublish_ends_named_many({
        titles: joinNames(['“Piece b”', '“Piece c”']),
      })
    );
    expect(unpublishOffer([held('a', { status: 'draft' })])).toEqual({
      ids: [],
      words: null,
    });
  });
});

describe('heldNotice', () => {
  const ends = m.studio_content_delete_unpublish_ends_it();

  it('the row menu says by how many people, then what unpublishing does', () => {
    expect(heldNotice('one', [freeLesson('a')], ends)).toEqual({
      title: m.studio_content_delete_bought_title({ count: 3 }),
      body: `${m.studio_content_delete_bought_body()} ${ends}`,
    });
    expect(
      heldNotice('one', [held('a', { holderCount: 1 })], null)?.title
    ).toBe(m.studio_content_delete_bought_title_one());
  });

  it('the bulk bar names the one it leaves alone, or counts them', () => {
    expect(heldNotice('many', [held('a')], null)).toEqual({
      title: m.studio_content_delete_kept_one_title({ name: '“Piece a”' }),
      body: m.studio_content_delete_kept_one_body({ count: 3 }),
    });
    expect(heldNotice('many', [held('a'), held('b')], null)).toEqual({
      title: m.studio_content_delete_kept_title({ count: 2 }),
      body: m.studio_content_delete_kept_body(),
    });
  });

  it('is nothing when nobody has any of them', () => {
    expect(heldNotice('many', [], null)).toBeNull();
    expect(
      heldNotice('many', [held('a', { holderCount: 0 })], null)
    ).toBeNull();
    expect(unpublishOffer([held('a', { holderCount: 0 })])).toEqual({
      ids: [],
      words: null,
    });
  });
});
