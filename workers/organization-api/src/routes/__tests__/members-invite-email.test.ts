/**
 * The team-invitation email names the organisation and opens it (owner
 * decision 2026-10-27, "Open the org", Codex-bnxhw).
 *
 * The email used to link to `${WEB_APP_URL}/accept-invite`, a route the web
 * app doesn't have, and called the org "the organisation". Adding someone
 * makes them a member at once, so there's nothing to accept and nothing
 * expires. Now:
 *   - the email names the organisation;
 *   - its one button opens the org Studio for an admin or creator, or the
 *     organisation's home page for a member;
 *   - the link comes from the env name (`buildOrgUrlFromEnv`), never
 *     WEB_APP_URL. On staging a host-derived link would reach production.
 *
 * TEST SHAPE mirrors `members-cache-invalidation.test.ts`: the REAL
 * `procedure()` runs on a Hono app at the production mount point. Three seams
 * are stubbed:
 *   - the session, pre-set by a middleware;
 *   - `OrganizationService`, a spy object;
 *   - `sendEmailToWorker`, captured, so each case asserts the exact payload.
 * The KV double serves a warm "owner" membership, so management passes
 * without Neon.
 */

import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { ObservabilityClient } from '@codex/observability';
import { orgMemberInvitationDataSchema } from '@codex/validation';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const orgSpies = {
  get: vi.fn(),
  inviteMember: vi.fn(),
};

vi.mock('@codex/organization', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/organization')>();
  return {
    ...actual,
    OrganizationService: vi.fn(() => orgSpies),
  };
});

// `dispatchOrgSlugInvalidation` builds a client eagerly; the real one throws
// without DATABASE_URL_LOCAL_PROXY.
vi.mock('@codex/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/database')>();
  return {
    ...actual,
    createDbClient: vi.fn(() => ({
      query: {
        organizationMemberships: { findFirst: vi.fn(async () => undefined) },
        organizations: { findFirst: vi.fn(async () => undefined) },
      },
    })),
  };
});

// Hoisted: the factory runs before this module's own `const`s exist.
const { sendEmail } = vi.hoisted(() => ({ sendEmail: vi.fn() }));
vi.mock('@codex/worker-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/worker-utils')>();
  return { ...actual, sendEmailToWorker: sendEmail };
});

// Imported AFTER the mocks so the real registry resolves the mocked classes.
import { membershipCacheKey } from '@codex/worker-utils';
import members from '../members';

const ORG_ID = '5d333333-3333-4333-8333-333333333333';
const ORG = { id: ORG_ID, name: 'Invite Org', slug: 'invite-org' };
const INVITER = {
  id: 'inviteruser01',
  name: 'Sam Owner',
  email: 'sam@test.com',
  role: 'creator',
};
const INVITEE_ID = 'inviteeuser02';

function makeKv() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string, type?: string) => {
      const raw = store.get(key);
      if (raw === undefined) return null;
      return type === 'json' ? JSON.parse(raw) : raw;
    }),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn(async () => ({ keys: [], list_complete: true })),
    store,
  };
}

/** `environment: null` leaves the ENVIRONMENT binding unset. */
async function invite(
  role: string,
  environment: string | null = 'test'
): Promise<Response> {
  const kv = makeKv();
  kv.store.set(
    membershipCacheKey(ORG_ID, INVITER.id),
    JSON.stringify({ role: 'owner', status: 'active', joinedAt: '2026-01-01' })
  );
  const app = new Hono<{ Variables: Record<string, unknown> }>();
  app.use('*', async (c, next) => {
    c.set('user', INVITER);
    // Its own rate-limit bucket: `singleWorker` shares one limiter.
    c.set('session', { id: 'sess_members_invite_email', userId: INVITER.id });
    // `createWorker` sets this in production; `ctx.obs` reads it.
    c.set('obs', obs);
    await next();
  });
  app.route('/api/organizations/:id/members', members);
  const ec = createExecutionContext();
  const res = await app.fetch(
    new Request(
      `http://organization-api.test/api/organizations/${ORG_ID}/members/invite`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'invitee@test.com', role }),
      }
    ),
    {
      ...env,
      ENVIRONMENT: environment ?? undefined,
      CACHE_KV: kv,
    } as unknown as typeof env,
    ec
  );
  await waitOnExecutionContext(ec);
  return res;
}

/** The one invitation email's data. */
function invitationData(): Record<string, unknown> {
  expect(sendEmail).toHaveBeenCalledTimes(1);
  const [, , params] = sendEmail.mock.calls[0] ?? [];
  expect(params).toMatchObject({
    to: 'invitee@test.com',
    templateName: 'org-member-invitation',
    category: 'transactional',
    userId: INVITEE_ID,
    organizationId: ORG_ID,
  });
  return params.data;
}

let obs: ObservabilityClient;

beforeEach(() => {
  vi.clearAllMocks();
  obs = new ObservabilityClient('organization-api', 'test');
  vi.spyOn(obs, 'warn');
  orgSpies.get.mockResolvedValue(ORG);
  orgSpies.inviteMember.mockResolvedValue({
    id: 'membership-invited',
    userId: INVITEE_ID,
    role: 'member',
    status: 'active',
    joinedAt: new Date('2026-01-01T00:00:00Z'),
  });
});

describe('POST /invite: the invitation email (Codex-bnxhw)', () => {
  it.each([
    ['admin', 'an admin', 'http://invite-org.lvh.me:3000/studio'],
    ['creator', 'a creator', 'http://invite-org.lvh.me:3000/studio'],
    ['member', 'a member', 'http://invite-org.lvh.me:3000/'],
  ])('an invited %s is added as "%s" and opens %s', async (role, roleLabel, orgUrl) => {
    const res = await invite(role);
    expect(res.status).toBe(201);
    expect(invitationData()).toEqual({
      inviterName: 'Sam Owner',
      orgName: 'Invite Org',
      // The plain role, as before: the stock row reads "as a {{roleName}}".
      roleName: role,
      roleLabel,
      orgUrl,
      // Transitional (Codex-2hxff.83): the same link under the old name.
      acceptUrl: orgUrl,
      expiryDays: '7',
    });
  });

  it("sends exactly the template's data shape, with the old fields until 0117 has run (Codex-2hxff.83, .84)", async () => {
    await invite('creator');
    const data = invitationData();
    expect(orgMemberInvitationDataSchema.strict().parse(data)).toEqual(data);
    // The stock row production has links its button to `acceptUrl`, so it
    // must be the same link.
    expect(data.acceptUrl).toBe(data.orgUrl);
    expect(data.expiryDays).toBe('7');
  });

  it('the previous notifications-api accepts it: organization-api deploys first', async () => {
    // That release's schema, verbatim (origin/dev 5bc603f7).
    const previousSchema = z.object({
      inviterName: z.string(),
      orgName: z.string(),
      roleName: z.string(),
      acceptUrl: z.string().url(),
      expiryDays: z.string(),
    });
    await invite('admin');
    expect(previousSchema.parse(invitationData())).toEqual({
      inviterName: 'Sam Owner',
      orgName: 'Invite Org',
      roleName: 'admin',
      acceptUrl: 'http://invite-org.lvh.me:3000/studio',
      expiryDays: '7',
    });
  });

  it('an unset ENVIRONMENT warns, and the email links to development', async () => {
    const res = await invite('creator', null);
    expect(res.status).toBe(201);
    expect(obs.warn).toHaveBeenCalledWith(
      'ENVIRONMENT is unset; the invitation email links to development',
      expect.objectContaining({ organizationId: ORG_ID, userId: INVITEE_ID })
    );
    expect(invitationData().orgUrl).toBe(
      'http://invite-org.lvh.me:3000/studio'
    );
  });

  it('a set ENVIRONMENT does not warn', async () => {
    await invite('creator');
    expect(obs.warn).not.toHaveBeenCalledWith(
      'ENVIRONMENT is unset; the invitation email links to development',
      expect.anything()
    );
  });

  it('on staging, the link stays on the staging host', async () => {
    await invite('creator', 'staging');
    expect(invitationData().orgUrl).toBe(
      'https://invite-org-staging.revelations.studio/studio'
    );
  });

  it('a missing organisation is a 404 that adds nobody and sends nothing', async () => {
    orgSpies.get.mockResolvedValue(null);
    const res = await invite('creator');
    expect(res.status).toBe(404);
    expect(orgSpies.inviteMember).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('an unknown ENVIRONMENT still adds the member, but sends no email it cannot link', async () => {
    const res = await invite('creator', 'not-an-env');
    expect(res.status).toBe(201);
    expect(orgSpies.inviteMember).toHaveBeenCalledTimes(1);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
