/**
 * ContentService.listPublic — the media item SELECT is a column list (Codex-ve5eh).
 *
 * NO DATABASE. `listPublic` backs anonymous, KV-cached routes that every
 * public page serialises into its HTML, and it loaded `mediaItem: true`: every
 * media_items column, raw R2 keys, RunPod job id and transcoder error text
 * included. The route now builds the wire item field by field (pinned in
 * workers/content-api public-routes.test.ts), and this pins the other half: the
 * service never READS the internal columns at all. A fake db records the
 * relational query `listPublic` hands to `findMany`, which is exactly where the
 * old `mediaItem: true` lived, and the old `organization: true` beside it
 * (Codex-567de). `list({ scope: 'browse' })`, which any signed-in account reads
 * through GET /api/content/browse, had the same two (Codex-1bdx0). Both now
 * leave out the content row's sales count too, and the studio reads the
 * org's payee id (Codex-kk6zx). The real-Postgres half, that the exclusions
 * do exclude, is content-service-public-live-org.test.ts.
 */

import type { Database } from '@codex/database';
import { describe, expect, it } from 'vitest';
import { ContentService } from '../content-service';

/**
 * A fake `Database` with only the surface `listPublic` touches on a read with
 * no orgId: `query.content.findMany` (recorded) and the `select().from()
 * .where()` chain, which builds the live-org subquery and runs the count.
 */
type CapturedQuery = {
  columns?: Record<string, unknown>;
  with?: Record<string, unknown>;
};

function createCapturingDb() {
  const captured: { findMany?: CapturedQuery; findFirst?: CapturedQuery } = {};
  const db = {
    query: {
      content: {
        findMany: async (args: CapturedQuery) => {
          captured.findMany = args;
          return [];
        },
        // `get` returns at once on no row, before its memberships read.
        findFirst: async (args: CapturedQuery) => {
          captured.findFirst = args;
          return undefined;
        },
      },
    },
    select: () => ({
      from: () => ({ where: async () => [{ total: 0 }] }),
    }),
  };
  // Single documented boundary cast: the fake implements only the slice of the
  // Drizzle client this read exercises.
  return { db: db as unknown as Database, captured };
}

describe('ContentService.listPublic — media item projection (Codex-ve5eh)', () => {
  it('selects only durationSeconds and the two keys the route resolves to URLs', async () => {
    const { db, captured } = createCapturingDb();
    const service = new ContentService({ db, environment: 'test' });

    await service.listPublic({ page: 1, limit: 20, sort: 'newest' });

    expect(captured.findMany?.with?.mediaItem).toEqual({
      columns: {
        durationSeconds: true,
        thumbnailKey: true,
        hlsPreviewKey: true,
      },
    });
  });

  // Codex-567de: the org relation was `organization: true` beside it, which
  // put every organizations column, the payee's user id among them, on the
  // same anonymous list.
  it('selects only the four org columns the web reads', async () => {
    const { db, captured } = createCapturingDb();
    const service = new ContentService({ db, environment: 'test' });

    await service.listPublic({ page: 1, limit: 20, sort: 'newest' });

    expect(captured.findMany?.with?.organization).toEqual({
      columns: { id: true, name: true, slug: true, logoUrl: true },
    });
  });

  it('leaves out the sales count', async () => {
    const { db, captured } = createCapturingDb();
    const service = new ContentService({ db, environment: 'test' });

    await service.listPublic({ page: 1, limit: 20, sort: 'newest' });

    expect(captured.findMany?.columns).toEqual({ purchaseCount: false });
  });
});

// Codex-1bdx0: list({ scope: 'browse' }) backs GET /api/content/browse, which
// any signed-in account can read. It loaded `mediaItem: true` and
// `organization: true` like the public list did.
describe("ContentService.list({ scope: 'browse' }) — catalogue projection (Codex-1bdx0)", () => {
  it('selects what the public list selects: three media columns, four org columns, no creator email', async () => {
    const { db, captured } = createCapturingDb();
    const service = new ContentService({ db, environment: 'test' });

    await service.list(
      'viewer-1',
      { organizationId: '3c111111-1111-4111-8111-111111111999' },
      { page: 1, limit: 20 },
      { scope: 'browse' }
    );

    expect(captured.findMany?.with).toEqual({
      mediaItem: {
        columns: {
          durationSeconds: true,
          thumbnailKey: true,
          hlsPreviewKey: true,
        },
      },
      organization: {
        columns: { id: true, name: true, slug: true, logoUrl: true },
      },
      creator: { columns: { id: true, name: true } },
    });
    expect(captured.findMany?.columns).toEqual({ purchaseCount: false });
  });
});

// The studio reads check content ownership, not org management, so any
// creator-role member reads them; the org row is not theirs (Codex-kk6zx).
describe("ContentService studio reads — the org's payee id stays out", () => {
  const PAYEE_EXCLUDED = { columns: { primaryConnectAccountUserId: false } };

  it('list (studio scope)', async () => {
    const { db, captured } = createCapturingDb();
    const service = new ContentService({ db, environment: 'test' });

    await service.list('creator-1', {}, { page: 1, limit: 20 });

    expect(captured.findMany?.with?.organization).toEqual(PAYEE_EXCLUDED);
    expect(captured.findMany?.columns).toBeUndefined();
  });

  it('get', async () => {
    const { db, captured } = createCapturingDb();
    const service = new ContentService({ db, environment: 'test' });

    await service.get('3c111111-1111-4111-8111-111111111001', 'creator-1');

    expect(captured.findFirst?.with?.organization).toEqual(PAYEE_EXCLUDED);
  });
});
