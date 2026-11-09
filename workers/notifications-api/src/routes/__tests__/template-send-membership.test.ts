/**
 * Preview and test-send render a creator template in the brand of the org it
 * names, so both need the creator's ACTIVE membership of that org still
 * (Codex-tgkgb, owner decision 2026-11-09). A creator who has left can no
 * longer send in its name, but their template stays theirs to list and
 * delete.
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
const creatorId = `tplsender${tag}`;
const orgIds = { member: '', former: '' };
const recipients: string[] = [];

beforeAll(async () => {
  await db.insert(users).values({
    id: creatorId,
    name: 'Template Sender',
    email: `${creatorId}@example.test`,
  });
  const [member, former] = await db
    .insert(organizations)
    .values([
      { name: 'Member Org', slug: `tpl-send-member-${tag}` },
      { name: 'Former Org', slug: `tpl-send-former-${tag}` },
    ])
    .returning({ id: organizations.id });
  if (!member || !former) throw new Error('orgs not inserted');
  orgIds.member = member.id;
  orgIds.former = former.id;
  await db.insert(organizationMemberships).values([
    {
      organizationId: orgIds.member,
      userId: creatorId,
      role: 'creator',
      status: 'active',
    },
    // The creator made a template here, then left: the row stays, inactive.
    {
      organizationId: orgIds.former,
      userId: creatorId,
      role: 'creator',
      status: 'inactive',
    },
  ]);
});

afterAll(async () => {
  if (recipients.length > 0) {
    await db
      .delete(emailAuditLogs)
      .where(inArray(emailAuditLogs.recipientEmail, recipients));
  }
  await db
    .delete(emailTemplates)
    .where(eq(emailTemplates.creatorId, creatorId));
  await db
    .delete(organizationMemberships)
    .where(eq(organizationMemberships.userId, creatorId));
  await db
    .delete(organizations)
    .where(inArray(organizations.id, Object.values(orgIds)));
  await db.delete(users).where(eq(users.id, creatorId));
});

async function call(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: Record<string, unknown>
): Promise<Response> {
  const app = new Hono<{ Variables: Record<string, unknown> }>();
  app.use('*', async (c, next) => {
    c.set('user', {
      id: creatorId,
      email: `${creatorId}@example.test`,
      name: 'Template Sender',
      role: 'creator',
    });
    c.set('session', { id: `sess_tpl_send_${tag}`, userId: creatorId });
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

/** A creator template naming `org`, as stored while the creator belonged. */
async function stored(org: keyof typeof orgIds): Promise<string> {
  const [row] = await db
    .insert(emailTemplates)
    .values({
      name: `tpl-send-${org}-${crypto.randomUUID().slice(0, 8)}`,
      scope: 'creator',
      creatorId,
      createdBy: creatorId,
      organizationId: orgIds[org],
      subject: 'News from {{platformName}}',
      htmlBody: '<p>News from {{platformName}}</p>',
      textBody: 'News from {{platformName}}',
    })
    .returning({ id: emailTemplates.id });
  if (!row) throw new Error('template not inserted');
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

describe('a creator who left the org the template names', () => {
  it('is refused a preview', async () => {
    const id = await stored('former');

    const response = await call('POST', `/api/templates/${id}/preview`, {
      data: {},
    });

    expect(response.status).toBe(403);
  });

  it('is refused a test send: nothing is sent, and nothing is logged', async () => {
    const id = await stored('former');
    const to = recipient('former-send');

    const response = await call('POST', `/api/templates/${id}/test-send`, {
      recipientEmail: to,
      data: {},
    });

    // The log first: a send that went through would have written its row.
    expect(await auditRowsFor(to)).toEqual([]);
    expect(response.status).toBe(403);
  });

  it('still lists the template, and can delete it', async () => {
    const id = await stored('former');

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
  });
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

  it('test-sends it', async () => {
    const id = await stored('member');
    const to = recipient('member-send');

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
