/**
 * ContentService — org membership on create/update (Codex-ocal6).
 *
 * `POST /api/content` takes `organizationId` from the request BODY, and its
 * policy is roles-only (`requireOrgMembership` resolves the org from the
 * subdomain/params, never the body). So the only place that can stop a creator
 * filing content into an org they don't belong to is the service. Before this
 * fix, `create` inserted the given `organizationId` as-is, and the schema's
 * only guard is a plain FK to `organizations`; both REJECT cases below failed
 * ("promise resolved instead of rejecting").
 *
 * The rule (owner's decision): only an ACTIVE owner, admin or creator may file
 * content into an org. `subscriber` and `member` are its audience. The controls
 * prove the fixtures are sound, so a red reject case means the hole is open,
 * not that the setup is broken.
 *
 * Publish checks the same rule (Codex-a6ofh.2.1, owner decision): a creator
 * who has left the team, or been moved to its audience, can't put a draft
 * live in the org, since a scheduled piece may go live long after it was
 * saved.
 *
 * Isolation: every org and slug carries a per-run token, and afterAll deletes
 * exactly the rows this file created. It never calls cleanupDatabase.
 */

import { randomUUID } from 'node:crypto';
import {
  content,
  organizationMemberships,
  organizations,
} from '@codex/database/schema';
import { ForbiddenError } from '@codex/service-errors';
import {
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setTeamMembership,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ContentService } from '../content-service';
import type { SqlExecutor } from '../media-usage';

describe('ContentService — org membership on create/update/publish (Codex-ocal6)', () => {
  let db: Database;
  let service: ContentService;
  let creatorId: string;
  /** An org the creator is an active `creator` member of. */
  let ownOrgId: string;
  /** An org the creator has NO membership in. */
  let foreignOrgId: string;
  /** An org the creator is only an active `subscriber` of. */
  let audienceOrgId: string;
  /** An org the creator is on the team of until a test takes them off it. */
  let leavingOrgId: string;
  const token = randomUUID().replace(/-/g, '').slice(0, 10);
  const orgIds: string[] = [];
  const contentIds: string[] = [];

  function writtenInput(organizationId?: string) {
    return {
      title: `Membership probe ${token}`,
      slug: createUniqueSlug(`ocal6-${token}`),
      contentType: 'written' as const,
      contentBody: 'Body',
      priceCents: 0,
      tags: [],
      ...(organizationId ? { organizationId } : {}),
    };
  }

  beforeAll(async () => {
    db = setupTestDatabase();
    service = new ContentService({ db, environment: 'test' });

    const [seeded] = await seedTestUsers(db, 1);
    if (!seeded) throw new Error('failed to seed creator');
    creatorId = seeded;

    const rows = await db
      .insert(organizations)
      .values([
        { name: `Own org ${token}`, slug: createUniqueSlug(`own-${token}`) },
        {
          name: `Foreign org ${token}`,
          slug: createUniqueSlug(`foreign-${token}`),
        },
        {
          name: `Audience org ${token}`,
          slug: createUniqueSlug(`audience-${token}`),
        },
        {
          name: `Leaving org ${token}`,
          slug: createUniqueSlug(`leaving-${token}`),
        },
      ])
      .returning({ id: organizations.id });
    const [own, foreign, audience, leaving] = rows;
    if (!own || !foreign || !audience || !leaving) {
      throw new Error('failed to create orgs');
    }
    ownOrgId = own.id;
    foreignOrgId = foreign.id;
    audienceOrgId = audience.id;
    leavingOrgId = leaving.id;
    orgIds.push(own.id, foreign.id, audience.id, leaving.id);

    await db.insert(organizationMemberships).values([
      {
        organizationId: ownOrgId,
        userId: creatorId,
        role: 'creator',
        status: 'active',
      },
      {
        organizationId: audienceOrgId,
        userId: creatorId,
        role: 'subscriber',
        status: 'active',
      },
      {
        organizationId: leavingOrgId,
        userId: creatorId,
        role: 'creator',
        status: 'active',
      },
    ]);
  });

  afterAll(async () => {
    if (contentIds.length > 0) {
      await db.delete(content).where(inArray(content.id, contentIds));
    }
    // Memberships cascade with their org.
    if (orgIds.length > 0) {
      await db.delete(organizations).where(inArray(organizations.id, orgIds));
    }
    await teardownTestDatabase();
  });

  // ── Controls: the fixtures can create content at all ─────────────────────

  it('creates personal content (no organizationId)', async () => {
    const created = await service.create(writtenInput(), creatorId);
    contentIds.push(created.id);
    expect(created.organizationId).toBeNull();
  });

  it("creates content in an org the creator is a 'creator' member of", async () => {
    const created = await service.create(writtenInput(ownOrgId), creatorId);
    contentIds.push(created.id);
    expect(created.organizationId).toBe(ownOrgId);
  });

  it("moves personal content into an org the creator is a 'creator' member of", async () => {
    const personal = await service.create(writtenInput(), creatorId);
    contentIds.push(personal.id);
    const moved = await service.update(
      personal.id,
      { organizationId: ownOrgId },
      creatorId
    );
    expect(moved.organizationId).toBe(ownOrgId);
  });

  // ── The contract under test ───────────────────────────────────────────────

  it('REJECTS creating content in an org the creator has no membership in', async () => {
    const attempt = service.create(writtenInput(foreignOrgId), creatorId);
    // Record the id if the hole is open, so afterAll still cleans it up.
    attempt.then((row) => contentIds.push(row.id)).catch(() => {});
    await expect(attempt).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("REJECTS creating content in an org the creator is only an active 'subscriber' of", async () => {
    const attempt = service.create(writtenInput(audienceOrgId), creatorId);
    attempt.then((row) => contentIds.push(row.id)).catch(() => {});
    await expect(attempt).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('REJECTS moving existing content into an org the creator has no membership in', async () => {
    const personal = await service.create(writtenInput(), creatorId);
    contentIds.push(personal.id);
    await expect(
      service.update(personal.id, { organizationId: foreignOrgId }, creatorId)
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('names the refusal with details.code NOT_ON_ORG_TEAM', async () => {
    await expect(
      service.create(writtenInput(foreignOrgId), creatorId)
    ).rejects.toMatchObject({
      statusCode: 403,
      context: { code: 'NOT_ON_ORG_TEAM' },
    });
  });

  // ── Publish (Codex-a6ofh.2.1) ─────────────────────────────────────────────

  it('publishes personal content with no membership at all (control)', async () => {
    const personal = await service.create(writtenInput(), creatorId);
    contentIds.push(personal.id);
    const published = await service.publish(personal.id, creatorId);
    expect(published.status).toBe('published');
  });

  it('publishes org content while the creator is on the team (control)', async () => {
    const draft = await service.create(writtenInput(ownOrgId), creatorId);
    contentIds.push(draft.id);
    const published = await service.publish(draft.id, creatorId);
    expect(published.status).toBe('published');
  });

  it.each([
    ['has left the team', { status: 'inactive' }, { status: 'active' }],
    [
      "is moved to the org's audience",
      { role: 'subscriber' },
      { role: 'creator' },
    ],
  ])('REJECTS publishing a draft after the creator %s', async (_case, change, restore) => {
    const draft = await service.create(writtenInput(leavingOrgId), creatorId);
    contentIds.push(draft.id);
    await setTeamMembership(db, leavingOrgId, creatorId, change);
    try {
      await expect(service.publish(draft.id, creatorId)).rejects.toMatchObject({
        statusCode: 403,
        context: { code: 'NOT_ON_ORG_TEAM' },
        // The caller may be an org admin, who IS on the team: name the creator.
        message: expect.stringContaining(
          "creator is no longer on the organization's team"
        ),
      });
    } finally {
      await setTeamMembership(db, leavingOrgId, creatorId, restore);
    }
  });

  // A soft-deleted org keeps its memberships, and has no team (review,
  // Codex-a6ofh.2.1).
  it('REJECTS creating in, and publishing into, a soft-deleted org', async () => {
    const draft = await service.create(writtenInput(leavingOrgId), creatorId);
    contentIds.push(draft.id);
    await db
      .update(organizations)
      .set({ deletedAt: new Date() })
      .where(eq(organizations.id, leavingOrgId));
    try {
      await expect(service.publish(draft.id, creatorId)).rejects.toMatchObject({
        context: { code: 'NOT_ON_ORG_TEAM' },
      });
      await expect(
        service.create(writtenInput(leavingOrgId), creatorId)
      ).rejects.toMatchObject({ context: { code: 'NOT_ON_ORG_TEAM' } });
    } finally {
      await db
        .update(organizations)
        .set({ deletedAt: null })
        .where(eq(organizations.id, leavingOrgId));
    }
  });

  // The race (review, Codex-a6ofh.2.1): a removal flips the membership, then
  // archives the creator's PUBLISHED content. A publish that read the
  // membership without a lock saw it active while the removal was open,
  // committed after it, and stayed live in an org its creator had left.
  describe('a removal racing a publish', () => {
    /** The backend id of the connection running `tx`. */
    async function backendPid(tx: SqlExecutor): Promise<number> {
      const result = await tx.execute(sql`SELECT pg_backend_pid() AS pid`);
      return Number((result.rows[0] as { pid: number }).pid);
    }

    /**
     * Wait until some backend is blocked BY `holder` (a probe, not a timer),
     * or `work` settles first. A wait for a pool connection is not a lock
     * wait, so only this proves the work reached the lock.
     */
    async function untilBlockedBy(
      holder: number,
      work: Promise<unknown>
    ): Promise<'waiting' | 'finished' | 'neither after 10 s'> {
      let settled = false;
      work.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        }
      );
      for (let i = 0; i < 400; i++) {
        const blocked = await db.execute(sql`
          SELECT count(*)::int AS n FROM pg_stat_activity
           WHERE ${holder} = ANY(pg_blocking_pids(pid))`);
        if (settled) return 'finished';
        if (Number((blocked.rows[0] as { n: number }).n) > 0) return 'waiting';
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return 'neither after 10 s';
    }

    it('a publish that starts while a removal holds the membership waits on it, then refuses', async () => {
      const draft = await service.create(writtenInput(leavingOrgId), creatorId);
      contentIds.push(draft.id);
      let release = () => {};
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let holding = (_pid: number) => {};
      const held = new Promise<number>((resolve) => {
        holding = resolve;
      });

      // The removal's shape (OrganizationService.removeMember): the status
      // flipped, the transaction still open.
      const removing = db.transaction(async (tx) => {
        await tx
          .update(organizationMemberships)
          .set({ status: 'inactive' })
          .where(
            and(
              eq(organizationMemberships.organizationId, leavingOrgId),
              eq(organizationMemberships.userId, creatorId)
            )
          );
        holding(await backendPid(tx));
        await released;
      });
      const remover = await held;

      try {
        const publishing = service.publish(draft.id, creatorId);
        const early = await untilBlockedBy(remover, publishing);
        release();
        await removing;

        // Unlocked, the read sees the membership as committed (active), the
        // publish finishes before the removal does, and the piece goes live.
        expect(early).toBe('waiting');
        await expect(publishing).rejects.toMatchObject({
          context: { code: 'NOT_ON_ORG_TEAM' },
        });
        const [row] = await db
          .select({ status: content.status })
          .from(content)
          .where(eq(content.id, draft.id));
        expect(row?.status).toBe('draft');
      } finally {
        release();
        await removing.catch(() => {});
        await setTeamMembership(db, leavingOrgId, creatorId, {
          status: 'active',
        });
      }
    });
  });
});
