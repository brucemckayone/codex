/**
 * Codex-kk9nv.7: every write to a user's public card invalidates every cache
 * that shows it.
 *
 * Two holes this pins shut:
 *
 * 1. `DELETE /api/user/avatar` called the image service directly, which holds
 *    no cache, so `USER_PROFILE` / `USER_PUBLIC_PROFILE` (keyed by user id)
 *    kept serving the deleted URL for up to 10 minutes.
 * 2. Each org's creators list (`ORG_CREATORS`, 4h) carries name, username,
 *    avatar, bio and social links, and no user write bumped it. An avatar
 *    upload showed the placeholder, a delete a broken image, and a deleted
 *    account its owner's real details, on the org's public creator surfaces
 *    for up to four hours.
 *
 * The list has its own cache id, `org:{slug}:creators` (Codex-kk9nv.9), so a
 * profile write bumps that and leaves the org's config and stats, keyed by
 * the bare slug, alone. Deleting an account also ends its memberships
 * (Codex-kk9nv.8), a change to who is in the org, so it bumps both.
 *
 * For a profile write the fan-out is best-effort: it runs after the write has
 * committed, so a failed org lookup must not report the write as failed.
 * deleteAccount reads the orgs inside its transaction instead, before the
 * scrub hides them, so there a failed lookup aborts the deletion. The org
 * lookup's filter is asserted on the SQL drizzle renders, so a dropped role,
 * status, deleted-org or deleted-user condition fails here.
 */

import type { R2Service } from '@codex/cloudflare-clients';
import type { Database } from '@codex/database';
import { organizationMemberships, users } from '@codex/database/schema';
import { ConflictError } from '@codex/service-errors';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IdentityService } from '../services/identity-service';

const mockDeleteUserAvatar = vi.fn();
const mockProcessUserAvatar = vi.fn();

vi.mock('@codex/image-processing', () => ({
  ImageProcessingService: class {
    deleteDroppedAvatar = vi.fn();
    deleteUserAvatar = mockDeleteUserAvatar;
    processUserAvatar = mockProcessUserAvatar;
  },
  extractMimeType: (m: string) => m,
  MAX_IMAGE_SIZE_BYTES: 10 * 1024 * 1024,
  SUPPORTED_IMAGE_MIME_TYPES: ['image/jpeg'],
}));

// deleteAccount also ends the creator's agreements, inside its transaction
// (Codex-2hxff.18). That is identity-service.test.ts's to prove; this file is
// about which caches the write invalidates, so the two helpers are stubbed.
vi.mock('@codex/agreements', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@codex/agreements')>()),
  withdrawProposalsOnDeparture: vi.fn(async () => []),
  terminateAgreementsOnDeparture: vi.fn(async () => []),
}));

const USER_ID = 'user-1';
const SLUGS = ['org-a', 'org-b'];
const CREATORS_IDS = SLUGS.map((slug) => `org:${slug}:creators`);

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
        ? Promise.reject(
            Object.assign(
              new Error(`Failed query: select "slug" …\nparams: ${USER_ID}`),
              { cause: new Error('neon unavailable') }
            )
          )
        : Promise.resolve(isLookup ? SLUGS.map((slug) => ({ slug })) : []);
    const where = (clause: SQL) => {
      if (isLookup) lookup.where = clause;
      const rows = answer();
      // `for` answers deleteAccount's locking read of the avatar.
      return Object.assign(rows, { limit: () => rows, for: () => rows });
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
    // deleteAccount's scrub runs in a transaction (Codex-2hxff.18).
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
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
    // `true`: there was an uploaded avatar to remove (Codex-kk9nv.10).
    mockDeleteUserAvatar.mockReset().mockResolvedValue(true);
    mockProcessUserAvatar.mockReset().mockResolvedValue({
      url: `https://cdn.codex.test/avatars/${USER_ID}/lg.webp`,
      size: 1024,
      mimeType: 'image/webp',
    });
  });

  it("deleteAvatar removes the files, then invalidates the user and each listing org's creators list", async () => {
    const { service, invalidated, cache } = harness();

    await service.deleteAvatar(USER_ID);

    expect(mockDeleteUserAvatar).toHaveBeenCalledWith(USER_ID);
    expect([...invalidated].sort()).toEqual([USER_ID, ...CREATORS_IDS].sort());
    // Invalidate AFTER the delete, or a read in between re-caches the old URL.
    const deletedAt = mockDeleteUserAvatar.mock.invocationCallOrder[0] ?? 0;
    const firstInvalidate = cache.invalidate.mock.invocationCallOrder[0] ?? 0;
    expect(deletedAt).toBeLessThan(firstInvalidate);
  });

  it('deleteAvatar with no upload to remove still invalidates every surface', async () => {
    // Remove is offered only for an upload (Codex-kk9nv.10), so a no-op
    // delete usually means a surface left stale: an earlier removal whose
    // invalidation failed, or whose commit ack was lost. Invalidating again
    // is what lets the retry heal the profile AND the creators lists.
    const { service, invalidated } = harness();
    mockDeleteUserAvatar.mockResolvedValueOnce(false);

    await service.deleteAvatar(USER_ID);

    expect([...invalidated].sort()).toEqual([USER_ID, ...CREATORS_IDS].sort());
  });

  it('uploadAvatar invalidates even when the write throws, and rethrows its error', async () => {
    // A write can commit and still report failure; the folder it replaced is
    // then deleted, so a cached copy of the old URL would be a broken image
    // (Codex-kk9nv.16).
    const { service, invalidated } = harness();
    mockProcessUserAvatar.mockRejectedValueOnce(
      new Error('Connection terminated')
    );

    await expect(service.uploadAvatar(USER_ID, avatarFile())).rejects.toThrow(
      'Connection terminated'
    );
    expect([...invalidated].sort()).toEqual([USER_ID, ...CREATORS_IDS].sort());
  });

  it('deleteAvatar invalidates even when the delete throws, and rethrows its error', async () => {
    // The clear can commit and lose its ack; the files then go to the sweep,
    // so a cached copy of the old URL would be a broken image. A typed error,
    // so one replaced on the way out would not be the same object.
    const { service, invalidated } = harness();
    const failure = new ConflictError('Avatar removal reported failure');
    mockDeleteUserAvatar.mockRejectedValueOnce(failure);

    await expect(service.deleteAvatar(USER_ID)).rejects.toBe(failure);
    expect([...invalidated].sort()).toEqual([USER_ID, ...CREATORS_IDS].sort());
  });

  it("uploadAvatar invalidates the user and each listing org's creators list", async () => {
    const { service, invalidated } = harness();

    await service.uploadAvatar(USER_ID, avatarFile());

    expect([...invalidated].sort()).toEqual([USER_ID, ...CREATORS_IDS].sort());
  });

  it("updateProfile invalidates each listing org's creators list (it carries the name)", async () => {
    const { service, invalidated } = harness();

    await service.updateProfile(USER_ID, { displayName: 'New Name' });

    expect([...invalidated].sort()).toEqual([USER_ID, ...CREATORS_IDS].sort());
  });

  it("upgradeToCreator invalidates each listing org's creators list (the username, bio and links are on it)", async () => {
    const { service, invalidated } = harness({ existingUsername: '' });

    await service.upgradeToCreator(USER_ID, { username: 'alice2' });

    expect([...invalidated].sort()).toEqual(
      [USER_ID, ...CREATORS_IDS, 'username:alice2'].sort()
    );
  });

  it('a profile write leaves the org config and stats alone (Codex-kk9nv.9)', async () => {
    const { service, invalidated } = harness();

    await service.updateProfile(USER_ID, { displayName: 'New Name' });

    // The bare slug is the id ORG_CONFIG and ORG_STATS are read under.
    for (const slug of SLUGS) expect(invalidated).not.toContain(slug);
  });

  it("deleteAccount invalidates each listing org's creators list and its slug, so the scrubbed card leaves and the member count drops", async () => {
    const { service, invalidated } = harness();

    await service.deleteAccount(USER_ID);

    expect([...invalidated].sort()).toEqual(
      [USER_ID, ...SLUGS, ...CREATORS_IDS].sort()
    );
  });

  it('deleteAccount reads the listing orgs after the scrub, before the memberships end, by membership alone', async () => {
    // After the scrub, so a membership an invite committed while the scrub
    // waited is included. Before the memberships end, while they still name
    // the orgs. Without the account condition, which the scrub made false.
    const { service, select, whereQuery } = harness();
    const update = vi.spyOn(
      (service as unknown as { db: { update: (t: unknown) => unknown } }).db,
      'update'
    );

    await service.deleteAccount(USER_ID);

    const lookupAt = select.mock.calls.findIndex(
      ([columns]) => 'slug' in columns
    );
    expect(lookupAt).toBeGreaterThan(-1);
    const lookedUpAt = select.mock.invocationCallOrder[lookupAt] ?? 0;
    const tables = update.mock.calls.map(([table]) => table);
    const scrubbedAt = update.mock.invocationCallOrder[tables.indexOf(users)];
    const endedAt =
      update.mock.invocationCallOrder[tables.indexOf(organizationMemberships)];
    expect(lookedUpAt).toBeGreaterThan(scrubbedAt ?? Infinity);
    expect(lookedUpAt).toBeLessThan(endedAt ?? 0);
    expect(whereQuery().sql).not.toContain('"users"."deleted_at"');
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
    // A deleted account is on no creators list (Codex-kk9nv.8).
    expect(sql).toContain('"users"."deleted_at" is null');
  });

  describe('when the org lookup fails', () => {
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
    ])('%s still succeeds, invalidates the user, and logs the miss', async (operation, run) => {
      const { service, invalidated, lookup, warn } = harness();
      lookup.fails = true;

      await expect(run(service)).resolves.not.toThrow();

      expect(invalidated).toEqual([USER_ID]);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('org lookup failed'),
        // The driver's reason, not the query: its params hold the user id.
        expect.objectContaining({
          userId: USER_ID,
          operation,
          error: 'neon unavailable',
        })
      );
    });

    it('deleteAccount fails inside its transaction, so the scrub rolls back and no cache is left showing the person', async () => {
      const { service, invalidated, lookup } = harness();
      const update = vi.spyOn(
        (service as unknown as { db: { update: () => unknown } }).db,
        'update'
      );
      lookup.fails = true;

      await expect(service.deleteAccount(USER_ID)).rejects.toThrow();

      // The lookup runs after the scrub, inside the transaction: its failure
      // rolls the scrub back, nothing past it is written, and nothing
      // committed, so nothing is stale.
      expect(update).toHaveBeenCalledTimes(1);
      expect(invalidated).toEqual([]);
    });

    it('updateProfile still bumps the old and new username slots', async () => {
      const { service, invalidated, lookup } = harness({
        existingUsername: 'alice',
      });
      lookup.fails = true;

      await service.updateProfile(USER_ID, { username: 'alice2' });

      expect(invalidated).toEqual(
        expect.arrayContaining([USER_ID, 'username:alice', 'username:alice2'])
      );
    });
  });

  it('with no cache injected, still deletes and never queries orgs', async () => {
    const { service, select } = harness({ withCache: false });

    await service.deleteAvatar(USER_ID);

    expect(mockDeleteUserAvatar).toHaveBeenCalledWith(USER_ID);
    expect(select).not.toHaveBeenCalled();
  });

  it('with no cache injected, deleteAccount skips the listing lookup', async () => {
    const { service, select } = harness({ withCache: false });

    await service.deleteAccount(USER_ID);

    expect(select.mock.calls.some(([columns]) => 'slug' in columns)).toBe(
      false
    );
  });
});
