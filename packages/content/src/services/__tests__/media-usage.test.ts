/**
 * The media usage lookup's pure parts (Codex-6sbn1), with no database: the
 * schema guard that keeps every media FK classified, the fingerprint, the
 * naming rule, the delete guard's order, and the refusals' public payloads.
 */

import * as schema from '@codex/database/schema';
import { mapErrorToResponse } from '@codex/service-errors';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  MediaDeletedError,
  MediaInUseError,
  MediaUsageChangedError,
} from '../../errors';
import {
  assertMediaDeletable,
  MEDIA_REFERENCE_COLUMNS,
  MEDIA_USES_CAP,
  type MediaUseRow,
  mediaUsageFingerprint,
  summariseMediaUsage,
} from '../media-usage';

const CALLER = 'caller-user';

function row(overrides: Partial<MediaUseRow> = {}): MediaUseRow {
  return {
    media_id: 'm1',
    source: 'content',
    slot: 'media',
    owner_id: 'c1',
    title: 'A film',
    content_type: 'video',
    org_id: 'o1',
    org_name: 'Hollow Oak Films',
    org_slug: 'hollow-oak',
    owner_user: CALLER,
    live: false,
    live_reason: null,
    page_id: null,
    caller_role: null,
    ...overrides,
  };
}

/** Every column of every table whose foreign key points at media_items.id. */
function mediaForeignKeyColumns(): string[] {
  const found: string[] = [];
  for (const value of Object.values(schema)) {
    let config: ReturnType<typeof getTableConfig>;
    try {
      config = getTableConfig(value as PgTable);
    } catch {
      continue; // not a table: a relation, an enum, a type
    }
    if (!config?.foreignKeys) continue;
    for (const fk of config.foreignKeys) {
      const ref = fk.reference();
      if (getTableConfig(ref.foreignTable).name !== 'media_items') continue;
      for (const column of ref.columns) {
        found.push(`${config.name}.${column.name}`);
      }
    }
  }
  return found.sort();
}

describe('every media foreign key is classified', () => {
  it('finds the known references (the probe is calibrated)', () => {
    const columns = mediaForeignKeyColumns();
    expect(columns).toContain('content.media_item_id');
    expect(columns).toContain('courses.signature_media_id');
  });

  it('lists each one as blocking or ignored-with-a-reason, and nothing stale', () => {
    expect(mediaForeignKeyColumns()).toEqual(
      Object.keys(MEDIA_REFERENCE_COLUMNS).sort()
    );
    for (const value of Object.values(MEDIA_REFERENCE_COLUMNS)) {
      if (value !== 'blocking') expect(value.ignored.length).toBeGreaterThan(0);
    }
  });
});

describe('mediaUsageFingerprint', () => {
  const a = row({ owner_id: 'c1' });
  const b = row({ source: 'course', slot: 'reel', owner_id: 'k1' });

  it('is the same for the same uses in any order', async () => {
    expect(await mediaUsageFingerprint([a, b])).toBe(
      await mediaUsageFingerprint([b, a])
    );
  });

  it('changes when a use is added, or goes live', async () => {
    const base = await mediaUsageFingerprint([a]);
    expect(await mediaUsageFingerprint([a, b])).not.toBe(base);
    expect(
      await mediaUsageFingerprint([
        { ...a, live: true, live_reason: 'published' },
      ])
    ).not.toBe(base);
  });

  it('is a short url-safe token', async () => {
    expect(await mediaUsageFingerprint([])).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('summariseMediaUsage', () => {
  it('names only what the caller can see, and counts the rest as hidden', async () => {
    const usage = await summariseMediaUsage(
      [
        // Someone else's draft in an org the caller only creates in.
        row({ owner_id: 'c9', owner_user: 'other', caller_role: 'creator' }),
        // Someone else's draft in an org the caller runs: named, but the
        // caller can't change content that isn't theirs.
        row({
          owner_id: 'c8',
          owner_user: 'other',
          caller_role: 'admin',
          title: 'Their draft',
        }),
        // Someone else's LIVE content: published titles are public.
        row({
          owner_id: 'c7',
          owner_user: 'other',
          live: true,
          live_reason: 'bought',
          title: 'Their released film',
        }),
      ],
      CALLER
    );
    expect(usage).toMatchObject({ total: 3, live: 1, drafts: 2, hidden: 1 });
    expect(usage.uses.map((use) => [use.title, use.link])).toEqual([
      ['Their released film', null],
      ['Their draft', null],
    ]);
  });

  it('links each use to where the caller can replace it', async () => {
    const usage = await summariseMediaUsage(
      [
        row({ owner_id: 'c1', org_slug: null, org_name: null }),
        row({
          source: 'course',
          slot: 'intro',
          owner_id: 'k1',
          content_type: null,
          caller_role: 'owner',
          page_id: 'p1',
          title: 'A course',
        }),
        row({
          source: 'course',
          slot: 'hero',
          owner_id: 'k2',
          content_type: null,
          owner_user: 'other',
          caller_role: 'creator',
          live: true,
          live_reason: 'published',
          page_id: 'p2',
          title: 'Their course',
        }),
        row({
          source: 'org_intro',
          slot: 'org_intro',
          owner_id: 'o1',
          content_type: null,
          owner_user: null,
          caller_role: 'admin',
          live: true,
          live_reason: 'always',
          title: 'Hollow Oak Films',
        }),
      ],
      CALLER
    );
    expect(usage.uses).toEqual([
      {
        kind: 'course',
        slot: 'hero',
        live: true,
        liveReason: 'published',
        title: 'Their course',
        orgName: 'Hollow Oak Films',
        link: null,
      },
      {
        kind: 'intro',
        slot: 'org_intro',
        live: true,
        liveReason: 'always',
        title: 'Hollow Oak Films',
        orgName: 'Hollow Oak Films',
        link: { to: 'brand', orgSlug: 'hollow-oak' },
      },
      {
        kind: 'film',
        slot: 'media',
        live: false,
        liveReason: null,
        title: 'A film',
        orgName: null,
        link: { to: 'content', contentId: 'c1', orgSlug: null },
      },
      {
        kind: 'course',
        slot: 'intro',
        live: false,
        liveReason: null,
        title: 'A course',
        orgName: 'Hollow Oak Films',
        link: { to: 'journey', pageId: 'p1', orgSlug: 'hollow-oak' },
      },
    ]);
  });

  it('caps the named list; the counts stay the truth', async () => {
    const rows = Array.from({ length: MEDIA_USES_CAP + 5 }, (_, i) =>
      row({ owner_id: `c${String(i).padStart(3, '0')}` })
    );
    const usage = await summariseMediaUsage(rows, CALLER);
    expect(usage.uses).toHaveLength(MEDIA_USES_CAP);
    expect(usage.total).toBe(MEDIA_USES_CAP + 5);
    expect(usage.drafts).toBe(MEDIA_USES_CAP + 5);
  });
});

describe('assertMediaDeletable', () => {
  const draft = row();
  const live = row({ owner_id: 'c2', live: true, live_reason: 'published' });

  it('refuses MEDIA_IN_USE first, whatever the fingerprint', async () => {
    const fingerprint = await mediaUsageFingerprint([live, draft]);
    await expect(
      assertMediaDeletable([live, draft], fingerprint)
    ).rejects.toBeInstanceOf(MediaInUseError);
  });

  it('refuses MEDIA_USAGE_CHANGED for drafts with no fingerprint or a stale one', async () => {
    await expect(
      assertMediaDeletable([draft], undefined)
    ).rejects.toBeInstanceOf(MediaUsageChangedError);
    await expect(
      assertMediaDeletable([draft], await mediaUsageFingerprint([]))
    ).rejects.toBeInstanceOf(MediaUsageChangedError);
  });

  it('lets a matching fingerprint through, and an unused item with none', async () => {
    await expect(
      assertMediaDeletable([draft], await mediaUsageFingerprint([draft]))
    ).resolves.toBeUndefined();
    await expect(assertMediaDeletable([], undefined)).resolves.toBeUndefined();
  });
});

describe('the refusals send two counts and nothing else', () => {
  it.each([
    [new MediaInUseError({ live: 4, drafts: 1 }), 'MEDIA_IN_USE'],
    [new MediaUsageChangedError({ live: 0, drafts: 1 }), 'MEDIA_USAGE_CHANGED'],
  ] as const)('%s', (error, code) => {
    const mapped = mapErrorToResponse(error);
    expect(mapped.statusCode).toBe(409);
    expect(mapped.response.error.code).toBe(code);
    expect(mapped.response.error.details).toEqual(
      code === 'MEDIA_IN_USE' ? { live: 4, drafts: 1 } : { live: 0, drafts: 1 }
    );
  });

  it('the publish refusal is a 422 the editor matches by details.code', () => {
    const mapped = mapErrorToResponse(new MediaDeletedError('content-1'));
    expect(mapped.statusCode).toBe(422);
    expect(mapped.response.error.code).toBe('BUSINESS_LOGIC_ERROR');
    expect(mapped.response.error.details).toEqual({
      contentId: 'content-1',
      code: 'MEDIA_DELETED',
    });
  });
});
