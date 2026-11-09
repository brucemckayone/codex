/**
 * Preview and test-send render a template in the brand of the org it
 * belongs to or names (Codex-tgkgb, owner decisions 2026-11-09):
 *
 * - A creator template naming an org needs the creator's ACTIVE TEAM role in
 *   it (owner, admin, creator or member) for both. A creator who has left,
 *   or who only subscribes, can no longer send in its name, but their
 *   template stays theirs to list and delete.
 * - An org's own templates: its team may list and preview them; only its
 *   owner or admin may test-send one. A paying subscriber gets none of it.
 * - A test send of a creator template naming an org goes only to the
 *   sender's own address; one naming no org goes anywhere, as before.
 *
 * The REAL template and preview routes with procedure() on a bare Hono app,
 * the session pre-set by a middleware, against the real database: the rule
 * is a membership query, and a test send writes a real email-log row.
 */

import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { createDbClient, eq, inArray } from '@codex/database';
import {
  emailAuditLogs,
  emailTemplates,
  organizationMemberships,
  organizations,
  users,
} from '@codex/database/schema';
import { ObservabilityClient } from '@codex/observability';
import type { Bindings } from '@codex/shared-types';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import preview from '../preview';
import templates from '../templates';

const db = createDbClient(env as unknown as Bindings);
const tag = crypto.randomUUID().replaceAll('-', '').slice(0, 12);

/** A signed-in caller: their user id and platform role. */
interface Caller {
  id: string;
  role: string;
}

const creator: Caller = { id: `tplsender${tag}`, role: 'creator' };
// The team org's people, one per role under test.
const subscriber: Caller = { id: `tplsubscriber${tag}`, role: 'creator' };
const member: Caller = { id: `tplmember${tag}`, role: 'customer' };
const admin: Caller = { id: `tpladmin${tag}`, role: 'creator' };
const people = [creator, subscriber, member, admin];

/** The orgs a creator template can name. */
const orgIds = { member: '', former: '', subscribed: '' };
/** The org whose own templates are under test. */
let teamOrgId = '';
const recipients: string[] = [];

beforeAll(async () => {
  await db.insert(users).values(
    people.map((p) => ({
      id: p.id,
      name: `Template ${p.id}`,
      email: `${p.id}@example.test`,
    }))
  );
  const [memberOrg, former, subscribed, team] = await db
    .insert(organizations)
    .values([
      { name: 'Member Org', slug: `tpl-send-member-${tag}` },
      { name: 'Former Org', slug: `tpl-send-former-${tag}` },
      { name: 'Subscribed Org', slug: `tpl-send-subscribed-${tag}` },
      { name: 'Team Org', slug: `tpl-send-team-${tag}` },
    ])
    .returning({ id: organizations.id });
  if (!memberOrg || !former || !subscribed || !team) {
    throw new Error('orgs not inserted');
  }
  orgIds.member = memberOrg.id;
  orgIds.former = former.id;
  orgIds.subscribed = subscribed.id;
  teamOrgId = team.id;
  await db.insert(organizationMemberships).values([
    {
      organizationId: orgIds.member,
      userId: creator.id,
      role: 'creator',
      status: 'active',
    },
    // The creator made a template here, then left: the row stays, inactive.
    {
      organizationId: orgIds.former,
      userId: creator.id,
      role: 'creator',
      status: 'inactive',
    },
    // A paying customer of the org, as `upsertSubscriberMembership` writes
    // it: active, but not on its team.
    {
      organizationId: orgIds.subscribed,
      userId: creator.id,
      role: 'subscriber',
      status: 'active',
    },
    {
      organizationId: teamOrgId,
      userId: subscriber.id,
      role: 'subscriber',
      status: 'active',
    },
    {
      organizationId: teamOrgId,
      userId: member.id,
      role: 'member',
      status: 'active',
    },
    {
      organizationId: teamOrgId,
      userId: admin.id,
      role: 'admin',
      status: 'active',
    },
  ]);
});

afterAll(async () => {
  const ids = people.map((p) => p.id);
  if (recipients.length > 0) {
    await db
      .delete(emailAuditLogs)
      .where(inArray(emailAuditLogs.recipientEmail, recipients));
  }
  await db
    .delete(emailTemplates)
    .where(eq(emailTemplates.creatorId, creator.id));
  await db
    .delete(emailTemplates)
    .where(eq(emailTemplates.organizationId, teamOrgId));
  await db
    .delete(organizationMemberships)
    .where(inArray(organizationMemberships.userId, ids));
  await db
    .delete(organizations)
    .where(inArray(organizations.id, [...Object.values(orgIds), teamOrgId]));
  await db.delete(users).where(inArray(users.id, ids));
});

async function call(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: Record<string, unknown>,
  as: Caller = creator
): Promise<Response> {
  const app = new Hono<{ Variables: Record<string, unknown> }>();
  app.use('*', async (c, next) => {
    c.set('user', {
      id: as.id,
      email: `${as.id}@example.test`,
      name: `Template ${as.id}`,
      role: as.role,
    });
    c.set('session', { id: `sess_tpl_send_${as.id}`, userId: as.id });
    c.set('obs', new ObservabilityClient('notifications-api', 'test'));
    await next();
  });
  app.route('/api/templates', templates);
  app.route('/api/templates', preview);
  const ec = createExecutionContext();
  const response = await app.fetch(
    new Request(`http://notifications-api.test${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }),
    { ...env, USE_MOCK_EMAIL: 'true' } as unknown as typeof env,
    ec
  );
  await waitOnExecutionContext(ec);
  return response;
}

/**
 * A creator template naming `org` (as stored while the creator belonged), or
 * naming none.
 */
async function stored(org: keyof typeof orgIds | null): Promise<string> {
  const [row] = await db
    .insert(emailTemplates)
    .values({
      name: `tpl-send-${org ?? 'none'}-${crypto.randomUUID().slice(0, 8)}`,
      scope: 'creator',
      creatorId: creator.id,
      createdBy: creator.id,
      organizationId: org ? orgIds[org] : null,
      subject: 'News from {{platformName}}',
      htmlBody: '<p>News from {{platformName}}</p>',
      textBody: 'News from {{platformName}}',
    })
    .returning({ id: emailTemplates.id });
  if (!row) throw new Error('template not inserted');
  return row.id;
}

/** One of the team org's own templates, made by its admin. */
async function storedOrgTemplate(): Promise<string> {
  const [row] = await db
    .insert(emailTemplates)
    .values({
      name: `tpl-send-org-${crypto.randomUUID().slice(0, 8)}`,
      scope: 'organization',
      organizationId: teamOrgId,
      creatorId: null,
      createdBy: admin.id,
      subject: 'Team news from {{platformName}}',
      htmlBody: '<p>Team news from {{platformName}}</p>',
      textBody: 'Team news from {{platformName}}',
    })
    .returning({ id: emailTemplates.id });
  if (!row) throw new Error('org template not inserted');
  return row.id;
}

function recipient(label: string): string {
  const email = `${label}-${tag}@example.test`;
  recipients.push(email);
  return email;
}

const auditRowsFor = (email: string) =>
  db
    .select({
      status: emailAuditLogs.status,
      metadata: emailAuditLogs.metadata,
    })
    .from(emailAuditLogs)
    .where(eq(emailAuditLogs.recipientEmail, email));

describe.each([
  ['who left the org the template names', 'former'],
  ['who only subscribes to the org the template names', 'subscribed'],
] as const)('a creator %s', (_case, org) => {
  it('is refused a preview', async () => {
    const id = await stored(org);

    const response = await call('POST', `/api/templates/${id}/preview`, {
      data: {},
    });

    expect(response.status).toBe(403);
  });

  it('is refused a test send: nothing is sent, and nothing is logged', async () => {
    const id = await stored(org);
    const to = recipient(`${org}-send`);

    const response = await call('POST', `/api/templates/${id}/test-send`, {
      recipientEmail: to,
      data: {},
    });

    // The log first: a send that went through would have written its row.
    expect(await auditRowsFor(to)).toEqual([]);
    expect(response.status).toBe(403);
  });

  it('still lists the template, and can delete it', async () => {
    const id = await stored(org);

    const list = await call('GET', '/api/templates/creator?limit=100');
    expect(list.status).toBe(200);
    const listed = (await list.json()) as { items: Array<{ id: string }> };
    expect(listed.items.map((t) => t.id)).toContain(id);

    const removed = await call('DELETE', `/api/templates/creator/${id}`);
    expect(removed.status).toBe(204);
    const [row] = await db
      .select({ deletedAt: emailTemplates.deletedAt })
      .from(emailTemplates)
      .where(eq(emailTemplates.id, id));
    expect(row?.deletedAt).not.toBeNull();
  }, 15_000); // two route calls and their database round trips
});

describe("an active member of the template's org", () => {
  it('previews it', async () => {
    const id = await stored('member');

    const response = await call('POST', `/api/templates/${id}/preview`, {
      data: {},
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { subject: string } };
    expect(body.data.subject).toMatch(/^News from /);
  });

  // Owner decision 2026-11-09: in the org's brand, a creator template's
  // test send (its only send) goes to the sender alone, never a mailing.
  it('test-sends it to their own address, typed in any case with spaces round it', async () => {
    const id = await stored('member');
    // Stored trimmed, as typed: the send goes to the address given.
    const own = `${creator.id}@example.test`.toUpperCase();
    recipients.push(own);

    const response = await call('POST', `/api/templates/${id}/test-send`, {
      recipientEmail: `  ${own}  `,
      data: {},
    });

    expect(response.status).toBe(200);
    expect(await auditRowsFor(own)).toEqual([
      { status: 'success', metadata: '{"testSend":true}' },
    ]);
  });

  it('is refused a test send to anyone else: nothing is sent, and nothing is logged', async () => {
    const id = await stored('member');
    const to = recipient('member-send-other');

    const response = await call('POST', `/api/templates/${id}/test-send`, {
      recipientEmail: to,
      data: {},
    });

    // The log first: a send that went through would have written its row.
    expect(await auditRowsFor(to)).toEqual([]);
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toBe(
      'Test sends of an organization-branded template go only to your own email address'
    );
  });
});

describe('a creator template naming no org', () => {
  it('test-sends to any address, as before', async () => {
    const id = await stored(null);
    const to = recipient('no-org-send');

    const response = await call('POST', `/api/templates/${id}/test-send`, {
      recipientEmail: to,
      data: {},
    });

    expect(response.status).toBe(200);
    expect(await auditRowsFor(to)).toEqual([
      { status: 'success', metadata: '{"testSend":true}' },
    ]);
  });
});

describe("an org's own templates", () => {
  const listed = async (as: Caller) =>
    call(
      'GET',
      `/api/templates/organizations/${teamOrgId}?limit=100`,
      undefined,
      as
    );

  describe('a paying subscriber of the org', () => {
    it('is refused the list', async () => {
      await storedOrgTemplate();

      const response = await listed(subscriber);

      expect(response.status).toBe(403);
    });

    it('is refused a preview', async () => {
      const id = await storedOrgTemplate();

      const response = await call(
        'POST',
        `/api/templates/${id}/preview`,
        { data: {} },
        subscriber
      );

      expect(response.status).toBe(403);
    });

    it('is refused a test send: nothing is sent, and nothing is logged', async () => {
      const id = await storedOrgTemplate();
      const to = recipient('org-subscriber-send');

      const response = await call(
        'POST',
        `/api/templates/${id}/test-send`,
        { recipientEmail: to, data: {} },
        subscriber
      );

      expect(await auditRowsFor(to)).toEqual([]);
      expect(response.status).toBe(403);
    });
  });

  describe("a member of the org's team", () => {
    it('lists them', async () => {
      const id = await storedOrgTemplate();

      const response = await listed(member);

      expect(response.status).toBe(200);
      const body = (await response.json()) as { items: Array<{ id: string }> };
      expect(body.items.map((t) => t.id)).toContain(id);
    });

    it('previews one', async () => {
      const id = await storedOrgTemplate();

      const response = await call(
        'POST',
        `/api/templates/${id}/preview`,
        { data: {} },
        member
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as { data: { subject: string } };
      expect(body.data.subject).toMatch(/^Team news from /);
    });

    it('is refused a test send: only an owner or admin may send one', async () => {
      const id = await storedOrgTemplate();
      const to = recipient('org-member-send');

      const response = await call(
        'POST',
        `/api/templates/${id}/test-send`,
        { recipientEmail: to, data: {} },
        member
      );

      expect(await auditRowsFor(to)).toEqual([]);
      expect(response.status).toBe(403);
    });
  });

  it('an admin of the org test-sends one', async () => {
    const id = await storedOrgTemplate();
    const to = recipient('org-admin-send');

    const response = await call(
      'POST',
      `/api/templates/${id}/test-send`,
      { recipientEmail: to, data: {} },
      admin
    );

    expect(response.status).toBe(200);
    expect(await auditRowsFor(to)).toEqual([
      { status: 'success', metadata: '{"testSend":true}' },
    ]);
  });
});
