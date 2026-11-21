/**
 * The Delete dialog's words (Codex-a6ofh.6, mockup leaving-notice.html LN1,
 * LN2): a piece people own leaves on its date, its owners emailed; Unpublish
 * instead only where unpublishing keeps it for them (Codex-dz997).
 */
import { describe, expect, it } from 'vitest';
import { formatSentenceDate } from '$lib/utils/format';
import * as m from '$paraglide/messages';
import { joinNames } from '../plan-picker/select-from-tier';
import {
  type DeletePiece,
  deletedWords,
  manyNotice,
  oneNotice,
  tooWords,
  unknownWords,
} from './delete-words';

const LEAVES_ON = new Date('2026-12-20T10:00:00.000Z');
const date = formatSentenceDate(LEAVES_ON);

function held(id: string, fields: Partial<DeletePiece> = {}): DeletePiece {
  return {
    id,
    title: `Piece ${id}`,
    slug: `piece-${id}`,
    status: 'published',
    holderCount: 57,
    courseOnly: false,
    isTeamOnly: false,
    isFollowerGated: false,
    isTierGated: false,
    priceCents: 499,
    ownersCanDownload: true,
    ...fields,
  };
}

const nobodys = (id: string, fields: Partial<DeletePiece> = {}) =>
  held(id, { holderCount: 0, ...fields });

/** A free lesson in a paid course: its course buyers own it. */
const freeLesson = (id: string) => held(id, { priceCents: null });

describe('oneNotice (LN1)', () => {
  it('says who owns it, when it leaves, and offers Unpublish instead (the mockup)', () => {
    expect(oneNotice(held('a'), LEAVES_ON)).toEqual({
      title: m.studio_leaving_delete_owners({ count: 57 }),
      body: m.studio_leaving_delete_body_download({ date }),
      aside: `${m.studio_leaving_delete_keep_any_time({ date })} ${m.studio_leaving_delete_unpublish_instead()}`,
      unpublish: true,
    });
  });

  it('counts one owner as one', () => {
    expect(oneNotice(held('a', { holderCount: 1 }), LEAVES_ON)?.title).toBe(
      m.studio_leaving_delete_owners_one()
    );
  });

  it('says watch, never download, when the creator turned downloads off (N1-B)', () => {
    expect(
      oneNotice(held('a', { ownersCanDownload: false }), LEAVES_ON)?.body
    ).toBe(m.studio_leaving_delete_body_watch({ date }));
  });

  it('never offers Unpublish instead for a Free piece, and says it would end it too', () => {
    expect(oneNotice(freeLesson('a'), LEAVES_ON)).toMatchObject({
      aside: `${m.studio_leaving_delete_keep_any_time({ date })} ${m.studio_content_delete_unpublish_ends_it()}`,
      unpublish: false,
    });
  });

  it('says nothing of unpublishing a piece already off sale', () => {
    expect(
      oneNotice(held('a', { status: 'archived' }), LEAVES_ON)
    ).toMatchObject({
      aside: m.studio_leaving_delete_keep_any_time({ date }),
      unpublish: false,
    });
  });

  it('is nothing for a piece nobody owns: today’s words, deleted at once', () => {
    expect(oneNotice(nobodys('a'), LEAVES_ON)).toBeNull();
  });
});

describe('manyNotice (LN2)', () => {
  it('says how many go now, and names the ones that leave (the mockup)', () => {
    const notice = manyNotice(
      [nobodys('a'), nobodys('b'), nobodys('c'), held('d'), held('e')],
      LEAVES_ON
    );
    expect(notice).toEqual({
      going: m.studio_leaving_delete_going({ count: 3 }),
      leaving: {
        title: m.studio_leaving_delete_leave_title({ count: 2, date }),
        body: m.studio_leaving_delete_leave_many_download({
          titles: joinNames(['“Piece d”', '“Piece e”']),
        }),
      },
    });
  });

  it('never sums owners: one course’s buyers are in every lesson’s count', () => {
    const notice = manyNotice(
      [held('d'), held('e', { holderCount: 3 })],
      LEAVES_ON
    );
    // Their owners, never "60 owners".
    expect(notice.leaving?.body).toBe(
      m.studio_leaving_delete_leave_many_download({
        titles: joinNames(['“Piece d”', '“Piece e”']),
      })
    );
    expect(notice.going).toBeNull();
  });

  it('one that leaves is named alone; one going now beside it reads as one', () => {
    expect(manyNotice([nobodys('a'), held('d')], LEAVES_ON)).toEqual({
      going: m.studio_leaving_delete_going_one(),
      leaving: {
        title: m.studio_leaving_delete_leave_title_one({ date }),
        body: m.studio_leaving_delete_leave_one_download({ name: '“Piece d”' }),
      },
    });
  });

  it('says watch for them all when any of them turned downloads off', () => {
    const notice = manyNotice(
      [held('d'), held('e', { ownersCanDownload: false })],
      LEAVES_ON
    );
    expect(notice.leaving?.body).toBe(
      m.studio_leaving_delete_leave_many_watch({
        titles: joinNames(['“Piece d”', '“Piece e”']),
      })
    );
  });

  it('keeps today’s words when nobody owns any of them', () => {
    expect(manyNotice([nobodys('a'), nobodys('b')], LEAVES_ON)).toEqual({
      going: m.studio_content_delete_many_body({ count: 2 }),
      leaving: null,
    });
    expect(manyNotice([nobodys('a')], LEAVES_ON).going).toBe(
      m.studio_content_delete_many_body_one()
    );
  });

  it('gives a title a deleted piece shares with a leaving one its address', () => {
    const going = nobodys('o', { title: 'Introduction', slug: 'intro-old' });
    const leaving = held('b', { title: 'Introduction', slug: 'intro' });
    expect(manyNotice([going, leaving], LEAVES_ON).leaving?.body).toBe(
      m.studio_leaving_delete_leave_one_download({
        name: '“Introduction” (/intro)',
      })
    );
  });
});

describe('deletedWords', () => {
  it('says a deleted piece is deleted, and one already gone too', () => {
    const deleted = m.studio_content_deleted_one({ title: 'A' });
    expect(
      deletedWords('A', { outcome: 'deleted', leavesAt: null, holders: 0 })
    ).toBe(deleted);
    expect(deletedWords('A', null)).toBe(deleted);
  });

  it('says when a leaving piece goes, and that its owners are emailed', () => {
    const leavesAt = LEAVES_ON.toISOString();
    const leaving = {
      outcome: 'leaving',
      leavesAt,
      started: true,
      leavingByCreator: true,
      leavingByOrg: false,
    } as const;
    expect(deletedWords('A', { ...leaving, holders: 57 })).toBe(
      m.studio_leaving_deleted({ title: 'A', date, count: 57 })
    );
    expect(deletedWords('A', { ...leaving, holders: 1 })).toBe(
      m.studio_leaving_deleted_one_owner({ title: 'A', date })
    );
  });

  // A delete that only added its side (design §4) emailed nobody.
  it('says a delete beside the org’s leaves even if the org keeps it, nobody emailed again', () => {
    const leavesAt = LEAVES_ON.toISOString();
    const words = deletedWords('A', {
      outcome: 'leaving',
      leavesAt,
      holders: 57,
      started: false,
      leavingByCreator: true,
      leavingByOrg: true,
    });
    expect(words).toBe(m.studio_leaving_deleted_too({ title: 'A', date }));
    expect(words).not.toMatch(/emailed/);
  });

  // Review round 2: a repeat of the creator's own (a second tab) names no org.
  it('says a repeat of the creator’s own delete was already leaving, naming no org', () => {
    const leavesAt = LEAVES_ON.toISOString();
    const words = deletedWords('A', {
      outcome: 'leaving',
      leavesAt,
      holders: 57,
      started: false,
      leavingByCreator: true,
      leavingByOrg: false,
    });
    expect(words).toBe(m.studio_leaving_deleted_again({ title: 'A', date }));
    expect(words).not.toMatch(/org/);
  });
});

describe('unknownWords', () => {
  it('says what a delete does either way, never that nobody owns it', () => {
    const words = unknownWords(LEAVES_ON);
    expect(words).toBe(m.studio_leaving_delete_unknown({ date }));
    expect(words).not.toBe(m.studio_content_delete_one_body());
  });
});

// "Delete it too" (owner 2026-11-20): a leave only the org's delete holds.
describe('tooWords', () => {
  it('says its owners were already told, never that they are emailed today', () => {
    const words = tooWords(LEAVES_ON.toISOString());
    expect(words).toBe(m.studio_leaving_delete_too_body({ date }));
    expect(words).toMatch(/already told/);
    expect(words).not.toMatch(/emailed today/);
  });
});
