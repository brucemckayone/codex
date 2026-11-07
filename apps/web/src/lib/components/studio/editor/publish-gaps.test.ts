/**
 * The Publish step's checklist reads the publish gate's own rules
 * (Codex-a6ofh.2.4): each row is a refusal the server would send.
 */
import { PUBLISH_REFUSAL_CODES } from '@codex/constants';
import { describe, expect, it } from 'vitest';
import * as m from '$paraglide/messages';
import type { DraftValues } from './draft-session.svelte';
import {
  asPublishGap,
  gapRow,
  type PublishFacts,
  publishGaps,
  refusalPutRightBy,
} from './publish-gaps';

const MEDIA = '7e000000-0000-4000-8000-000000000003';
const body = (text: string) =>
  JSON.stringify({
    type: 'doc',
    content: text
      ? [{ type: 'paragraph', content: [{ type: 'text', text }] }]
      : [{ type: 'paragraph' }],
  });

function facts(
  values: Partial<DraftValues> = {},
  rest: Partial<PublishFacts> = {}
): PublishFacts {
  return {
    contentType: 'video',
    values: {
      title: 'Runes deep dive',
      description: null,
      contentBody: null,
      mediaItemId: MEDIA,
      slug: 'runes-deep-dive',
      categoryIds: [],
      tags: [],
      featured: false,
      access: { kind: 'free', priceCents: 0, tierIds: [] },
      thumbnailUrl: null,
      shaderPreset: null,
      ...values,
    },
    needsTitle: false,
    media: { status: 'ready', deleted: false },
    coverDeleted: false,
    connectReady: true,
    organizationId: 'org-1',
    ...rest,
  };
}

describe('publishGaps', () => {
  it('a free video with ready media and a title has nothing missing', () => {
    expect(publishGaps(facts())).toEqual([]);
  });

  it('a video or audio piece needs its media', () => {
    expect(publishGaps(facts({ mediaItemId: null }))).toEqual([
      'MEDIA_REQUIRED',
    ]);
    expect(
      publishGaps(facts({ mediaItemId: null }, { contentType: 'audio' }))
    ).toEqual(['MEDIA_REQUIRED']);
  });

  it('media still being prepared, or deleted, says which', () => {
    expect(
      publishGaps(
        facts({}, { media: { status: 'transcoding', deleted: false } })
      )
    ).toEqual(['MEDIA_NOT_READY']);
    expect(
      publishGaps(facts({}, { media: { status: 'ready', deleted: true } }))
    ).toEqual(['MEDIA_DELETED']);
  });

  it('media not read yet is the server’s to judge', () => {
    expect(publishGaps(facts({}, { media: null }))).toEqual([]);
  });

  it('an article needs something to read, never media', () => {
    const written = { contentType: 'written' as const, media: null };
    expect(
      publishGaps(facts({ mediaItemId: null, contentBody: body('') }, written))
    ).toEqual(['BODY_REQUIRED']);
    expect(
      publishGaps(
        facts({ mediaItemId: null, contentBody: body('Runes.') }, written)
      )
    ).toEqual([]);
  });

  it('an emptied title is missing', () => {
    expect(publishGaps(facts({}, { needsTitle: true }))).toEqual([
      'TITLE_NEEDED',
    ]);
  });

  it('a piece for sale needs a price of at least £1', () => {
    expect(
      publishGaps(
        facts({ access: { kind: 'paid', priceCents: 50, tierIds: [] } })
      )
    ).toEqual(['PRICE_REQUIRED']);
    expect(
      publishGaps(
        facts({ access: { kind: 'paid', priceCents: 100, tierIds: [] } })
      )
    ).toEqual([]);
  });

  it('subscriber content needs a plan ticked; plans never read are the server’s to judge', () => {
    expect(
      publishGaps(
        facts({ access: { kind: 'subscribers', priceCents: 0, tierIds: [] } })
      )
    ).toEqual(['TIER_REQUIRED_TO_PUBLISH']);
    expect(
      publishGaps(
        facts({ access: { kind: 'subscribers', priceCents: 0, tierIds: null } })
      )
    ).toEqual([]);
    // For sale as well: it stays on sale in no plan.
    expect(
      publishGaps(
        facts({ access: { kind: 'subscribers', priceCents: 500, tierIds: [] } })
      )
    ).toEqual([]);
  });

  it('anything that earns needs payouts set up', () => {
    const notReady = { connectReady: false };
    expect(
      publishGaps(
        facts(
          { access: { kind: 'paid', priceCents: 1200, tierIds: [] } },
          notReady
        )
      )
    ).toEqual(['CREATOR_CONNECT_REQUIRED']);
    expect(
      publishGaps(
        facts(
          { access: { kind: 'subscribers', priceCents: 0, tierIds: ['t1'] } },
          notReady
        )
      )
    ).toEqual(['CREATOR_CONNECT_REQUIRED']);
    expect(publishGaps(facts({}, notReady))).toEqual([]);
  });

  it('a cover that is a frame of a deleted video is missing too', () => {
    expect(publishGaps(facts({}, { coverDeleted: true }))).toEqual([
      'THUMBNAIL_MEDIA_DELETED',
    ]);
  });
});

describe('refusalPutRightBy', () => {
  it('a refusal about who can watch goes with a change to who can watch, and only that', () => {
    for (const gap of [
      'PRICE_REQUIRED',
      'TIER_REQUIRED_TO_PUBLISH',
      'CREATOR_CONNECT_REQUIRED',
    ] as const) {
      expect(refusalPutRightBy(gap, 'access')).toBe(true);
      expect(refusalPutRightBy(gap, 'featured')).toBe(false);
    }
  });

  it("the team is the server's to judge: no change here puts it right", () => {
    expect(refusalPutRightBy('NOT_ON_ORG_TEAM', 'access')).toBe(false);
    expect(refusalPutRightBy('NOT_ON_ORG_TEAM', 'featured')).toBe(false);
  });

  it("one in the server's own words may go with any change", () => {
    expect(refusalPutRightBy(null, 'tags')).toBe(true);
  });
});

describe('asPublishGap', () => {
  it('every refusal the gate sends has a row, and so does a missing title', () => {
    for (const code of PUBLISH_REFUSAL_CODES) {
      expect(asPublishGap(code)).toBe(code);
    }
    expect(asPublishGap('TITLE_NEEDED')).toBe('TITLE_NEEDED');
  });

  it('any other code has none: its own words are said instead', () => {
    expect(asPublishGap('BUSINESS_LOGIC_ERROR')).toBeNull();
    expect(asPublishGap('SAVE_SLOW')).toBeNull();
    expect(asPublishGap(undefined)).toBeNull();
  });
});

describe('gapRow', () => {
  const VIDEO = { contentType: 'video' as const, media: null };

  it('says every row, and where it is put right', () => {
    const rows = [...PUBLISH_REFUSAL_CODES, 'TITLE_NEEDED' as const].map(
      (gap) => gapRow(gap, VIDEO)
    );
    for (const row of rows) expect(row.words).not.toBe('');
    expect(Object.fromEntries(rows.map((row) => [row.gap, row.fix]))).toEqual({
      TITLE_NEEDED: 'write',
      MEDIA_REQUIRED: 'write',
      MEDIA_NOT_READY: null,
      MEDIA_DELETED: 'write',
      BODY_REQUIRED: 'write',
      PRICE_REQUIRED: null,
      NOT_ON_ORG_TEAM: null,
      THUMBNAIL_MEDIA_DELETED: null,
      TIER_REQUIRED_TO_PUBLISH: null,
      CREATOR_CONNECT_REQUIRED: 'payouts',
    });
  });

  it('media on its way says how far it has got', () => {
    const preparing = gapRow('MEDIA_NOT_READY', {
      contentType: 'video',
      media: { status: 'transcoding', progress: 64 },
    });
    expect(preparing.words).toBe(
      m.studio_publish_gap_preparing_pct({ type: 'video', pct: 64 })
    );
    expect(
      gapRow('MEDIA_NOT_READY', {
        contentType: 'audio',
        media: { status: 'uploading', progress: null },
      }).words
    ).toBe(m.studio_publish_gap_uploading({ type: 'audio' }));
  });

  it('media that failed is put right on the Write step', () => {
    expect(
      gapRow('MEDIA_NOT_READY', {
        contentType: 'video',
        media: { status: 'failed', progress: null },
      })
    ).toMatchObject({
      words: m.studio_publish_gap_media_failed({ type: 'video' }),
      fix: 'write',
    });
  });

  it('the price row names the minimum in pounds', () => {
    expect(gapRow('PRICE_REQUIRED', VIDEO).words).toBe(
      m.studio_publish_gap_price({ price: '£1.00' })
    );
  });
});
