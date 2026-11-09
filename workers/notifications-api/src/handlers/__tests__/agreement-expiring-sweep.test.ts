/**
 * Agreement-Expiring-Soon Sweep — Unit Tests (Codex-tugez)
 *
 * Exercises the per-row dispatch logic of `runAgreementExpiringSweep`
 * with a mocked AgreementService so we can assert:
 *
 *   1. each candidate fires TWO emails (creator + owner)
 *   2. `markExpiringSoonSent` is called per agreement
 *   3. orphan orgs (no active owner) send only the creator email but
 *      still mark the row
 *   4. mailer-throws on one row do not block the next row
 *   5. share/term/expiry payload tokens render correctly
 *
 * Per `feedback_service_error_test_instanceof`: assertions use
 * `toBeInstanceOf(Class)` and `err.name === 'ClassName'`. NEVER use
 * `err.constructor.name`.
 *
 * Per `feedback_security_deep_test`: cron-handler dispatch logic is
 * notification-touching; positive AND negative paths are covered.
 */

import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import type { AgreementWithShare } from '@codex/agreements';
import {
  and,
  createDbClient,
  eq,
  inArray,
  TEST_SEND_METADATA,
} from '@codex/database';
import { emailAuditLogs, emailTemplates, users } from '@codex/database/schema';
import { ObservabilityClient } from '@codex/observability';
import type { Bindings } from '@codex/shared-types';
import { templateDataSchemas } from '@codex/validation';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import preview from '../../routes/preview';
import type { RunAgreementExpiringSweepDeps } from '../agreement-expiring-sweep';
import { runAgreementExpiringSweep } from '../agreement-expiring-sweep';
import { SENDS_TIME_BUDGET_MS } from '../send-limits';

// Concrete mailer type — vi.fn() with this signature preserves typing
// on .mock.calls so we can index payload fields without TS narrowing
// errors. NonNullable strips the optional from the deps shape.
type MailerFn = NonNullable<RunAgreementExpiringSweepDeps['mailer']>;

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Build a minimal AgreementWithShare row shape adequate for
 * the sweep's display + arithmetic. We deliberately use a SHAPE-only
 * mock — the sweep does not reach into Drizzle metadata, only fields.
 */
function mockAgreement(
  overrides: Partial<AgreementWithShare> = {}
): AgreementWithShare {
  const now = new Date();
  const effectiveFrom = overrides.effectiveFrom ?? new Date('2026-01-01');
  const effectiveUntil = overrides.effectiveUntil ?? new Date('2026-07-01');
  return {
    id: overrides.id ?? `agreement-${Math.random().toString(36).slice(2)}`,
    creatorId: overrides.creatorId ?? 'creator-user-id',
    organizationId: overrides.organizationId ?? 'org-id',
    organizationFeePercentage: overrides.organizationFeePercentage ?? 7000,
    creatorSharePercent: overrides.creatorSharePercent ?? 3000,
    revenueType: overrides.revenueType ?? 'subscription',
    status: overrides.status ?? 'active',
    terminatedAt: overrides.terminatedAt ?? null,
    terminatedByUserId: overrides.terminatedByUserId ?? null,
    terminationReason: overrides.terminationReason ?? null,
    currentProposalId: overrides.currentProposalId ?? null,
    effectiveFrom,
    effectiveUntil,
    expiringSoonEmailSentAt: overrides.expiringSoonEmailSentAt ?? null,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

// We mock @codex/agreements at the boundary so the sweep can run
// without a real Database. Each test installs the candidates +
// ownerLookup it wants.
const sharedMockState: {
  candidates: ReturnType<typeof mockAgreement>[];
  enrichedCandidates: Array<{
    agreement: ReturnType<typeof mockAgreement>;
    creator: { id: string; email: string; name: string };
    orgName: string;
    orgSlug: string;
  }>;
  ownerLookup: (orgId: string) => Promise<{
    id: string;
    email: string;
    name: string;
  } | null>;
  markedIds: string[];
} = {
  candidates: [],
  enrichedCandidates: [],
  ownerLookup: async () => null,
  markedIds: [],
};

vi.mock('@codex/agreements', async () => {
  const actual =
    await vi.importActual<typeof import('@codex/agreements')>(
      '@codex/agreements'
    );
  return {
    ...actual,
    AgreementService: class MockAgreementService {
      async findExpiringAgreements() {
        return sharedMockState.enrichedCandidates;
      }
      async getFirstActiveOwnerContact(orgId: string) {
        return sharedMockState.ownerLookup(orgId);
      }
      async markExpiringSoonSent(agreementId: string) {
        sharedMockState.markedIds.push(agreementId);
      }
    },
  };
});

// ─── Tests ────────────────────────────────────────────────────────────────

/** An empty email log: no side was sent on an earlier morning. */
const nothingSent = async () => 'no' as const;

function buildObs() {
  const calls: Array<{ level: string; msg: string; ctx?: unknown }> = [];
  return {
    obs: {
      info: (msg: string, ctx?: unknown) => {
        calls.push({ level: 'info', msg, ctx });
      },
      warn: (msg: string, ctx?: unknown) => {
        calls.push({ level: 'warn', msg, ctx });
      },
      error: (msg: string, ctx?: unknown) => {
        calls.push({ level: 'error', msg, ctx });
      },
      debug: (msg: string, ctx?: unknown) => {
        calls.push({ level: 'debug', msg, ctx });
      },
    } as unknown as import('@codex/observability').ObservabilityClient,
    calls,
  };
}

function resetState() {
  sharedMockState.candidates = [];
  sharedMockState.enrichedCandidates = [];
  sharedMockState.ownerLookup = async () => null;
  sharedMockState.markedIds = [];
}

describe('runAgreementExpiringSweep', () => {
  it('fires TWO emails per agreement (creator + owner) and marks the row', async () => {
    resetState();
    const ag = mockAgreement({ id: 'agr-1', organizationId: 'org-1' });
    sharedMockState.enrichedCandidates = [
      {
        agreement: ag,
        creator: {
          id: 'creator-1',
          email: 'creator@example.test',
          name: 'Creator One',
        },
        orgName: 'Org One',
        orgSlug: 'org-one',
      },
    ];
    sharedMockState.ownerLookup = async () => ({
      id: 'owner-1',
      email: 'owner@example.test',
      name: 'Owner One',
    });

    const mailer = vi.fn<MailerFn>(async () => undefined);
    const { obs } = buildObs();

    const result = await runAgreementExpiringSweep({
      // biome-ignore lint/suspicious/noExplicitAny: db is unused by the mocked service
      db: {} as any,
      alreadySent: nothingSent,
      obs,
      environment: 'test',
      workerSecret: 'unused',
      notificationsUrl: 'http://notifications.test',
      daysAhead: 30,
      mailer,
    });

    expect(result.agreementsScanned).toBe(1);
    expect(result.emailsSent).toBe(2);
    expect(result.agreementsMarked).toBe(1);
    expect(result.errors).toBe(0);
    expect(mailer).toHaveBeenCalledTimes(2);
    expect(sharedMockState.markedIds).toEqual(['agr-1']);

    // Recipient assignment: one call to creator, one to owner.
    const recipients = mailer.mock.calls.map((c) => c[0].to);
    expect(recipients).toEqual(
      expect.arrayContaining(['creator@example.test', 'owner@example.test'])
    );

    // Both emails use the agreement-expiring-soon template.
    for (const call of mailer.mock.calls) {
      expect(call[0].templateName).toBe('agreement-expiring-soon');
      expect(call[0].category).toBe('transactional');
      expect(call[0].organizationId).toBe('org-1');
    }
  });

  it('orphan org (no active owner) fires only creator email but still marks the row', async () => {
    resetState();
    const ag = mockAgreement({
      id: 'agr-orphan',
      organizationId: 'orphan-org',
    });
    sharedMockState.enrichedCandidates = [
      {
        agreement: ag,
        creator: {
          id: 'creator-2',
          email: 'creator2@example.test',
          name: 'Creator Two',
        },
        orgName: 'Orphan Org',
        orgSlug: 'orphan-org',
      },
    ];
    sharedMockState.ownerLookup = async () => null; // no active owner

    const mailer = vi.fn<MailerFn>(async () => undefined);
    const { obs, calls } = buildObs();

    const result = await runAgreementExpiringSweep({
      // biome-ignore lint/suspicious/noExplicitAny: db is unused by the mocked service
      db: {} as any,
      alreadySent: nothingSent,
      obs,
      environment: 'test',
      workerSecret: 'unused',
      notificationsUrl: 'http://notifications.test',
      mailer,
    });

    expect(result.emailsSent).toBe(1);
    expect(result.agreementsMarked).toBe(1);
    expect(mailer).toHaveBeenCalledTimes(1);
    expect(mailer.mock.calls[0]?.[0].to).toBe('creator2@example.test');
    expect(sharedMockState.markedIds).toEqual(['agr-orphan']);
    // A warn log mentions the orphan branch.
    expect(
      calls.find(
        (c) => c.level === 'warn' && c.msg.includes('no active owner for org')
      )
    ).toBeDefined();
  });

  it('mailer failure on one row counts an error and does NOT block other rows', async () => {
    resetState();
    const agA = mockAgreement({ id: 'agr-a', organizationId: 'org-a' });
    const agB = mockAgreement({ id: 'agr-b', organizationId: 'org-b' });
    sharedMockState.enrichedCandidates = [
      {
        agreement: agA,
        creator: {
          id: 'creator-a',
          email: 'a@example.test',
          name: 'A',
        },
        orgName: 'Org A',
        orgSlug: 'org-a',
      },
      {
        agreement: agB,
        creator: {
          id: 'creator-b',
          email: 'b@example.test',
          name: 'B',
        },
        orgName: 'Org B',
        orgSlug: 'org-b',
      },
    ];
    sharedMockState.ownerLookup = async () => ({
      id: 'owner-x',
      email: 'owner-x@example.test',
      name: 'Owner',
    });

    // First call throws, the rest succeed.
    const mailer = vi
      .fn<MailerFn>()
      .mockImplementationOnce(async () => {
        throw new Error('transport down');
      })
      .mockImplementation(async () => undefined);

    const { obs } = buildObs();

    const result = await runAgreementExpiringSweep({
      // biome-ignore lint/suspicious/noExplicitAny: db is unused by the mocked service
      db: {} as any,
      alreadySent: nothingSent,
      obs,
      environment: 'test',
      workerSecret: 'unused',
      notificationsUrl: 'http://notifications.test',
      mailer,
    });

    expect(result.agreementsScanned).toBe(2);
    expect(result.errors).toBe(1);
    // First row errored on the first email — it never reaches mark.
    // Second row succeeds — 2 emails + 1 mark.
    expect(result.emailsSent).toBe(2);
    expect(result.agreementsMarked).toBe(1);
    expect(sharedMockState.markedIds).toEqual(['agr-b']);
  });

  it('renders share / term / expiry tokens in the email data payload', async () => {
    resetState();
    const ag = mockAgreement({
      id: 'agr-1',
      // The accepted proposal's 40% is what the email quotes. The legacy
      // column is deliberately wrong (it would say 1%), so reading it fails
      // this test (Codex-2hxff.19 AGR-08).
      creatorSharePercent: 4000,
      organizationFeePercentage: 9900,
      revenueType: 'content_purchase',
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
      effectiveUntil: new Date('2026-07-01T00:00:00Z'), // ~6 months
    });
    sharedMockState.enrichedCandidates = [
      {
        agreement: ag,
        creator: {
          id: 'creator-1',
          email: 'creator@example.test',
          name: 'Creator',
        },
        orgName: 'Acme Studios',
        orgSlug: 'acme-studios',
      },
    ];
    sharedMockState.ownerLookup = async () => ({
      id: 'owner-1',
      email: 'owner@example.test',
      name: 'Owner',
    });

    const mailer = vi.fn<MailerFn>(async () => undefined);
    const { obs } = buildObs();

    await runAgreementExpiringSweep({
      // biome-ignore lint/suspicious/noExplicitAny: db is unused by the mocked service
      db: {} as any,
      alreadySent: nothingSent,
      obs,
      environment: 'test',
      workerSecret: 'unused',
      notificationsUrl: 'http://notifications.test',
      mailer,
    });

    const firstCall = mailer.mock.calls[0]?.[0];
    expect(firstCall).toBeDefined();
    const data = firstCall?.data as Record<string, string>;
    expect(data.sharePercentDisplay).toBe('40%');
    expect(data.revenueTypeLabel).toBe('content-purchase');
    expect(data.termMonthsDisplay).toBe('6 months');
    expect(data.expiryDate).toBe('2026-07-01');
    expect(data.orgName).toBe('Acme Studios');
  });

  /**
   * Each side's link opens a page that exists for THEM (Codex-2hxff.20
   * AGR-10). Both used to be `${WEB_APP_URL}/studio/negotiations?orgId=…`
   * on the apex host, which has no Studio, so every link was dead.
   */
  describe('the link each side gets', () => {
    async function sweepOne(
      environment: 'test' | 'staging' | 'production',
      currentProposalId: string | null
    ) {
      resetState();
      sharedMockState.enrichedCandidates = [
        {
          agreement: mockAgreement({ id: 'agr-1', currentProposalId }),
          creator: {
            id: 'creator-1',
            email: 'creator@example.test',
            name: 'Creator',
          },
          orgName: 'Acme Studios',
          orgSlug: 'acme-studios',
        },
      ];
      sharedMockState.ownerLookup = async () => ({
        id: 'owner-1',
        email: 'owner@example.test',
        name: 'Owner',
      });
      const mailer = vi.fn<MailerFn>(async () => undefined);
      await runAgreementExpiringSweep({
        // biome-ignore lint/suspicious/noExplicitAny: db is unused by the mocked service
        db: {} as any,
        alreadySent: nothingSent,
        obs: buildObs().obs,
        environment,
        workerSecret: 'unused',
        notificationsUrl: 'http://notifications.test',
        mailer,
      });
      const linkFor = (to: string) =>
        mailer.mock.calls.find(([p]) => p.to === to)?.[0].data.deepLinkUrl;
      return {
        creator: linkFor('creator@example.test'),
        owner: linkFor('owner@example.test'),
      };
    }

    it("the creator opens the agreement's thread on the creators subdomain", async () => {
      const links = await sweepOne('production', 'proposal-accepted-1');
      expect(links.creator).toBe(
        'https://creators.revelations.studio/studio/negotiations/proposal-accepted-1'
      );
    });

    it("the owner opens their organisation Studio's revenue-share page", async () => {
      const links = await sweepOne('production', 'proposal-accepted-1');
      expect(links.owner).toBe(
        'https://acme-studios.revelations.studio/studio/monetisation/revenue-share'
      );
    });

    it('a creator whose agreement has no proposal link opens the negotiations list', async () => {
      const links = await sweepOne('production', null);
      expect(links.creator).toBe(
        'https://creators.revelations.studio/studio/negotiations'
      );
    });

    it('staging links stay on staging, never the production apex', async () => {
      const links = await sweepOne('staging', 'proposal-accepted-1');
      expect(links.creator).toBe(
        'https://creators-staging.revelations.studio/studio/negotiations/proposal-accepted-1'
      );
      expect(links.owner).toBe(
        'https://acme-studios-staging.revelations.studio/studio/monetisation/revenue-share'
      );
    });

    it('local links use the lvh.me host and port', async () => {
      const links = await sweepOne('test', 'proposal-accepted-1');
      expect(links.owner).toBe(
        'http://acme-studios.lvh.me:3000/studio/monetisation/revenue-share'
      );
    });
  });

  it('zero candidates → no emails, no marks, no errors', async () => {
    resetState();
    sharedMockState.enrichedCandidates = [];
    const mailer = vi.fn<MailerFn>(async () => undefined);
    const { obs } = buildObs();

    const result = await runAgreementExpiringSweep({
      // biome-ignore lint/suspicious/noExplicitAny: db is unused by the mocked service
      db: {} as any,
      alreadySent: nothingSent,
      obs,
      environment: 'test',
      workerSecret: 'unused',
      notificationsUrl: 'http://notifications.test',
      mailer,
    });

    expect(result.agreementsScanned).toBe(0);
    expect(result.emailsSent).toBe(0);
    expect(result.agreementsMarked).toBe(0);
    expect(result.errors).toBe(0);
    expect(mailer).not.toHaveBeenCalled();
  });

  // ─── Time (Codex-2hxff.100) ─────────────────────────────────────────────

  function candidate(id: string) {
    return {
      agreement: mockAgreement({ id, organizationId: `org-${id}` }),
      creator: {
        id: `creator-${id}`,
        email: `creator-${id}@example.test`,
        name: `Creator ${id}`,
      },
      orgName: `Org ${id}`,
      orgSlug: `org-${id}`,
    };
  }

  it('a send that outlasts its timeout is cut off: the row is not marked, so the next morning tries it again', async () => {
    resetState();
    sharedMockState.enrichedCandidates = [candidate('agr-slow')];
    // notifications-api answering after 2 s, unless the request is aborted.
    let aborted = false;
    const realFetch = globalThis.fetch;
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input, init) => {
        if (!String(input).startsWith('http://notifications.test/')) {
          return realFetch(input, init);
        }
        return new Promise<Response>((resolve, reject) => {
          const answered = setTimeout(
            () => resolve(Response.json({ data: { success: true } })),
            2_000
          );
          init?.signal?.addEventListener('abort', () => {
            aborted = true;
            clearTimeout(answered);
            reject(init.signal?.reason);
          });
        });
      });
    const { obs } = buildObs();
    let result: Awaited<ReturnType<typeof runAgreementExpiringSweep>>;
    try {
      result = await runAgreementExpiringSweep({
        // biome-ignore lint/suspicious/noExplicitAny: db is unused by the mocked service
        db: {} as any,
        alreadySent: nothingSent,
        obs,
        environment: 'test',
        workerSecret: 'test-secret',
        notificationsUrl: 'http://notifications.test',
        sendTimeoutMs: 50,
      });
    } finally {
      fetchSpy.mockRestore();
    }

    // Cut off by its own timeout, not answered.
    expect(aborted).toBe(true);
    expect(result).toMatchObject({ emailsSent: 0, errors: 1 });
    expect(sharedMockState.markedIds).toEqual([]);
  });

  it('a run past its send budget starts no new row: a row is whole or untouched, and the rest go the next morning', async () => {
    resetState();
    sharedMockState.enrichedCandidates = [
      candidate('agr-first'),
      candidate('agr-second'),
    ];
    sharedMockState.ownerLookup = async (orgId) => ({
      id: `owner-${orgId}`,
      email: `owner-${orgId}@example.test`,
      name: 'Owner',
    });
    // The budget is spent by the first row's first send.
    let clockMs = 0;
    const mailer = vi.fn<MailerFn>(async () => {
      clockMs = SENDS_TIME_BUDGET_MS;
    });
    const { obs, calls } = buildObs();

    const result = await runAgreementExpiringSweep({
      // biome-ignore lint/suspicious/noExplicitAny: db is unused by the mocked service
      db: {} as any,
      alreadySent: nothingSent,
      obs,
      environment: 'test',
      workerSecret: 'unused',
      notificationsUrl: 'http://notifications.test',
      mailer,
      clock: () => clockMs,
    });

    expect(result).toMatchObject({
      emailsSent: 2,
      agreementsMarked: 1,
      budgetSpent: true,
    });
    // Both of the first row's emails, then nothing of the second.
    expect(mailer.mock.calls.map((c) => c[0].to)).toEqual([
      'creator-agr-first@example.test',
      'owner-org-agr-first@example.test',
    ]);
    expect(sharedMockState.markedIds).toEqual(['agr-first']);
    expect(calls).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        msg: 'agreement-expiring-soon: the send budget ran out; the rest go tomorrow',
      })
    );
  });

  // ─── A half-sent row (final review #4) ──────────────────────────────────
  //
  // The creator's email goes first. When the owner's then fails, or times
  // out, the row stays unmarked; the next morning must send the owner's
  // alone, never the creator's again.

  describe('a row whose second email failed', () => {
    const timeout = () =>
      new DOMException(
        'The operation was aborted due to timeout',
        'TimeoutError'
      );

    /**
     * The email log, as the send path keeps it: a send that reached
     * notifications-api is in it, under the agreement id and side its data
     * carries.
     */
    function emailLog() {
      const sent: string[] = [];
      const key = (to: string, agreementId: unknown, side: unknown) =>
        `${to}|${agreementId}|${side}`;
      return {
        record: (p: Parameters<MailerFn>[0]) => {
          sent.push(key(p.to, p.data.agreementId, p.data.side));
        },
        alreadySent: async (a: {
          to: string;
          agreementId: string;
          side: string;
        }) =>
          sent.includes(key(a.to, a.agreementId, a.side))
            ? ('sent' as const)
            : ('no' as const),
      };
    }

    function oneRow() {
      resetState();
      sharedMockState.enrichedCandidates = [candidate('agr-half')];
      sharedMockState.ownerLookup = async () => ({
        id: 'owner-half',
        email: 'owner-half@example.test',
        name: 'Owner',
      });
    }

    async function morning(log: ReturnType<typeof emailLog>, mailer: MailerFn) {
      const { obs, calls } = buildObs();
      const sends = vi.fn<MailerFn>(mailer);
      const result = await runAgreementExpiringSweep({
        // biome-ignore lint/suspicious/noExplicitAny: db is unused by the mocked service
        db: {} as any,
        alreadySent: log.alreadySent,
        obs,
        environment: 'test',
        workerSecret: 'unused',
        notificationsUrl: 'http://notifications.test',
        mailer: sends,
      });
      return { result, calls, to: sends.mock.calls.map((c) => c[0].to) };
    }

    it.each([
      ['fails', () => new Error('notifications-api 503')],
      ['times out before it reaches the log', timeout],
    ])('the owner email %s: the next morning sends the owner email alone', async (_case, failure) => {
      oneRow();
      const log = emailLog();

      const first = await morning(log, async (p) => {
        if (p.to === 'owner-half@example.test') throw failure();
        log.record(p);
      });
      expect(first.to).toEqual([
        'creator-agr-half@example.test',
        'owner-half@example.test',
      ]);
      expect(first.result).toMatchObject({ emailsSent: 1, errors: 1 });
      expect(sharedMockState.markedIds).toEqual([]);
      // The log says the creator's email already went.
      expect(first.calls).toContainEqual(
        expect.objectContaining({
          level: 'error',
          msg: 'agreement-expiring-soon per-row dispatch failed',
          ctx: expect.objectContaining({
            agreementId: 'agr-half',
            creatorEmailSent: true,
          }),
        })
      );

      const second = await morning(log, async (p) => log.record(p));
      expect(second.to).toEqual(['owner-half@example.test']);
      expect(second.result).toMatchObject({
        emailsSent: 1,
        emailsAlreadySent: 1,
        errors: 0,
        agreementsMarked: 1,
      });
      expect(sharedMockState.markedIds).toEqual(['agr-half']);
    });

    it('an owner email that timed out after it reached the log is not sent again', async () => {
      oneRow();
      const log = emailLog();

      await morning(log, async (p) => {
        log.record(p);
        if (p.to === 'owner-half@example.test') throw timeout();
      });
      const second = await morning(log, async (p) => log.record(p));

      expect(second.to).toEqual([]);
      expect(second.result).toMatchObject({
        emailsSent: 0,
        emailsAlreadySent: 2,
        agreementsMarked: 1,
      });
    });

    it('both emails fail: the next morning sends both', async () => {
      oneRow();
      const log = emailLog();

      const first = await morning(log, async () => {
        throw new Error('notifications-api 503');
      });
      // The creator's failed, so the owner's was never tried.
      expect(first.to).toEqual(['creator-agr-half@example.test']);
      expect(first.calls).toContainEqual(
        expect.objectContaining({
          level: 'error',
          ctx: expect.objectContaining({ creatorEmailSent: false }),
        })
      );

      const second = await morning(log, async (p) => log.record(p));
      expect(second.to).toEqual([
        'creator-agr-half@example.test',
        'owner-half@example.test',
      ]);
      expect(second.result).toMatchObject({
        emailsSent: 2,
        emailsAlreadySent: 0,
        agreementsMarked: 1,
      });
    });

    it('each email carries its agreement and side, which the template drops before the render', async () => {
      oneRow();
      const log = emailLog();
      const sends: Parameters<MailerFn>[0][] = [];
      await morning(log, async (p) => {
        sends.push(p);
      });

      expect(sends.map((p) => [p.data.agreementId, p.data.side])).toEqual([
        ['agr-half', 'creator'],
        ['agr-half', 'owner'],
      ]);
      // The send path keeps the data verbatim as the log's metadata, then
      // renders from `validateTemplateData`, which is this schema's parse:
      // its output drops keys it does not name, so neither reaches the email.
      for (const { data } of sends) {
        const rendered =
          templateDataSchemas['agreement-expiring-soon'].parse(data);
        const { agreementId: _agreementId, side: _side, ...fields } = data;
        expect(rendered).toEqual(fields);
      }
    });

    // The default lookup, against the real email log.
    it('the email log is read by recipient, agreement and side, never by a prefix', async () => {
      oneRow();
      const db = createDbClient(env as unknown as Bindings);
      const agreementId = `agr-log-${crypto.randomUUID()}`;
      sharedMockState.enrichedCandidates = [
        {
          ...candidate('agr-half'),
          agreement: mockAgreement({
            id: agreementId,
            organizationId: 'org-agr-half',
            createdAt: new Date(Date.now() - 60 * 60 * 1000),
          }),
        },
      ];
      const entry = (
        recipientEmail: string,
        metadata: Record<string, string>,
        status: 'success' | 'failed'
      ) => ({
        templateName: 'agreement-expiring-soon',
        recipientEmail,
        status,
        metadata: JSON.stringify({ recipientName: 'X', ...metadata }),
      });
      const rows = await db
        .insert(emailAuditLogs)
        .values([
          // The creator's went: not sent again.
          entry(
            'creator-agr-half@example.test',
            { agreementId, side: 'creator' },
            'success'
          ),
          // Another agreement whose id this one's is a prefix of.
          entry(
            'owner-half@example.test',
            { agreementId: `${agreementId}0`, side: 'owner' },
            'success'
          ),
          // The owner's, failed: still to send.
          entry(
            'owner-half@example.test',
            { agreementId, side: 'owner' },
            'failed'
          ),
        ])
        .returning({ id: emailAuditLogs.id });

      try {
        const mailer = vi.fn<MailerFn>(async () => undefined);
        const result = await runAgreementExpiringSweep({
          db,
          obs: buildObs().obs,
          environment: 'test',
          workerSecret: 'unused',
          notificationsUrl: 'http://notifications.test',
          mailer,
        });

        expect(mailer.mock.calls.map((c) => c[0].to)).toEqual([
          'owner-half@example.test',
        ]);
        expect(result).toMatchObject({ emailsAlreadySent: 1, errors: 0 });
      } finally {
        await db.delete(emailAuditLogs).where(
          inArray(
            emailAuditLogs.id,
            rows.map((r) => r.id)
          )
        );
      }
    });

    it('one person on both sides: their creator email does not stand for their owner email', async () => {
      oneRow();
      const db = createDbClient(env as unknown as Bindings);
      const agreementId = `agr-log-${crypto.randomUUID()}`;
      const both = 'both-sides@example.test';
      sharedMockState.enrichedCandidates = [
        {
          ...candidate('agr-half'),
          creator: { id: 'both-1', email: both, name: 'Both' },
          agreement: mockAgreement({
            id: agreementId,
            organizationId: 'org-agr-half',
            createdAt: new Date(Date.now() - 60 * 60 * 1000),
          }),
        },
      ];
      sharedMockState.ownerLookup = async () => ({
        id: 'both-1',
        email: both,
        name: 'Both',
      });
      const rows = await db
        .insert(emailAuditLogs)
        .values({
          templateName: 'agreement-expiring-soon',
          recipientEmail: both,
          status: 'success',
          metadata: JSON.stringify({ agreementId, side: 'creator' }),
        })
        .returning({ id: emailAuditLogs.id });

      try {
        const mailer = vi.fn<MailerFn>(async () => undefined);
        await runAgreementExpiringSweep({
          db,
          obs: buildObs().obs,
          environment: 'test',
          workerSecret: 'unused',
          notificationsUrl: 'http://notifications.test',
          mailer,
        });

        expect(mailer.mock.calls.map((c) => c[0].data.side)).toEqual(['owner']);
      } finally {
        await db.delete(emailAuditLogs).where(
          inArray(
            emailAuditLogs.id,
            rows.map((r) => r.id)
          )
        );
      }
    });

    // Owner, 2026-11-09: a `pending` row an earlier run left is NOT sent (its
    // outcome never came), so the warning goes again: a duplicate is
    // harmless, a missing one defeats it. One still in flight is sent.
    it('a side an earlier run left pending goes again; one still in flight, or sent, does not; a test send never counts', async () => {
      resetState();
      const db = createDbClient(env as unknown as Bindings);
      const HOUR = 60 * 60 * 1000;
      const stale = `agr-log-${crypto.randomUUID()}`;
      const forged = `agr-log-${crypto.randomUUID()}`;
      const owner = `owner-${crypto.randomUUID()}@example.test`;
      const agreementFor = (id: string) =>
        mockAgreement({
          id,
          organizationId: `org-${id}`,
          createdAt: new Date(Date.now() - 3 * HOUR),
        });
      sharedMockState.enrichedCandidates = [
        { ...candidate('agr-stale'), agreement: agreementFor(stale) },
        { ...candidate('agr-forged'), agreement: agreementFor(forged) },
      ];
      sharedMockState.ownerLookup = async () => ({
        id: 'owner-log',
        email: owner,
        name: 'Owner',
      });
      const entry = (
        recipientEmail: string,
        keys: { agreementId: string; side: 'creator' | 'owner' },
        status: 'success' | 'pending',
        ageMs: number,
        testSend = false
      ) => {
        const at = new Date(Date.now() - ageMs);
        return {
          templateName: 'agreement-expiring-soon',
          recipientEmail,
          status,
          // As the send path stores it: the data verbatim, or a test send's
          // marker (here beside the keys, so the reader's own guard is what
          // keeps it out).
          metadata: JSON.stringify({
            ...(testSend ? TEST_SEND_METADATA : {}),
            recipientName: 'X',
            ...keys,
          }),
          createdAt: at,
          updatedAt: at,
        };
      };
      const rows = await db
        .insert(emailAuditLogs)
        .values([
          // An earlier run's, left pending: its outcome never came.
          entry(
            'creator-agr-stale@example.test',
            { agreementId: stale, side: 'creator' },
            'pending',
            2 * HOUR
          ),
          // A run beside this one sending it now: in flight.
          entry(
            owner,
            { agreementId: stale, side: 'owner' },
            'pending',
            60_000
          ),
          // A test send carrying the agreement's keys.
          entry(
            'creator-agr-forged@example.test',
            { agreementId: forged, side: 'creator' },
            'success',
            HOUR,
            true
          ),
          // Sent.
          entry(owner, { agreementId: forged, side: 'owner' }, 'success', HOUR),
        ])
        .returning({ id: emailAuditLogs.id });

      try {
        const mailer = vi.fn<MailerFn>(async () => undefined);
        const result = await runAgreementExpiringSweep({
          db,
          obs: buildObs().obs,
          environment: 'test',
          workerSecret: 'unused',
          notificationsUrl: 'http://notifications.test',
          mailer,
        });

        expect(
          mailer.mock.calls.map((c) => [c[0].data.agreementId, c[0].to])
        ).toEqual([
          [stale, 'creator-agr-stale@example.test'],
          [forged, 'creator-agr-forged@example.test'],
        ]);
        expect(result).toMatchObject({
          emailsAlreadySent: 1,
          emailsInFlight: 1,
          errors: 0,
        });
        // The stale row's owner side is another run's to finish: not marked.
        expect(sharedMockState.markedIds).toEqual([forged]);
      } finally {
        await db.delete(emailAuditLogs).where(
          inArray(
            emailAuditLogs.id,
            rows.map((r) => r.id)
          )
        );
      }
    });

    // Two runs at once (a cron fired twice, a manual run): this sweep has no
    // claim, so one can meet a side the other is still sending. That side is
    // not sent again, but nor is the row marked, as that send may yet fail:
    // the next morning reads its outcome (silent-failure review, delta 2).
    it('a side another run is still sending is not sent and leaves the row unmarked; the next morning, that send never having come, sends it and marks the row', async () => {
      oneRow();
      const db = createDbClient(env as unknown as Bindings);
      const agreementId = `agr-log-${crypto.randomUUID()}`;
      const owner = `owner-${crypto.randomUUID()}@example.test`;
      const now = new Date();
      const DAY = 24 * 60 * 60 * 1000;
      sharedMockState.enrichedCandidates = [
        {
          ...candidate('agr-half'),
          agreement: mockAgreement({
            id: agreementId,
            organizationId: 'org-agr-half',
            createdAt: new Date(now.getTime() - 3 * 60 * 60 * 1000),
          }),
        },
      ];
      sharedMockState.ownerLookup = async () => ({
        id: 'owner-log',
        email: owner,
        name: 'Owner',
      });
      const entry = (
        recipientEmail: string,
        side: 'creator' | 'owner',
        status: 'success' | 'pending',
        ageMs: number
      ) => {
        const at = new Date(now.getTime() - ageMs);
        return {
          templateName: 'agreement-expiring-soon',
          recipientEmail,
          status,
          metadata: JSON.stringify({ recipientName: 'X', agreementId, side }),
          createdAt: at,
          updatedAt: at,
        };
      };
      const rows = await db
        .insert(emailAuditLogs)
        .values([
          // The other run's creator email went.
          entry('creator-agr-half@example.test', 'creator', 'success', 120_000),
          // Its owner email, a minute old: still in flight.
          entry(owner, 'owner', 'pending', 60_000),
        ])
        .returning({ id: emailAuditLogs.id });

      const run = async (clock: Date) => {
        const { obs, calls } = buildObs();
        const mailer = vi.fn<MailerFn>(async () => undefined);
        const result = await runAgreementExpiringSweep({
          db,
          obs,
          environment: 'test',
          workerSecret: 'unused',
          notificationsUrl: 'http://notifications.test',
          now: clock,
          mailer,
        });
        const sent = mailer.mock.calls.map((c) => [c[0].to, c[0].data.side]);
        return { result, calls, sent };
      };

      try {
        const first = await run(now);
        // That send may yet fail: the row is left for the next morning.
        expect(sharedMockState.markedIds).toEqual([]);
        expect(first.sent).toEqual([]);
        expect(first.result).toMatchObject({
          emailsSent: 0,
          emailsAlreadySent: 1,
          emailsInFlight: 1,
          agreementsMarked: 0,
          errors: 0,
        });
        expect(first.calls).toContainEqual(
          expect.objectContaining({
            level: 'warn',
            msg: 'agreement-expiring-soon: another run is sending this row; it is left for the next morning',
            ctx: { agreementId, inFlight: ['owner'] },
          })
        );

        // The next morning: the owner's row is still `pending`, its outcome
        // never came, so it goes now; the creator's went, so it does not.
        const second = await run(new Date(now.getTime() + DAY));
        expect(second.sent).toEqual([[owner, 'owner']]);
        expect(sharedMockState.markedIds).toEqual([agreementId]);
        expect(second.result).toMatchObject({
          emailsSent: 1,
          emailsAlreadySent: 1,
          emailsInFlight: 0,
          agreementsMarked: 1,
          errors: 0,
        });
      } finally {
        await db.delete(emailAuditLogs).where(
          inArray(
            emailAuditLogs.id,
            rows.map((r) => r.id)
          )
        );
      }
    });
  });

  // ─── A test send in the email log (final review, scoping-security) ───────
  //
  // POST /api/templates/:id/test-send lets a creator send their own template,
  // under any name and with any data, to anyone. Its row must never read as
  // this sweep's send: written through the real route and send path here.

  it("a test send carrying an agreement's keys does not stand for the owner's email", async () => {
    resetState();
    const db = createDbClient(env as unknown as Bindings);
    const tag = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
    const senderId = `testsender${tag}`;
    const ownerEmail = `owner-${tag}@example.test`;
    const agreementId = `agr-forged-${crypto.randomUUID()}`;
    await db.insert(users).values({
      id: senderId,
      name: 'Test Sender',
      email: `${senderId}@example.test`,
    });
    const [template] = await db
      .insert(emailTemplates)
      .values({
        name: 'agreement-expiring-soon',
        scope: 'creator',
        creatorId: senderId,
        createdBy: senderId,
        subject: 'Expiring soon',
        htmlBody: '<p>Hi {{recipientName}}</p>',
        textBody: 'Hi {{recipientName}}',
      })
      .returning({ id: emailTemplates.id });
    if (!template) throw new Error('template not inserted');

    try {
      const app = new Hono<{ Variables: Record<string, unknown> }>();
      app.use('*', async (c, next) => {
        c.set('user', {
          id: senderId,
          email: `${senderId}@example.test`,
          name: 'Test Sender',
          role: 'creator',
        });
        c.set('session', { id: `sess_test_send_${tag}`, userId: senderId });
        c.set('obs', new ObservabilityClient('notifications-api', 'test'));
        await next();
      });
      app.route('/api/templates', preview);
      const ec = createExecutionContext();
      const response = await app.fetch(
        new Request(
          `http://notifications-api.test/api/templates/${template.id}/test-send`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              recipientEmail: ownerEmail,
              data: {
                recipientName: 'Owner',
                orgName: 'Org',
                otherPartyName: 'Creator',
                revenueTypeLabel: 'subscription',
                sharePercentDisplay: '30%',
                termMonthsDisplay: '6 months',
                expiryDate: '2026-12-01',
                deepLinkUrl: 'https://org.revelations.studio/studio',
                // Every key a sweep reads from the email log.
                agreementId,
                side: 'owner',
                feeNoticeId: 'fee-notice-forged',
                feeNoticeRound: '1',
                priceMoveId: 'price-move-forged',
              },
            }),
          }
        ),
        { ...env, USE_MOCK_EMAIL: 'true' } as unknown as typeof env,
        ec
      );
      await waitOnExecutionContext(ec);
      expect(response.status).toBe(200);

      sharedMockState.enrichedCandidates = [
        {
          ...candidate('agr-forged'),
          agreement: mockAgreement({
            id: agreementId,
            organizationId: 'org-agr-forged',
            createdAt: new Date(Date.now() - 60 * 60 * 1000),
          }),
        },
      ];
      sharedMockState.ownerLookup = async () => ({
        id: 'owner-forged',
        email: ownerEmail,
        name: 'Owner',
      });
      const mailer = vi.fn<MailerFn>(async () => undefined);
      const result = await runAgreementExpiringSweep({
        db,
        obs: buildObs().obs,
        environment: 'test',
        workerSecret: 'unused',
        notificationsUrl: 'http://notifications.test',
        mailer,
      });

      // The owner's warning still goes: the test send is not it.
      expect(mailer.mock.calls.map((c) => c[0].to)).toContain(ownerEmail);
      expect(result.emailsAlreadySent).toBe(0);
      // The real send path logged the test send, and only that it was one.
      const logged = await db
        .select({
          status: emailAuditLogs.status,
          metadata: emailAuditLogs.metadata,
        })
        .from(emailAuditLogs)
        .where(
          and(
            eq(emailAuditLogs.recipientEmail, ownerEmail),
            eq(emailAuditLogs.templateName, 'agreement-expiring-soon')
          )
        );
      expect(logged).toEqual([
        { status: 'success', metadata: '{"testSend":true}' },
      ]);
    } finally {
      await db
        .delete(emailAuditLogs)
        .where(eq(emailAuditLogs.recipientEmail, ownerEmail));
      await db.delete(emailTemplates).where(eq(emailTemplates.id, template.id));
      await db.delete(users).where(eq(users.id, senderId));
    }
  });
});
