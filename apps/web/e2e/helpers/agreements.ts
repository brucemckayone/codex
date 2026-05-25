/**
 * Revenue-Share Agreements E2E Helpers (Codex-q8mel — WP-10)
 *
 * Two-actor scaffolding for the owner ↔ creator negotiation flow.
 *
 * Topology:
 *   - Owner lives in an org. They drive the studio at
 *     `${orgSlug}.lvh.me:${PORT}/studio/settings/revenue-share`.
 *   - Creator is an org member with role `creator`. They view their
 *     personal portfolio at `creators.lvh.me:${PORT}/studio/negotiations`.
 *
 * Cookies are scoped to `.lvh.me` so both subdomains share auth state per
 * browser context. Two contexts share the org but each has its own session.
 *
 * Multi-creator helpers (`createOrgWithCreators`) seed N creator members
 * for the pie-math test.
 */

import type { OrgMemberContext } from '@codex/shared-types';
import {
  authFixture,
  orgFixture,
  parseCookieString,
} from '@codex/test-utils/e2e';
import type { BrowserContext, Page } from '@playwright/test';
import { aliasSessionCookies } from './auth-cookies';

export const E2E_BASE_PORT = 5173;
const PASSWORD = 'Test123!@#';

/**
 * Inject cookies onto `.lvh.me` so they work on every subdomain (the
 * org subdomain, `creators`, and the platform host).
 */
export async function injectAgreementCookies(
  ctx: BrowserContext | Page,
  rawCookie: string
): Promise<void> {
  const browserCookies = aliasSessionCookies(parseCookieString(rawCookie));
  const context = 'context' in ctx ? ctx.context() : ctx;
  await context.clearCookies();
  await context.addCookies(browserCookies);
}

export interface AgreementTopology {
  /** Org owner (also has platform role `creator` for studio access). */
  owner: OrgMemberContext;
  /** Org `creator`-role member with platform role `creator`. */
  creator: OrgMemberContext;
  /** Slug of the shared org. */
  orgSlug: string;
}

/**
 * Bootstrap a topology with one owner and one creator in the same org.
 *
 * Both users are registered with platform-role `creator` so their sessions
 * already carry the role required by the studio routes and creators
 * subdomain — no post-register upgrade + re-login dance needed.
 */
export async function createOwnerAndCreator(): Promise<AgreementTopology> {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 7);
  const orgSlug = `e2e-rs-${ts}-${rand}`;
  const orgName = `E2E Revenue-Share Org ${ts}`;

  const ownerEmail = `e2e-owner-${ts}-${rand}@test.codex`;
  const creatorEmail = `e2e-creator-${ts}-${rand}@test.codex`;

  const owner = await orgFixture.createOrgMember({
    email: ownerEmail,
    password: PASSWORD,
    name: 'E2E Owner',
    orgRole: 'owner',
    orgName,
    orgSlug,
    platformRole: 'creator',
  });

  const creator = await orgFixture.createOrgMember({
    email: creatorEmail,
    password: PASSWORD,
    name: 'E2E Creator',
    orgRole: 'creator',
    organization: owner.organization,
    platformRole: 'creator',
  });

  return { owner, creator, orgSlug };
}

/**
 * Bootstrap a topology with one owner and N creators in the same org.
 * Used by the pie-math test (3 creators with distinct shares).
 */
export async function createOwnerWithCreators(creatorCount: number): Promise<{
  owner: OrgMemberContext;
  creators: OrgMemberContext[];
  orgSlug: string;
}> {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 7);
  const orgSlug = `e2e-rs-multi-${ts}-${rand}`;
  const orgName = `E2E Multi-Creator Org ${ts}`;

  const ownerEmail = `e2e-owner-multi-${ts}-${rand}@test.codex`;
  const owner = await orgFixture.createOrgMember({
    email: ownerEmail,
    password: PASSWORD,
    name: 'E2E Multi Owner',
    orgRole: 'owner',
    orgName,
    orgSlug,
    platformRole: 'creator',
  });

  const creators: OrgMemberContext[] = [];
  for (let i = 0; i < creatorCount; i += 1) {
    const email = `e2e-creator-${i}-${ts}-${rand}@test.codex`;
    const member = await orgFixture.createOrgMember({
      email,
      password: PASSWORD,
      name: `E2E Creator ${i + 1}`,
      orgRole: 'creator',
      organization: owner.organization,
      platformRole: 'creator',
    });
    creators.push(member);
  }

  return { owner, creators, orgSlug };
}

/**
 * Owner revenue-share settings page URL.
 * On org subdomains the slug is in the hostname, not the path.
 */
export function ownerRevenueSharePath(orgSlug: string): string {
  return `http://${orgSlug}.lvh.me:${E2E_BASE_PORT}/studio/settings/revenue-share`;
}

/** Creator negotiations portfolio URL — uses the `creators` subdomain. */
export function creatorNegotiationsUrl(): string {
  return `http://creators.lvh.me:${E2E_BASE_PORT}/studio/negotiations`;
}

/**
 * Cleanup helper — invalidate all sessions in the topology.
 */
export async function cleanupAgreementTopology(
  topology: AgreementTopology | null
): Promise<void> {
  if (!topology) return;
  await Promise.all([
    authFixture.logout(topology.owner.cookie).catch(() => {}),
    authFixture.logout(topology.creator.cookie).catch(() => {}),
  ]);
}
