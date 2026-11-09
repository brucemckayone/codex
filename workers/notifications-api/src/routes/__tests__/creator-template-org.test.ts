/**
 * A creator template that names an organisation needs the creator's ACTIVE
 * membership of it, on create and on update (Codex-tgkgb, owner decision
 * 2026-11-09). A test send renders a template in its org's brand and logs it
 * under that org, so naming another org would send in its name.
 *
 * The REAL routes and procedure() on a bare Hono app, with the session
 * pre-set by a middleware, against the real database: the rule is a
 * membership query, and a refusal must come out as a 403.
 */

import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { and, createDbClient, eq, inArray } from '@codex/database';
import {
  emailTemplates,
  organizationMemberships,
  organizations,
  users,
} from '@codex/database/schema';
import { ObservabilityClient } from '@codex/observability';
import type { Bindings } from '@codex/shared-types';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import templates from '../templates';

const db = createDbClient(env as unknown as Bindings);
const tag = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
const creatorId = `tplcreator${tag}`;
const orgIds: Record<'member' | 'former' | 'foreign', string> = {
  member: '',
  former: '',
  foreign: '',
};

beforeAll(async () => {
  await db.insert(users).values({
    id: creatorId,
    name: 'Template Creator',
    email: `${creatorId}@example.test`,
  });
  const [member, former, foreign] = await db
    .insert(organizations)
    .values([
      { name: 'Member Org', slug: `tpl-member-${tag}` },
      { name: 'Former Org', slug: `tpl-former-${tag}` },
      { name: 'Foreign Org', slug: `tpl-foreign-${tag}` },
    ])
    .returning({ id: organizations.id });
  if (!member || !former || !foreign) throw new Error('orgs not inserted');
  orgIds.member = member.id;
  orgIds.former = former.id;
  orgIds.foreign = foreign.id;
  await db.insert(organizationMemberships).values([
    {
      organizationId: orgIds.member,
      userId: creatorId,
      role: 'creator',
      status: 'active',
    },
    // A creator who has left: the membership row stays, inactive.
    {
      organizationId: orgIds.former,
      userId: creatorId,
      role: 'creator',
      status: 'inactive',
    },
  ]);
});

afterAll(async () => {
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
  method: 'POST' | 'PATCH',
  path: string,
  body: Record<string, unknown>
): Promise<Response> {
  const app = new Hono<{ Variables: Record<string, unknown> }>();
  app.use('*', async (c, next) => {
    c.set('user', {
      id: creatorId,
      email: `${creatorId}@example.test`,
      name: 'Template Creator',
      role: 'creator',
    });
    c.set('session', { id: `sess_tpl_org_${tag}`, userId: creatorId });
    c.set('obs', new ObservabilityClient('notifications-api', 'test'));
    await next();
  });
  app.route('/api/templates', templates);
  const ec = createExecutionContext();
  const response = await app.fetch(
    new Request(`http://notifications-api.test${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    env as unknown as typeof env,
    ec
  );
  await waitOnExecutionContext(ec);
  return response;
}

const content = (name: string) => ({
  name,
  subject: 'Hello from the studio',
  htmlBody: '<p>Hello from the studio</p>',
  textBody: 'Hello from the studio',
});

const rowsNamed = (name: string) =>
  db
    .select({ organizationId: emailTemplates.organizationId })
    .from(emailTemplates)
    .where(
      and(
        eq(emailTemplates.creatorId, creatorId),
        eq(emailTemplates.name, name)
      )
    );

describe('POST /api/templates/creator: an org needs active membership', () => {
  it.each([
    ['an org the creator is not a member of', 'foreign'],
    ['an org whose membership is no longer active', 'former'],
  ] as const)('refuses %s, and creates nothing', async (_case, org) => {
    const name = `tpl-create-${org}-${tag}`;

    const response = await call('POST', '/api/templates/creator', {
      ...content(name),
      organizationId: orgIds[org],
    });

    expect(response.status).toBe(403);
    expect(await rowsNamed(name)).toEqual([]);
  });

  it('accepts an org the creator is an active member of', async () => {
    const name = `tpl-create-member-${tag}`;

    const response = await call('POST', '/api/templates/creator', {
      ...content(name),
      organizationId: orgIds.member,
    });

    expect(response.status).toBe(201);
    expect(await rowsNamed(name)).toEqual([{ organizationId: orgIds.member }]);
  });

  it('accepts a template with no org, as before', async () => {
    const name = `tpl-create-none-${tag}`;

    const response = await call(
      'POST',
      '/api/templates/creator',
      content(name)
    );

    expect(response.status).toBe(201);
    expect(await rowsNamed(name)).toEqual([{ organizationId: null }]);
  });
});

describe('PATCH /api/templates/creator/:id: its org needs active membership still', () => {
  /** A creator template as already stored: from before the fix, or before the creator left. */
  async function stored(org: keyof typeof orgIds | null): Promise<string> {
    const [row] = await db
      .insert(emailTemplates)
      .values({
        ...content(`tpl-update-${org ?? 'none'}-${tag}`),
        scope: 'creator',
        creatorId,
        createdBy: creatorId,
        organizationId: org ? orgIds[org] : null,
      })
      .returning({ id: emailTemplates.id });
    if (!row) throw new Error('template not inserted');
    return row.id;
  }

  const subjectOf = async (id: string) =>
    (
      await db
        .select({ subject: emailTemplates.subject })
        .from(emailTemplates)
        .where(eq(emailTemplates.id, id))
    )[0]?.subject;

  it.each([
    ['an org the creator is not a member of', 'foreign'],
    ['an org whose membership is no longer active', 'former'],
  ] as const)('refuses a template naming %s, and changes nothing', async (_case, org) => {
    const id = await stored(org);

    const response = await call('PATCH', `/api/templates/creator/${id}`, {
      subject: 'Changed',
    });

    expect(response.status).toBe(403);
    expect(await subjectOf(id)).toBe('Hello from the studio');
  });

  it.each([
    ['an org the creator is an active member of', 'member'],
    ['no org', null],
  ] as const)('updates a template naming %s', async (_case, org) => {
    const id = await stored(org);

    const response = await call('PATCH', `/api/templates/creator/${id}`, {
      subject: 'Changed',
    });

    expect(response.status).toBe(200);
    expect(await subjectOf(id)).toBe('Changed');
  });
});
