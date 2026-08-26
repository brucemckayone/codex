/**
 * ContentService — shader presentation write-payload capture (Codex-1g5lh.9).
 *
 * WHY THIS EXISTS ALONGSIDE THE INTEGRATION SUITE
 * ------------------------------------------------
 * `content-service-shader-preset.test.ts` proves the round-trip against a real
 * database, which is the stronger proof — but it can only run where a database
 * is reachable. This suite proves the SAME defect with no database at all, by
 * substituting a fake transaction that records the exact object handed to
 * `.values()` / `.set()`. That is precisely the layer the bug lived at:
 *
 *   `createContentSchema.parse()` accepted `shaderPreset`, and then
 *   `ContentService.create` built its insert from an EXPLICIT field list that
 *   omitted it. Zod's default `.strip()` means the value was validated and then
 *   silently discarded — it never reached the driver, so no amount of schema or
 *   column inspection revealed it. Asserting on the captured payload is a
 *   direct, deterministic witness to that drop.
 *
 * The create/update asymmetry is the other half of the story and is pinned
 * below: `update()` spreads the whole validated partial into `.set()`, so the
 * field always persisted THERE. Editing an existing piece worked; creating a
 * new one did not — which is why the symptom read as intermittent.
 *
 * `featured` and `shaderConfig` were dropped by the identical mechanism in the
 * identical statement and are asserted here too.
 */

import { CONTENT_STATUS } from '@codex/constants';
import type { Database } from '@codex/database';
import { describe, expect, it } from 'vitest';
import { ContentService } from '../content-service';

type Payload = Record<string, unknown>;

/**
 * A fake `Database` that records write payloads instead of issuing SQL.
 *
 * Only the surface `create()`/`update()` actually touch is implemented:
 * `transaction`, `insert().values().returning()`, `update().set().where()
 * .returning()`, and the two `query.*.findFirst` lookups. Anything else is
 * deliberately absent so an unrelated future call fails loudly rather than
 * silently passing through a permissive stub.
 *
 * `existingContent` seeds the row `update()` reads back before writing.
 */
function createCapturingDb(existingContent: Payload = {}) {
  const captured: { insert?: Payload; update?: Payload } = {};

  const tx = {
    query: {
      mediaItems: {
        findFirst: async () => ({
          id: 'media-1',
          mediaType: 'audio',
          status: 'ready',
          deletedAt: null,
        }),
      },
      content: {
        findFirst: async () => ({
          id: 'content-1',
          creatorId: 'creator-1',
          organizationId: null,
          isPurchasable: false,
          isFollowerGated: false,
          isTeamOnly: false,
          courseOnly: false,
          includedInTierId: null,
          isFree: true,
          shaderPreset: null,
          shaderConfig: null,
          featured: false,
          ...existingContent,
        }),
      },
    },
    insert: () => ({
      values: (values: Payload) => {
        captured.insert = values;
        return { returning: async () => [{ id: 'content-1', ...values }] };
      },
    }),
    update: () => ({
      set: (values: Payload) => {
        captured.update = values;
        return {
          where: () => ({
            returning: async () => [{ id: 'content-1', ...values }],
          }),
        };
      },
    }),
  };

  const db = {
    transaction: async <T>(fn: (t: typeof tx) => Promise<T>): Promise<T> =>
      fn(tx),
  };

  // Single documented boundary cast: the fake implements only the slice of the
  // Drizzle client these two methods exercise, which cannot be expressed as the
  // full `Database` union without reproducing the whole driver surface.
  return { db: db as unknown as Database, captured };
}

const AUDIO_INPUT = {
  title: 'Immersive Audio Piece',
  slug: 'immersive-audio-piece',
  contentType: 'audio' as const,
  mediaItemId: '11111111-1111-4111-8111-111111111111',
  tags: [],
};

describe('ContentService.create — write payload (Codex-1g5lh.9)', () => {
  it('includes shaderPreset in the insert (the dropped field)', async () => {
    const { db, captured } = createCapturingDb();
    const service = new ContentService({ db, environment: 'test' });

    await service.create(
      { ...AUDIO_INPUT, shaderPreset: 'aurora' },
      'creator-1'
    );

    // The assertion that fails on the unfixed code: before the fix the key was
    // absent from the payload entirely, so the column kept its NULL default.
    expect(captured.insert).toHaveProperty('shaderPreset');
    expect(captured.insert?.shaderPreset).toBe('aurora');
  });

  it('includes shaderConfig and featured in the insert', async () => {
    const { db, captured } = createCapturingDb();
    const service = new ContentService({ db, environment: 'test' });

    await service.create(
      {
        ...AUDIO_INPUT,
        shaderPreset: 'aurora',
        shaderConfig: { intensity: 0.75, grain: true },
        featured: true,
      },
      'creator-1'
    );

    expect(captured.insert?.shaderConfig).toEqual({
      intensity: 0.75,
      grain: true,
    });
    expect(captured.insert?.featured).toBe(true);
  });

  it('writes NULL rather than an empty string for an unset preset', async () => {
    const { db, captured } = createCapturingDb();
    const service = new ContentService({ db, environment: 'test' });

    await service.create({ ...AUDIO_INPUT, shaderPreset: '' }, 'creator-1');
    expect(captured.insert?.shaderPreset).toBeNull();
  });

  it('defaults an omitted preset to NULL and featured to false', async () => {
    const { db, captured } = createCapturingDb();
    const service = new ContentService({ db, environment: 'test' });

    await service.create(AUDIO_INPUT, 'creator-1');

    expect(captured.insert?.shaderPreset).toBeNull();
    expect(captured.insert?.shaderConfig).toBeNull();
    expect(captured.insert?.featured).toBe(false);
    // Sanity check that the fake really captured the create insert and not
    // some other statement.
    expect(captured.insert?.status).toBe(CONTENT_STATUS.DRAFT);
  });
});

describe('ContentService.update — write payload (Codex-1g5lh.9)', () => {
  it('writes an explicitly supplied preset', async () => {
    const { db, captured } = createCapturingDb({ shaderPreset: 'aurora' });
    const service = new ContentService({ db, environment: 'test' });

    await service.update('content-1', { shaderPreset: 'nebula' }, 'creator-1');
    expect(captured.update?.shaderPreset).toBe('nebula');
  });

  it('omits shaderPreset from the SET when the caller did not send it', async () => {
    // The load-bearing semantics: `updateContentSchema` is a `.partial()`, which
    // drops absent keys from its output, so the spread never sees the key and
    // the `in` guard adds nothing. The column is therefore left untouched
    // rather than being overwritten with null — a title-only PATCH must not
    // wipe a stored shader.
    const { db, captured } = createCapturingDb({ shaderPreset: 'aurora' });
    const service = new ContentService({ db, environment: 'test' });

    await service.update('content-1', { title: 'Retitled' }, 'creator-1');

    expect(captured.update).toHaveProperty('title', 'Retitled');
    expect(captured.update).not.toHaveProperty('shaderPreset');
    expect(captured.update).not.toHaveProperty('shaderConfig');
    expect(captured.update).not.toHaveProperty('featured');
  });

  it('writes null for an explicit null (clearing the selection)', async () => {
    const { db, captured } = createCapturingDb({ shaderPreset: 'aurora' });
    const service = new ContentService({ db, environment: 'test' });

    await service.update('content-1', { shaderPreset: null }, 'creator-1');
    expect(captured.update).toHaveProperty('shaderPreset');
    expect(captured.update?.shaderPreset).toBeNull();
  });

  it('normalises an explicit empty selection to null, not an empty string', async () => {
    const { db, captured } = createCapturingDb({ shaderPreset: 'aurora' });
    const service = new ContentService({ db, environment: 'test' });

    await service.update('content-1', { shaderPreset: '' }, 'creator-1');
    expect(captured.update?.shaderPreset).toBeNull();
  });
});
