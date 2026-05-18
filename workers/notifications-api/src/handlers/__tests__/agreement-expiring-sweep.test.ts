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

import type { CreatorOrganizationAgreement } from '@codex/agreements';
import { describe, expect, it, vi } from 'vitest';
import type { RunAgreementExpiringSweepDeps } from '../agreement-expiring-sweep';
import { runAgreementExpiringSweep } from '../agreement-expiring-sweep';

// Concrete mailer type — vi.fn() with this signature preserves typing
// on .mock.calls so we can index payload fields without TS narrowing
// errors. NonNullable strips the optional from the deps shape.
type MailerFn = NonNullable<RunAgreementExpiringSweepDeps['mailer']>;

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Build a minimal CreatorOrganizationAgreement row shape adequate for
 * the sweep's display + arithmetic. We deliberately use a SHAPE-only
 * mock — the sweep does not reach into Drizzle metadata, only fields.
 */
function mockAgreement(
  overrides: Partial<CreatorOrganizationAgreement> = {}
): CreatorOrganizationAgreement {
  const now = new Date();
  const effectiveFrom = overrides.effectiveFrom ?? new Date('2026-01-01');
  const effectiveUntil = overrides.effectiveUntil ?? new Date('2026-07-01');
  return {
    id: overrides.id ?? `agreement-${Math.random().toString(36).slice(2)}`,
    creatorId: overrides.creatorId ?? 'creator-user-id',
    organizationId: overrides.organizationId ?? 'org-id',
    organizationFeePercentage: overrides.organizationFeePercentage ?? 7000,
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
      obs,
      environment: 'test',
      webAppUrl: 'https://app.example.test',
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
      },
    ];
    sharedMockState.ownerLookup = async () => null; // no active owner

    const mailer = vi.fn<MailerFn>(async () => undefined);
    const { obs, calls } = buildObs();

    const result = await runAgreementExpiringSweep({
      // biome-ignore lint/suspicious/noExplicitAny: db is unused by the mocked service
      db: {} as any,
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
      },
      {
        agreement: agB,
        creator: {
          id: 'creator-b',
          email: 'b@example.test',
          name: 'B',
        },
        orgName: 'Org B',
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
      organizationFeePercentage: 6000, // 40% creator share
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
      obs,
      environment: 'test',
      webAppUrl: 'https://app.example.test',
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
    expect(data.deepLinkUrl).toContain(
      'https://app.example.test/studio/negotiations'
    );
    expect(data.orgName).toBe('Acme Studios');
  });

  it('zero candidates → no emails, no marks, no errors', async () => {
    resetState();
    sharedMockState.enrichedCandidates = [];
    const mailer = vi.fn<MailerFn>(async () => undefined);
    const { obs } = buildObs();

    const result = await runAgreementExpiringSweep({
      // biome-ignore lint/suspicious/noExplicitAny: db is unused by the mocked service
      db: {} as any,
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
});
