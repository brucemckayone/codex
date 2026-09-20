/**
 * ContentService — immersive shader presentation round-trip (Codex-1g5lh.9).
 *
 * SYMPTOM: a creator picks an immersive shader on an audio piece in the studio
 * and the selection is gone when the form reloads.
 *
 * ROOT CAUSE (verified, and NOT the one the bead filed): every upstream hop was
 * already correct — the form posts `shaderPreset`, the remote command forwards
 * it, `createContentSchema`/`updateContentSchema` accept it, and
 * `content.shader_preset` exists. `ContentService.create` builds its insert from
 * an EXPLICIT field list and Zod's default `.strip()` throws away anything that
 * list omits, so the validated value was dropped between `parse()` and
 * `.values()`. `update()` was never broken — it spreads the whole validated
 * partial into `.set()` — which is exactly why the bug presented as flaky:
 * editing an existing row worked, creating a new one did not.
 *
 * This suite pins the asymmetry that made it invisible. The CREATE cases are
 * the regression proof; the UPDATE cases lock in behaviour that currently works
 * only by virtue of the spread, so a future refactor to an explicit `.set()`
 * list cannot silently reintroduce the same fault.
 *
 * `featured` and `shaderConfig` were dropped by the identical mechanism in the
 * identical statement and are covered here too.
 *
 * Isolation: every row is created by this file with a unique slug and is only
 * ever read back by its own id, so a shared branch needs no inter-test cleanup
 * (same convention as content-service-course-only.test.ts).
 */

import { mediaItems } from '@codex/database/schema';
import {
  createTestMediaItemInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import type { CreateContentInput } from '@codex/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ContentService } from '../content-service';

describe('ContentService — shader presentation round-trip (Codex-1g5lh.9)', () => {
  let db: Database;
  let service: ContentService;
  let creatorId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    service = new ContentService({ db, environment: 'test' });

    const [firstCreator] = await seedTestUsers(db, 1);
    if (!firstCreator) throw new Error('failed to seed creator');
    creatorId = firstCreator;
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  /**
   * A ready AUDIO media item — `createContentSchema` refuses audio content
   * without one, and audio is the content type the immersive shader mode
   * actually renders for.
   */
  async function seedAudioMedia(): Promise<string> {
    const [media] = await db
      .insert(mediaItems)
      .values(
        createTestMediaItemInput(creatorId, {
          mediaType: 'audio',
          status: 'ready',
        })
      )
      .returning();
    if (!media) throw new Error('failed to seed audio media item');
    return media.id;
  }

  async function audioInput(
    overrides: Partial<CreateContentInput> = {}
  ): Promise<CreateContentInput> {
    return {
      title: 'Immersive Audio Piece',
      slug: createUniqueSlug('shader-audio'),
      contentType: 'audio',
      mediaItemId: await seedAudioMedia(),
      tags: [],
      ...overrides,
    } as CreateContentInput;
  }

  describe('create persists the selection (the regression)', () => {
    it('round-trips shaderPreset through create → get', async () => {
      const created = await service.create(
        await audioInput({ shaderPreset: 'aurora' }),
        creatorId
      );

      // The insert itself must carry it — not just the read.
      expect(created.shaderPreset).toBe('aurora');

      // And it must survive to the read the studio edit form re-seeds from.
      const read = await service.get(created.id, creatorId);
      expect(read?.shaderPreset).toBe('aurora');
    });

    it('round-trips shaderConfig (jsonb overrides) through create → get', async () => {
      const created = await service.create(
        await audioInput({
          shaderPreset: 'aurora',
          shaderConfig: { intensity: 0.75, grain: true },
        }),
        creatorId
      );

      expect(created.shaderConfig).toEqual({ intensity: 0.75, grain: true });

      const read = await service.get(created.id, creatorId);
      expect(read?.shaderConfig).toEqual({ intensity: 0.75, grain: true });
    });

    it('round-trips the featured flag through create → get', async () => {
      const created = await service.create(
        await audioInput({ featured: true }),
        creatorId
      );

      expect(created.featured).toBe(true);

      const read = await service.get(created.id, creatorId);
      expect(read?.featured).toBe(true);
    });

    it('stores NULL, not an empty string, when no shader is chosen', async () => {
      // The studio's `optionalString` already maps '' → null, but a direct API
      // caller can send ''. A nullable varchar should hold NULL for "unset" so
      // every reader's falsy check and every `IS NULL` query agrees.
      const created = await service.create(
        await audioInput({ shaderPreset: '' }),
        creatorId
      );
      expect(created.shaderPreset).toBeNull();

      // Omitting the field entirely is also NULL, never undefined.
      const omitted = await service.create(await audioInput(), creatorId);
      expect(omitted.shaderPreset).toBeNull();
      expect(omitted.shaderConfig).toBeNull();
      expect(omitted.featured).toBe(false);
    });
  });

  describe('update semantics', () => {
    it('an explicit preset overwrites the stored one', async () => {
      const created = await service.create(
        await audioInput({ shaderPreset: 'aurora' }),
        creatorId
      );

      const updated = await service.update(
        created.id,
        { shaderPreset: 'nebula' },
        creatorId
      );
      expect(updated.shaderPreset).toBe('nebula');

      const read = await service.get(created.id, creatorId);
      expect(read?.shaderPreset).toBe('nebula');
    });

    it('an update that OMITS shaderPreset does not clobber the stored value', async () => {
      // This is the semantics that matters most: `updateContentSchema` is a
      // `.partial()`, which omits absent keys from its output entirely, so the
      // `.set()` spread never sees the key and the stored preset stands. A
      // partial PATCH touching only the title must not wipe the shader.
      const created = await service.create(
        await audioInput({
          shaderPreset: 'aurora',
          shaderConfig: { intensity: 0.5 },
          featured: true,
        }),
        creatorId
      );

      const updated = await service.update(
        created.id,
        { title: 'Retitled, shader untouched' },
        creatorId
      );

      expect(updated.title).toBe('Retitled, shader untouched');
      expect(updated.shaderPreset).toBe('aurora');
      expect(updated.shaderConfig).toEqual({ intensity: 0.5 });
      expect(updated.featured).toBe(true);

      const read = await service.get(created.id, creatorId);
      expect(read?.shaderPreset).toBe('aurora');
    });

    it('an explicit null clears the stored preset', async () => {
      const created = await service.create(
        await audioInput({ shaderPreset: 'aurora' }),
        creatorId
      );

      const updated = await service.update(
        created.id,
        { shaderPreset: null },
        creatorId
      );
      expect(updated.shaderPreset).toBeNull();
    });

    it('an explicit empty selection clears to NULL, not to an empty string', async () => {
      const created = await service.create(
        await audioInput({ shaderPreset: 'aurora' }),
        creatorId
      );

      const updated = await service.update(
        created.id,
        { shaderPreset: '' },
        creatorId
      );
      expect(updated.shaderPreset).toBeNull();

      const read = await service.get(created.id, creatorId);
      expect(read?.shaderPreset).toBeNull();
    });
  });
});
