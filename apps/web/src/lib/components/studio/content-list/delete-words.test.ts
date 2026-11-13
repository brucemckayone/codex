/**
 * The Delete dialog's Unpublish instead (Codex-a6ofh.3.5, owner D-b4,
 * Codex-dz997): offered only where the people who have a piece keep it.
 */
import { describe, expect, it } from 'vitest';
import * as m from '$paraglide/messages';
import { type DeletePiece, heldNotice, unpublishOffer } from './delete-words';

function held(id: string, fields: Partial<DeletePiece> = {}): DeletePiece {
  return {
    id,
    title: `Piece ${id}`,
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

  it('names which ones, in a mix, so the creator can tell what goes', () => {
    // One of each: each by its title, never "it" for one of two.
    expect(unpublishOffer([held('a'), freeLesson('c')])).toEqual({
      ids: ['a'],
      words: `${m.studio_content_delete_unpublish_keeps_named({ title: 'Piece a' })} ${m.studio_content_delete_unpublish_ends_named({ title: 'Piece c' })}`,
    });
    // A few: by their titles.
    const offer = unpublishOffer([
      held('a'),
      held('b'),
      freeLesson('c'),
      freeLesson('d'),
    ]);
    expect(offer.ids).toEqual(['a', 'b']);
    expect(offer.words).toBe(
      `${m.studio_content_delete_unpublish_keeps_named_many({ titles: '“Piece a” and “Piece b”' })} ${m.studio_content_delete_unpublish_ends_named_many({ titles: '“Piece c” and “Piece d”' })}`
    );
  });

  it('counts them past a few', () => {
    const many = ['a', 'b', 'c', 'd'].map((id) => held(id));
    const offer = unpublishOffer([...many, freeLesson('e')]);
    expect(offer.words).toBe(
      `${m.studio_content_delete_unpublish_keeps_some({ count: 4 })} ${m.studio_content_delete_unpublish_ends_named({ title: 'Piece e' })}`
    );
  });

  it('says nothing of unpublishing a draft', () => {
    expect(
      unpublishOffer([held('a', { status: 'draft' }), freeLesson('b')])
    ).toEqual({
      ids: [],
      // Only the live one is weighed; beside a draft, it is named.
      words: m.studio_content_delete_unpublish_ends_named({ title: 'Piece b' }),
    });
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
      title: m.studio_content_delete_kept_one_title({ title: 'Piece a' }),
      body: m.studio_content_delete_kept_one_body({ count: 3 }),
    });
    expect(heldNotice('many', [held('a'), held('b')], null)).toEqual({
      title: m.studio_content_delete_kept_title({ count: 2 }),
      body: m.studio_content_delete_kept_body(),
    });
  });

  it('is nothing when nobody has any of them', () => {
    expect(heldNotice('many', [], null)).toBeNull();
  });
});
