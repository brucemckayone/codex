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
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ContentService } from '../content-service';

describe('ContentService — org membership on create/update (Codex-ocal6)', () => {
  let db: Database;
  let service: ContentService;
  let creatorId: string;
  /** An org the creator is an active `creator` member of. */
  let ownOrgId: string;
  /** An org the creator has NO membership in. */
  let foreignOrgId: string;
  /** An org the creator is only an active `subscriber` of. */
  let audienceOrgId: string;
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
      ])
      .returning({ id: organizations.id });
    const [own, foreign, audience] = rows;
    if (!own || !foreign || !audience) throw new Error('failed to create orgs');
    ownOrgId = own.id;
    foreignOrgId = foreign.id;
    audienceOrgId = audience.id;
    orgIds.push(own.id, foreign.id, audience.id);

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
});
