/**
 * Codex-kk9nv.7: every write to a user's public card invalidates every cache
 * that shows it.
 *
 * Two holes this pins shut:
 *
 * 1. `DELETE /api/user/avatar` called the image service directly, which holds
 *    no cache, so `USER_PROFILE` / `USER_PUBLIC_PROFILE` (keyed by user id)
 *    kept serving the deleted URL for up to 10 minutes.
 * 2. Each org's creators list (`ORG_CREATORS`, keyed by org SLUG, 4h) carries
 *    name, username, avatar, bio and social links, and no user write bumped
 *    it. An avatar upload showed the placeholder, a delete a broken image,
 *    and a deleted account its owner's real details, on the org's public
 *    creator surfaces for up to four hours.
 *
 * The fan-out is best-effort: it runs after the write has committed, so a
 * failed org lookup must not report the write as failed. The org lookup's
 * filter is asserted on the SQL drizzle renders, so a dropped role, status
 * or deleted-org condition fails here.
 */

import type { R2Service } from '@codex/cloudflare-clients';
import type { Database } from '@codex/database';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IdentityService } from '../services/identity-service';

const mockDeleteUserAvatar = vi.fn();
const mockProcessUserAvatar = vi.fn();

vi.mock('@codex/image-processing', () => ({
  ImageProcessingService: class {
    deleteUserAvatar = mockDeleteUserAvatar;
    processUserAvatar = mockProcessUserAvatar;
  },
  extractMimeType: (m: string) => m,
  MAX_IMAGE_SIZE_BYTES: 10 * 1024 * 1024,
  SUPPORTED_IMAGE_MIME_TYPES: ['image/jpeg'],
}));

const USER_ID = 'user-1';
const SLUGS = ['org-a', 'org-b'];

const UPDATED_ROW = {
  id: USER_ID,
  name: 'New Name',
  email: 'user@example.test',
  emailVerified: true,
  avatarUrl: null,
  image: null,
  username: 'alice2',
  bio: null,
  socialLinks: null,
};

function harness({ withCache = true, existingUsername = 'alice2' } = {}) {
  const invalidated: string[] = [];
  const cache = {
    invalidate: vi.fn(async (id: string) => {
      invalidated.push(id);
    }),
  };

  // Each `select` answers by the columns it asks for: the listing-org lookup
  // asks for `slug`; deleteAccount's owned-org, authored-content and session
  // reads get no rows, so the deletion goes through.
  const lookup = { where: undefined as SQL | undefined, fails: false };
  const select = vi.fn((columns: Record<string, unknown>) => {
    const isLookup = 'slug' in columns;
    const answer = () =>
      isLookup && lookup.fails
        ? Promise.reject(new Error('neon unavailable'))
        : Promise.resolve(isLookup ? SLUGS.map((slug) => ({ slug })) : []);
    const where = (clause: SQL) => {
      if (isLookup) lookup.where = clause;
      const rows = answer();
      return Object.assign(rows, { limit: () => rows });
    };
    return { from: () => ({ innerJoin: () => ({ where }), where }) };
  });

  const db = {
    select,
    query: {
      users: {
        // The caller's own row first; then any username-availability probe,
        // which excludes the caller in SQL, finds nobody.
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({
            id: USER_ID,
            role: 'customer',
            username: existingUsername || null,
          })
          .mockResolvedValue(undefined),
      },
    },
    update: vi.fn(() => ({
      set: () => ({
        where: () => ({ returning: async () => [UPDATED_ROW] }),
      }),
    })),
  } as unknown as Database;

  const service = new IdentityService({
    db,
    environment: 'test',
    r2Service: {} as unknown as R2Service,
    r2PublicUrlBase: 'https://cdn.codex.test',
    // biome-ignore lint/suspicious/noExplicitAny: cache double
    cache: withCache ? (cache as any) : undefined,
  });
  const warn = vi.spyOn(
    (service as unknown as { obs: { warn: (m: string) => void } }).obs,
    'warn'
  );

  const whereQuery = () => {
    if (!lookup.where) throw new Error('the org lookup never ran');
    return new PgDialect().sqlToQuery(lookup.where);
  };

  return { service, invalidated, cache, select, lookup, warn, whereQuery };
}

const avatarFile = () =>
  new File([new Uint8Array([0xff, 0xd8, 0xff])], 'a.jpg', {
    type: 'image/jpeg',
  });

describe('IdentityService — user card writes invalidate every surface', () => {
  beforeEach(() => {
    mockDeleteUserAvatar.mockReset().mockResolvedValue(undefined);
    mockProcessUserAvatar.mockReset().mockResolvedValue({
      url: `https://cdn.codex.test/avatars/${USER_ID}/lg.webp`,
      size: 1024,
      mimeType: 'image/webp',
    });
  });

  it('deleteAvatar removes the files, then invalidates the user and each listing org', async () => {
    const { service, invalidated, cache } = harness();

    await service.deleteAvatar(USER_ID);

    expect(mockDeleteUserAvatar).toHaveBeenCalledWith(USER_ID);
    expect([...invalidated].sort()).toEqual([USER_ID, ...SLUGS].sort());
    // Invalidate AFTER the delete, or a read in between re-caches the old URL.
    const deletedAt = mockDeleteUserAvatar.mock.invocationCallOrder[0] ?? 0;
    const firstInvalidate = cache.invalidate.mock.invocationCallOrder[0] ?? 0;
    expect(deletedAt).toBeLessThan(firstInvalidate);
  });

  it('deleteAvatar invalidates nothing when the delete fails', async () => {
    const { service, invalidated } = harness();
    mockDeleteUserAvatar.mockRejectedValueOnce(new Error('db down'));

    await expect(service.deleteAvatar(USER_ID)).rejects.toThrow();
    expect(invalidated).toEqual([]);
  });

  it('uploadAvatar invalidates the user and each listing org', async () => {
    const { service, invalidated } = harness();

    await service.uploadAvatar(USER_ID, avatarFile());

    expect([...invalidated].sort()).toEqual([USER_ID, ...SLUGS].sort());
  });

  it('updateProfile invalidates each listing org (the creators list carries the name)', async () => {
    const { service, invalidated } = harness();

    await service.updateProfile(USER_ID, { displayName: 'New Name' });

    expect([...invalidated].sort()).toEqual([USER_ID, ...SLUGS].sort());
  });

  it('upgradeToCreator invalidates each listing org (the username, bio and links are on it)', async () => {
    const { service, invalidated } = harness({ existingUsername: '' });

    await service.upgradeToCreator(USER_ID, { username: 'alice2' });

    expect([...invalidated].sort()).toEqual(
      [USER_ID, ...SLUGS, 'alice2'].sort()
    );
  });

  it('deleteAccount invalidates each listing org, so the scrubbed card leaves their public lists', async () => {
    const { service, invalidated } = harness();

    await service.deleteAccount(USER_ID);

    expect([...invalidated].sort()).toEqual([USER_ID, ...SLUGS].sort());
  });

  it('looks up exactly the orgs whose creators list shows the user', async () => {
    const { service, whereQuery } = harness();

    await service.deleteAvatar(USER_ID);

    const { sql, params } = whereQuery();
    expect(params).toEqual(
      expect.arrayContaining([USER_ID, 'active', 'owner', 'admin', 'creator'])
    );
    // A plain member or subscriber is not on the creators list.
    expect(params).not.toContain('member');
    expect(params).not.toContain('subscriber');
    expect(sql).toContain('"organization_memberships"."user_id" = $');
    expect(sql).toContain('"organization_memberships"."status" = $');
    expect(sql).toContain('"organization_memberships"."role" in (');
    expect(sql).toContain('"organizations"."deleted_at" is null');
  });

  describe('when the org lookup fails after the write committed', () => {
    it.each([
      [
        'uploadAvatar',
        (s: IdentityService) => s.uploadAvatar(USER_ID, avatarFile()),
      ],
      ['deleteAvatar', (s: IdentityService) => s.deleteAvatar(USER_ID)],
      [
        'updateProfile',
        (s: IdentityService) => s.updateProfile(USER_ID, { displayName: 'N' }),
      ],
      ['deleteAccount', (s: IdentityService) => s.deleteAccount(USER_ID)],
    ])('%s still succeeds, invalidates the user, and logs the miss', async (operation, run) => {
      const { service, invalidated, lookup, warn } = harness();
      lookup.fails = true;

      await expect(run(service)).resolves.not.toThrow();

      expect(invalidated).toEqual([USER_ID]);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('org lookup failed'),
        expect.objectContaining({ userId: USER_ID, operation })
      );
    });

    it('updateProfile still bumps the old and new username slots', async () => {
      const { service, invalidated, lookup } = harness({
        existingUsername: 'alice',
      });
      lookup.fails = true;

      await service.updateProfile(USER_ID, { username: 'alice2' });

      expect(invalidated).toEqual(
        expect.arrayContaining([USER_ID, 'alice', 'alice2'])
      );
    });
  });

  it('with no cache injected, still deletes and never queries orgs', async () => {
    const { service, select } = harness({ withCache: false });

    await service.deleteAvatar(USER_ID);

    expect(mockDeleteUserAvatar).toHaveBeenCalledWith(USER_ID);
    expect(select).not.toHaveBeenCalled();
  });
});
