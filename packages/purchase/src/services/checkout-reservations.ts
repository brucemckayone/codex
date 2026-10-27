/**
 * One open Stripe Checkout session per buyer and item (Codex-2hxff.14):
 * content and courses bought outright, and, since Codex-2hxff.15, a
 * subscription to an org's tiers or to a course plan ("Block early: same as
 * purchases").
 *
 * - The row is reserved under an advisory lock, backed by a partial unique
 *   index on `open` rows.
 * - A second tab gets the first tab's Stripe URL.
 * - A price change (or, for a subscription, another Stripe price: tier or
 *   interval), or less than 5 minutes left, replaces the session; the old one
 *   is expired at Stripe, best effort.
 * - The expiry is stored and sent as now + 31 min: Stripe's floor is 30
 *   minutes after ITS creation time.
 *
 * `PurchaseService`, `SubscriptionService` and `CourseSubscriptionService`
 * each hold one; the caller still decides what is sold and to whom.
 */

import {
  CHECKOUT_SESSION_KIND,
  CHECKOUT_SESSION_STATUS,
  CHECKOUT_SESSION_TIMING,
} from '@codex/constants';
import type { DatabaseClient } from '@codex/database';
import { type CheckoutSession, checkoutSessions } from '@codex/database/schema';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type Stripe from 'stripe';
import { ConflictError, PaymentProcessingError } from '../errors';
import type { CheckoutSessionResult } from '../types';

/** What a reservation is for, and the price it was made at. */
export type CheckoutReservationTarget = {
  customerId: string;
  amountCents: number;
} & (
  | { kind: 'purchase'; contentId: string }
  | { kind: 'purchase'; courseId: string }
  | { kind: 'subscription'; organizationId: string; stripePriceId: string }
  | { kind: 'subscription'; courseId: string; stripePriceId: string }
);

interface ReservationLogger {
  info(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
}

/** Stripe takes timestamps in whole epoch seconds. */
export function toStripeTime(at: Date): number {
  return Math.floor(at.getTime() / 1000);
}

/**
 * One key per reserved checkout session AND resolved Stripe Customer
 * (Codex-2hxff.14). Two tabs on the same reservation send identical
 * parameters and get the same session back. `withStaleCustomerRecovery`'s
 * retry with a recreated Customer gets a new key: Stripe compares a reused
 * key's parameters and would refuse the changed customer.
 */
export function checkoutIdempotencyKey(
  reserved: CheckoutSession,
  stripeCustomerId: string
): string {
  return `checkout_${reserved.id}_${stripeCustomerId}`;
}

/**
 * Another request is creating a session under the same idempotency key: 409
 * while it runs, or Stripe's idempotency error when its parameters differ.
 */
function isConcurrentCreate(error: unknown): boolean {
  const e = error as { statusCode?: unknown; type?: unknown } | null;
  return e?.statusCode === 409 || e?.type === 'StripeIdempotencyError';
}

/** A Stripe error's `code`, for logs (`charge_disputed`, ...). */
export function stripeErrorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

/** The target's item columns, for the insert and the open-row lookup. */
function itemColumns(target: CheckoutReservationTarget) {
  const subscription = target.kind === CHECKOUT_SESSION_KIND.SUBSCRIPTION;
  return {
    kind: target.kind,
    contentId: 'contentId' in target ? target.contentId : null,
    courseId: 'courseId' in target ? target.courseId : null,
    organizationId: 'organizationId' in target ? target.organizationId : null,
    stripePriceId: subscription ? target.stripePriceId : null,
  };
}

export class CheckoutReservations {
  constructor(
    private readonly db: DatabaseClient,
    private readonly stripe: Stripe,
    private readonly obs: ReservationLogger
  ) {}

  /**
   * The buyer's open reservation for the item, reused while it still stands;
   * otherwise a new one, the old one expired at Stripe.
   */
  async reserve(target: CheckoutReservationTarget): Promise<CheckoutSession> {
    const columns = itemColumns(target);
    const [item, itemId] =
      'contentId' in target
        ? [eq(checkoutSessions.contentId, target.contentId), target.contentId]
        : 'organizationId' in target
          ? [
              eq(checkoutSessions.organizationId, target.organizationId),
              target.organizationId,
            ]
          : [
              and(
                eq(checkoutSessions.courseId, target.courseId),
                eq(checkoutSessions.kind, target.kind)
              ),
              target.courseId,
            ];
    const lockKey = `checkout:${target.kind}:${target.customerId}:${itemId}`;

    const { reserved, replaced } = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
      const [open] = await tx
        .select()
        .from(checkoutSessions)
        .where(
          and(
            eq(checkoutSessions.customerId, target.customerId),
            item,
            eq(checkoutSessions.status, CHECKOUT_SESSION_STATUS.OPEN)
          )
        )
        .limit(1);

      const now = Date.now();
      // A row with no URL yet is another caller's session in flight; once it
      // is older than the slack its stored expiry is under Stripe's floor, so
      // its creator must have failed and it is replaced.
      if (
        open &&
        open.amountCents === target.amountCents &&
        open.stripePriceId === columns.stripePriceId &&
        open.expiresAt.getTime() - now >=
          CHECKOUT_SESSION_TIMING.MIN_REMAINING_TO_REUSE_MS &&
        (open.url !== null ||
          now - open.createdAt.getTime() <
            CHECKOUT_SESSION_TIMING.STRIPE_FLOOR_SLACK_MS)
      ) {
        return { reserved: open, replaced: null };
      }
      if (open) {
        await tx
          .update(checkoutSessions)
          .set({ status: CHECKOUT_SESSION_STATUS.EXPIRED })
          .where(eq(checkoutSessions.id, open.id));
      }
      const [row] = await tx
        .insert(checkoutSessions)
        .values({
          customerId: target.customerId,
          ...columns,
          amountCents: target.amountCents,
          expiresAt: new Date(
            now +
              CHECKOUT_SESSION_TIMING.TTL_MS +
              CHECKOUT_SESSION_TIMING.STRIPE_FLOOR_SLACK_MS
          ),
        })
        .returning();
      if (!row) {
        throw new PaymentProcessingError('Failed to reserve checkout session', {
          kind: target.kind,
          itemId,
        });
      }
      return { reserved: row, replaced: open?.stripeSessionId ?? null };
    });

    if (replaced) await this.expireReplaced(replaced);
    return reserved;
  }

  /**
   * Stop a replaced session taking payment. Best effort: Stripe refuses when
   * it was paid or has expired already. A payment made on it still completes,
   * and the second payment is then refunded as a duplicate, so nothing is
   * lost by carrying on.
   */
  private async expireReplaced(stripeSessionId: string): Promise<void> {
    try {
      await this.stripe.checkout.sessions.expire(stripeSessionId);
    } catch (error) {
      const details = {
        stripeSessionId,
        code: stripeErrorCode(error),
        error: error instanceof Error ? error.message : String(error),
      };
      // Refused because it is no longer open: expected. Anything else (auth,
      // network) means it may still take payment, so it is loud.
      if (
        (error as { type?: unknown } | null)?.type ===
        'StripeInvalidRequestError'
      ) {
        this.obs.info('Replaced checkout session was no longer open', details);
      } else {
        this.obs.error('Replaced checkout session could not be expired', {
          errorId: crypto.randomUUID(),
          ...details,
        });
      }
    }
  }

  /**
   * Create the reserved session at Stripe and record it.
   *
   * - A failure frees the reservation, so the next attempt starts afresh
   *   rather than replaying Stripe's stored answer for the key. The Stripe
   *   error is the one thrown, even if freeing the row fails too.
   * - A 409, or an idempotency error, means another caller (the other tab of
   *   a double click) is creating this session under the same key; the
   *   idempotency error when its parameters differ (the content page and the
   *   preview player send different cancel URLs). The session is theirs to
   *   record, so this waits briefly for it and returns it; if it never
   *   appears, the buyer is asked to try again in a moment.
   */
  async create(
    reserved: CheckoutSession,
    create: () => Promise<Stripe.Checkout.Session>
  ): Promise<CheckoutSessionResult> {
    let session: Stripe.Checkout.Session;
    try {
      session = await create();
    } catch (error) {
      if (isConcurrentCreate(error)) {
        return this.awaitConcurrent(reserved.id);
      }
      try {
        await this.db
          .update(checkoutSessions)
          .set({ status: CHECKOUT_SESSION_STATUS.EXPIRED })
          .where(
            and(
              eq(checkoutSessions.id, reserved.id),
              isNull(checkoutSessions.stripeSessionId)
            )
          );
      } catch (cleanupError) {
        // The row then stays open with no session until it is replaced at
        // its expiry; the Stripe error below is the one that matters.
        this.obs.error('Checkout reservation could not be freed', {
          errorId: crypto.randomUUID(),
          reservationId: reserved.id,
          error:
            cleanupError instanceof Error
              ? cleanupError.message
              : String(cleanupError),
        });
      }
      throw error;
    }
    if (!session.url) {
      throw new PaymentProcessingError('Checkout session URL not generated', {
        sessionId: session.id,
      });
    }
    await this.db
      .update(checkoutSessions)
      .set({ stripeSessionId: session.id, url: session.url })
      .where(eq(checkoutSessions.id, reserved.id));
    return { sessionUrl: session.url, sessionId: session.id };
  }

  /** The other caller's session, once it has recorded it (up to ~3 s). */
  private async awaitConcurrent(
    reservationId: string
  ): Promise<CheckoutSessionResult> {
    for (let attempt = 0; attempt < 12; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const [row] = await this.db
        .select({
          url: checkoutSessions.url,
          stripeSessionId: checkoutSessions.stripeSessionId,
        })
        .from(checkoutSessions)
        .where(eq(checkoutSessions.id, reservationId))
        .limit(1);
      if (row?.url && row.stripeSessionId) {
        return { sessionUrl: row.url, sessionId: row.stripeSessionId };
      }
    }
    throw new ConflictError(
      'Your checkout is still being prepared. Please try again in a moment.',
      { reservationId }
    );
  }

  /**
   * The webhook: this session was paid. The buyer's next checkout for the
   * item is refused because they own it, or subscribe, so this is a record,
   * not a gate.
   */
  async markCompleted(stripeSessionId: string): Promise<void> {
    await this.db
      .update(checkoutSessions)
      .set({ status: CHECKOUT_SESSION_STATUS.COMPLETED })
      .where(eq(checkoutSessions.stripeSessionId, stripeSessionId));
  }
}
