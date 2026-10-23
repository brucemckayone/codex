/**
 * What a course-subscription invoice records and refuses, and what its
 * checkout errors tell the client.
 *
 * - Codex-2hxff.19 AGR-06: an invoice has no row of its own, so its creator
 *   slice records the agreement it was split by
 *   (`payouts.creator_org_agreement_id`); without one it stays null.
 * - Codex-2hxff.23 PAY-25: an invoice in any currency but GBP is refused with
 *   `UnsupportedCurrencyError` (400, permanent) before anything is written, as
 *   tier invoices are, so no transfer is created.
 * - Codex-2hxff.23 SEC-02: Stripe's own message never goes in a client-facing
 *   error context; it is logged with an errorId.
 *
 * Real DB, mocked Stripe. Every row hangs off this file's own organisation
 * and users and is deleted in afterAll (the local database is shared).
 */

import { randomUUID } from 'node:crypto';
import * as schema from '@codex/database/schema';
import {
  mapErrorToResponse,
  ServiceError,
  UnsupportedCurrencyError,
} from '@codex/service-errors';
import {
  createMockStripe,
  createMockStripeInvoice,
  createMockStripeSubscription,
  createTestConnectAccountInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq, inArray } from 'drizzle-orm';
import type Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  COURSE_SUBSCRIPTION_METADATA_TYPE,
  CourseSubscriptionService,
} from '../course-subscription-service';

const STRIPE_SECRET_MESSAGE = 'No such checkout.session; acct_1Secret';

describe('course subscription records, currency and errors', () => {
  let db: Database;
  let stripe: Stripe;
  let service: CourseSubscriptionService;
  let subscriberId: string;
  let creatorId: string;
  let orgId: string;
  const users: string[] = [];
  const courseIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    stripe = createMockStripe();
    // A redelivered invoice resolves the same charge, as at Stripe.
    vi.mocked(stripe.paymentIntents.retrieve).mockImplementation((async (
      id: string
    ) => ({ id, latest_charge: id.replace(/^pi_/, 'ch_') })) as never);
    Object.assign(stripe.checkout.sessions, { retrieve: vi.fn() });
    service = new CourseSubscriptionService(
      { db, environment: 'test' },
      stripe
    );

    [subscriberId, creatorId] = await seedTestUsers(db, 2);
    users.push(subscriberId, creatorId);
    await db
      .insert(schema.stripeConnectAccounts)
      .values(createTestConnectAccountInput(null, creatorId));
    const org = takeFirst(
      await db
        .insert(schema.organizations)
        .values({ name: 'Course Records', slug: createUniqueSlug('cs-rec') })
        .returning({ id: schema.organizations.id })
    );
    orgId = org.id;
    await db.insert(schema.organizationMemberships).values({
      organizationId: orgId,
      userId: creatorId,
      role: 'owner',
      status: 'active',
    });
  });

  afterAll(async () => {
    const subs = await db
      .select({ id: schema.courseSubscriptions.id })
      .from(schema.courseSubscriptions)
      .where(inArray(schema.courseSubscriptions.userId, users));
    if (subs.length > 0) {
      await db.delete(schema.payouts).where(
        inArray(
          schema.payouts.courseSubscriptionId,
          subs.map((s) => s.id)
        )
      );
    }
    await db
      .delete(schema.entitlements)
      .where(inArray(schema.entitlements.userId, users));
    await db
      .delete(schema.courseEnrollments)
      .where(inArray(schema.courseEnrollments.userId, users));
    await db
      .delete(schema.courseSubscriptions)
      .where(inArray(schema.courseSubscriptions.userId, users));
    if (courseIds.length > 0) {
      await db
        .delete(schema.courseSubscriptionPlans)
        .where(inArray(schema.courseSubscriptionPlans.courseId, courseIds));
      await db
        .delete(schema.courses)
        .where(inArray(schema.courses.id, courseIds));
    }
    await db
      .delete(schema.creatorOrganizationAgreements)
      .where(eq(schema.creatorOrganizationAgreements.organizationId, orgId));
    await db
      .delete(schema.agreementProposals)
      .where(eq(schema.agreementProposals.organizationId, orgId));
    await db
      .delete(schema.stripeConnectAccounts)
      .where(inArray(schema.stripeConnectAccounts.userId, users));
    await db
      .delete(schema.organizationMemberships)
      .where(eq(schema.organizationMemberships.organizationId, orgId));
    await db
      .delete(schema.organizations)
      .where(eq(schema.organizations.id, orgId));
    await db.delete(schema.users).where(inArray(schema.users.id, users));
    await teardownTestDatabase();
  });

  /** A course plan by `author`, subscribed to and recorded. */
  async function subscribed(author: string) {
    const course = takeFirst(
      await db
        .insert(schema.courses)
        .values({
          organizationId: orgId,
          creatorId: author,
          slug: createUniqueSlug('cs-rec-course'),
          title: 'Records course',
          status: 'published',
          priceCents: null,
        })
        .returning({ id: schema.courses.id })
    );
    courseIds.push(course.id);
    const plan = takeFirst(
      await db
        .insert(schema.courseSubscriptionPlans)
        .values({
          courseId: course.id,
          priceMonthly: 5000,
          priceAnnual: 50000,
          stripeProductId: `prod_${randomUUID().slice(0, 8)}`,
          stripePriceMonthlyId: `price_m_${randomUUID().slice(0, 8)}`,
          stripePriceAnnualId: `price_a_${randomUUID().slice(0, 8)}`,
        })
        .returning({ id: schema.courseSubscriptionPlans.id })
    );
    const stripeSubId = `sub_${randomUUID().slice(0, 8)}`;
    const sub = createMockStripeSubscription({
      id: stripeSubId,
      customer: `cus_${randomUUID().slice(0, 8)}`,
      metadata: {
        type: COURSE_SUBSCRIPTION_METADATA_TYPE,
        codex_user_id: subscriberId,
        codex_course_id: course.id,
        codex_plan_id: plan.id,
        codex_organization_id: orgId,
      },
    }) as unknown as Stripe.Subscription;
    await service.handleCourseSubscriptionCreated(sub);
    const row = takeFirst(
      await db
        .select()
        .from(schema.courseSubscriptions)
        .where(eq(schema.courseSubscriptions.stripeSubscriptionId, stripeSubId))
    );
    return { sub, row };
  }

  /** An active `subscription` agreement for `author` at `share`. */
  async function agreementFor(author: string, share: number) {
    const effectiveFrom = new Date(Date.now() - 30 * 86_400_000);
    const proposal = takeFirst(
      await db
        .insert(schema.agreementProposals)
        .values({
          organizationId: orgId,
          creatorId: author,
          revenueType: 'subscription',
          roundNumber: 1,
          proposedByUserId: creatorId,
          proposedByRole: 'owner',
          proposedCreatorSharePercent: share,
          proposedEffectiveFrom: effectiveFrom,
          status: 'accepted',
        })
        .returning({ id: schema.agreementProposals.id })
    );
    return takeFirst(
      await db
        .insert(schema.creatorOrganizationAgreements)
        .values({
          organizationId: orgId,
          creatorId: author,
          organizationFeePercentage: 10_000 - share,
          revenueType: 'subscription',
          status: 'active',
          currentProposalId: proposal.id,
          effectiveFrom,
        })
        .returning({ id: schema.creatorOrganizationAgreements.id })
    );
  }

  const invoiceFor = (sub: Stripe.Subscription, currency: string) =>
    createMockStripeInvoice({
      amount_paid: 5000,
      currency,
      parent: {
        subscription_details: {
          subscription: sub.id,
          metadata: { type: COURSE_SUBSCRIPTION_METADATA_TYPE },
        },
      },
      payments: {
        data: [
          {
            payment: {
              type: 'payment_intent',
              payment_intent: `pi_${randomUUID().slice(0, 8)}`,
            },
          },
        ],
      },
    }) as unknown as Stripe.Invoice;

  const creatorSliceOf = async (courseSubscriptionId: string) =>
    (
      await db
        .select()
        .from(schema.payouts)
        .where(eq(schema.payouts.courseSubscriptionId, courseSubscriptionId))
    ).find((r) => r.payoutType === 'creator_payout');

  it("an invoice's creator slice records the agreement it was split by", async () => {
    const [author] = await seedTestUsers(db, 1);
    users.push(author);
    await db
      .insert(schema.stripeConnectAccounts)
      .values(createTestConnectAccountInput(null, author));
    const agreement = await agreementFor(author, 7000);
    const { sub, row } = await subscribed(author);

    await service.handleCourseInvoicePaymentSucceeded(
      invoiceFor(sub, 'gbp'),
      sub
    );

    const slice = await creatorSliceOf(row.id);
    expect(slice?.creatorOrgAgreementId).toBe(agreement.id);
    // 10% platform, then the author's 70% of the 4500 left.
    expect(slice?.amountCents).toBe(3150);
  });

  it('without an agreement the creator slice records none', async () => {
    const { sub, row } = await subscribed(creatorId);

    await service.handleCourseInvoicePaymentSucceeded(
      invoiceFor(sub, 'gbp'),
      sub
    );

    const slice = await creatorSliceOf(row.id);
    expect(slice).toBeDefined();
    expect(slice?.creatorOrgAgreementId).toBeNull();
  });

  it('a non-GBP invoice is refused before anything is written', async () => {
    const { sub, row } = await subscribed(creatorId);
    const transfers = vi.mocked(stripe.transfers.create);
    transfers.mockClear();
    // A renewal that would move the period on, if it were written.
    const renewed = {
      ...sub,
      items: {
        ...sub.items,
        data: sub.items.data.map((item) => ({
          ...item,
          current_period_end: item.current_period_end + 31 * 86_400,
        })),
      },
    } as Stripe.Subscription;

    const error = await service
      .handleCourseInvoicePaymentSucceeded(invoiceFor(renewed, 'usd'), renewed)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnsupportedCurrencyError);
    expect((error as ServiceError).statusCode).toBe(400);
    expect(transfers).not.toHaveBeenCalled();
    expect(await creatorSliceOf(row.id)).toBeUndefined();
    const after = takeFirst(
      await db
        .select({ end: schema.courseSubscriptions.currentPeriodEnd })
        .from(schema.courseSubscriptions)
        .where(eq(schema.courseSubscriptions.id, row.id))
    );
    expect(after.end?.getTime()).toBe(row.currentPeriodEnd?.getTime());
  });

  it("a checkout session Stripe cannot find: the client gets an errorId, not Stripe's message", async () => {
    const obs = (service as unknown as { obs: { error: () => void } }).obs;
    const logged = vi.spyOn(obs, 'error');
    vi.mocked(stripe.checkout.sessions.retrieve).mockRejectedValueOnce(
      Object.assign(new Error(STRIPE_SECRET_MESSAGE), {
        type: 'StripeInvalidRequestError',
        code: 'resource_missing',
      })
    );

    const error = await service
      .verifyCheckoutSession(`cs_${randomUUID()}`, subscriberId)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ServiceError);
    const details = mapErrorToResponse(error).response.error.details as
      | Record<string, unknown>
      | undefined;
    expect(JSON.stringify(details)).not.toContain(STRIPE_SECRET_MESSAGE);
    expect(details).not.toHaveProperty('stripeError');
    expect(details?.errorId).toEqual(expect.any(String));
    expect(logged).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        errorId: details?.errorId,
        error: STRIPE_SECRET_MESSAGE,
      })
    );
    logged.mockRestore();
  });
});
