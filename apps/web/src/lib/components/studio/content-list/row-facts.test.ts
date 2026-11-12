/**
 * The content list's words for one piece (Codex-a6ofh.3.1, mockup L1).
 */
import { describe, expect, it } from 'vitest';
import type { ContentWithRelations } from '$lib/types';
import * as m from '$paraglide/messages';
import {
  draftRow,
  LIVE,
  MEDIA_ID,
  PAID,
  withMedia,
} from '../__fixtures__/draft-row';
import {
  accessWords,
  categoryWords,
  rowLine,
  salesShown,
  viewsShown,
} from './row-facts';

const TIERS: Record<string, string> = { t1: 'Standard', t2: 'Pro' };
const known = (id: string) => TIERS[id];
const unread = () => undefined;

/** Its media as listed, with the transcode's % as the row was read. */
function media(
  status: string,
  fields: { transcodingProgress?: number | null; deletedAt?: Date | null } = {}
): Partial<ContentWithRelations> {
  return {
    mediaItemId: MEDIA_ID,
    mediaItem: {
      id: MEDIA_ID,
      status,
      deletedAt: fields.deletedAt ?? null,
      transcodingProgress: fields.transcodingProgress ?? null,
    } as never,
  };
}

describe('accessWords', () => {
  it('says Free, and nothing more, for a free piece', () => {
    expect(accessWords(draftRow(), known)).toEqual({
      label: 'Free',
      detail: null,
    });
  });

  it('gives a one-time purchase its price in pounds', () => {
    expect(accessWords(draftRow({ ...PAID, priceCents: 499 }), known)).toEqual({
      label: '£4.99',
      detail: m.studio_content_form_access_paid(),
    });
  });

  it('names the tiers that open a subscribers piece', () => {
    const row = draftRow({
      isFree: false,
      isTierGated: true,
      includedInTierIds: ['t2'],
    });
    expect(accessWords(row, known)).toEqual({
      label: 'Subscribers',
      detail: 'Pro',
    });
  });

  it('never names a partial set while the tiers are unread', () => {
    const row = draftRow({
      isFree: false,
      isTierGated: true,
      includedInTierIds: ['t1', 't2'],
    });
    expect(accessWords(row, unread)).toEqual({
      label: 'Subscribers',
      detail: null,
    });
  });

  it('never names only the tiers it knows: an inactive one reads as the whole set', () => {
    // `listTiers` lists active plans; a row's set includes inactive ones.
    const row = draftRow({
      isFree: false,
      isTierGated: true,
      includedInTierIds: ['t2', 'retired'],
    });
    expect(accessWords(row, known).detail).toBeNull();
  });

  it('calls a gated piece with no tier ticked closed, never free', () => {
    const row = draftRow({
      isFree: false,
      isTierGated: true,
      includedInTierIds: [],
    });
    expect(accessWords(row, known).detail).toBe(
      m.studio_content_list_access_no_tier()
    );
  });

  it('says a piece for sale and in a tier is either', () => {
    const row = draftRow({
      ...PAID,
      priceCents: 999,
      isTierGated: true,
      includedInTierIds: ['t1'],
    });
    expect(accessWords(row, known)).toEqual({
      label: '£9.99 or Standard',
      detail: m.studio_content_list_access_purchase_and_tier(),
    });
    // Unread tiers: the price alone, still said to be both.
    expect(accessWords(row, unread)).toEqual({
      label: '£9.99',
      detail: m.studio_content_list_access_purchase_and_tier(),
    });
  });

  it('says a paid piece off sale keeps its buyers', () => {
    const row = draftRow({
      ...PAID,
      priceCents: 999,
      ...LIVE,
      status: 'archived',
    });
    expect(accessWords(row, known)).toEqual({
      label: '£9.99',
      detail: m.studio_content_list_access_buyers_keep(),
    });
  });

  it('says what following costs, and that the team is all', () => {
    expect(
      accessWords(draftRow({ isFree: false, isFollowerGated: true }), known)
    ).toEqual({
      label: 'Followers',
      detail: 'Free to follow',
    });
    expect(
      accessWords(draftRow({ isFree: false, isTeamOnly: true }), known)
    ).toEqual({
      label: m.studio_content_form_access_team(),
      detail: null,
    });
  });
});

describe('views and sales', () => {
  it('counts nothing for a draft that has never been live', () => {
    const row = draftRow({ ...PAID, viewCount: 3, purchaseCount: 1 } as never);
    expect(viewsShown(row)).toBeNull();
    expect(salesShown(row)).toBeNull();
  });

  it('counts views for any live piece, grouped as the UK writes them', () => {
    expect(viewsShown(draftRow({ ...LIVE, viewCount: 1204 } as never))).toBe(
      '1,204'
    );
    expect(viewsShown(draftRow({ ...LIVE, viewCount: 0 } as never))).toBe('0');
  });

  it('counts sales only for a piece that can be bought', () => {
    expect(
      salesShown(draftRow({ ...LIVE, purchaseCount: 57 } as never))
    ).toBeNull();
    expect(
      salesShown(draftRow({ ...LIVE, ...PAID, purchaseCount: 57 } as never))
    ).toBe('57');
  });

  it('keeps counting an off-sale piece', () => {
    const row = draftRow({
      ...LIVE,
      ...PAID,
      status: 'archived',
      viewCount: 2180,
      purchaseCount: 96,
    } as never);
    expect(viewsShown(row)).toBe('2,180');
    expect(salesShown(row)).toBe('96');
  });
});

describe('rowLine', () => {
  it('shows a draft its progress, with the transcode as far as it had got', () => {
    const line = rowLine(
      draftRow(media('transcoding', { transcodingProgress: 64 })),
      'ready'
    );
    expect(line?.kind).toBe('progress');
    if (line?.kind !== 'progress') return;
    expect(line.progress.left.map((gap) => gap.words)).toContain(
      m.studio_publish_gap_preparing_pct({ type: 'video', pct: 64 })
    );
  });

  it('says a draft whose media was deleted needs another', () => {
    const line = rowLine(draftRow(withMedia('ready', new Date())), 'ready');
    expect(line?.kind).toBe('progress');
    if (line?.kind !== 'progress') return;
    expect(line.progress.left[0]?.words).toBe(
      m.studio_publish_gap_media_deleted({ type: 'video' })
    );
  });

  it('calls a draft with nothing left ready to publish', () => {
    const line = rowLine(
      draftRow({ contentType: 'written', contentBody: 'Body', title: 'Notes' }),
      'ready'
    );
    expect(line?.kind === 'progress' && line.progress.ready).toBe(true);
  });

  it('says a scheduled draft goes live when ready, with its %', () => {
    // On the wire a timestamp is a string; the row type says Date.
    const scheduled: Partial<ContentWithRelations> = {
      publishRequestedAt: new Date().toISOString() as never,
    };
    expect(
      rowLine(
        draftRow({
          ...media('transcoding', { transcodingProgress: 40 }),
          ...scheduled,
        }),
        'ready'
      )
    ).toEqual({
      kind: 'scheduled',
      words: m.studio_content_list_scheduled_pct({ pct: 40 }),
    });
    expect(
      rowLine(draftRow({ ...media('uploaded'), ...scheduled }), 'ready')
    ).toEqual({
      kind: 'scheduled',
      words: m.studio_publish_scheduled_heading(),
    });
  });

  it('says why a scheduled attempt didn’t go live', () => {
    const line = rowLine(
      draftRow({ publishBlockedReason: 'MEDIA_FAILED' } as never),
      'ready'
    );
    expect(line?.kind).toBe('blocked');
  });

  it('puts a live schedule before the reason an earlier one was refused', () => {
    const row = draftRow({
      ...media('transcoding'),
      publishRequestedAt: new Date().toISOString(),
      publishBlockedReason: 'MEDIA_FAILED',
    } as never);
    expect(rowLine(row, 'ready')?.kind).toBe('scheduled');
  });

  it('warns about a live piece whose media was deleted or failed for good', () => {
    expect(
      rowLine(draftRow({ ...LIVE, ...withMedia('ready', new Date()) }), 'ready')
    ).toEqual({
      kind: 'media',
      words: m.studio_publish_gap_media_deleted({ type: 'video' }),
    });
    expect(
      rowLine(draftRow({ ...LIVE, ...withMedia('failed') }), 'ready')?.kind
    ).toBe('media');
  });

  it('says nothing under a live piece whose media is fine', () => {
    expect(
      rowLine(draftRow({ ...LIVE, ...withMedia('ready') }), 'ready')
    ).toBeNull();
  });

  it('says nothing for a type the editor does not know', () => {
    expect(
      rowLine(draftRow({ contentType: 'pdf' } as never), 'ready')
    ).toBeNull();
  });
});

/** A row's categories (Codex-a6ofh.3.3, owner 2026-11-12): "First +N". */
describe('categoryWords', () => {
  const named = (...names: string[]) =>
    names.map((name, i) => ({
      id: `7c000000-0000-4000-8000-00000000000${i}`,
      name,
    }));

  it('one category reads its name', () => {
    expect(categoryWords(draftRow({ categories: named('Tutorials') }))).toEqual(
      {
        shown: 'Tutorials',
        all: 'Tutorials',
      }
    );
  });

  it('several read the first and how many more, and say every name', () => {
    expect(
      categoryWords(draftRow({ categories: named('Tutorials', 'Live', 'Q&A') }))
    ).toEqual({
      shown: m.studio_content_categories_more({ name: 'Tutorials', count: 2 }),
      all: 'Tutorials, Live, Q&A',
    });
  });

  it('none, or none sent, is nothing', () => {
    expect(categoryWords(draftRow({ categories: [] }))).toBeNull();
    expect(categoryWords(draftRow())).toBeNull();
  });
});
