/**
 * What happens after a member's removal has committed (Codex-2hxff.18 and
 * Codex-2hxff.64). `OrganizationService.removeMember` ends the agreements and
 * takes the creator's catalogue off sale in its transaction, then hands this
 * the result through `onMemberRemoved`:
 *
 * 1. Course subscriptions to the courses taken off sale are cancelled at
 *    period end, at most 50 now (owner: "50 at once, rest hourly"); the
 *    hourly sweep cancels the rest.
 * 2. Caches that list the creator's items are cleared, so public pages and
 *    libraries stop showing them. Checkout already refuses them, so a stale
 *    cache shows an item that can't be bought, never one that sells.
 * 3. The creator gets one email listing what the removal ended (owner
 *    decision Q5). It replaces the separate `agreement-terminated` email.
 *
 * Each step is independent: a failure in one is logged and the others still
 * run. Nothing here can undo the removal.
 */

import { CacheType, type VersionedCache } from '@codex/cache';
import { invalidateContentAccess } from '@codex/content';
import type { Database } from '@codex/database';
import { eq, schema } from '@codex/database';
import type { MemberDeparture } from '@codex/organization';
import { invalidateOrgSlugCache } from '../cache-fanout';
import type { SendEmailToWorkerParams } from '../email/send-email';

/** Course subscriptions cancelled now. The hourly sweep does the rest. */
export const DEPARTURE_COURSE_CANCEL_LIMIT = 50;

interface DepartureLogger {
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
}

export interface MemberDepartureDeps {
  db: Database;
  /** Absent when the worker has no CACHE_KV binding: caches expire by TTL. */
  cache?: VersionedCache;
  waitUntil: (promise: Promise<unknown>) => void;
  cancelCourseSubscriptions: (params: {
    courseIds: readonly string[];
    limit: number;
  }) => Promise<{ cancelled: number; failed: number; remaining: number }>;
  /** Absent when the worker cannot send email: only the email is skipped. */
  sendEmail?: (params: SendEmailToWorkerParams) => void;
  obs: DepartureLogger;
}

export async function followUpMemberDeparture(
  deps: MemberDepartureDeps,
  departure: MemberDeparture
): Promise<void> {
  const { contentIds, courseIds } = departure.catalogue;

  let courseSubscriptionsEnding = 0;
  if (courseIds.length > 0) {
    try {
      const result = await deps.cancelCourseSubscriptions({
        courseIds,
        limit: DEPARTURE_COURSE_CANCEL_LIMIT,
      });
      // `remaining` still counts the failed ones: they stay eligible.
      courseSubscriptionsEnding = result.cancelled + result.remaining;
    } catch (error) {
      deps.obs.error('Departure course subscription cancel failed', {
        organizationId: departure.organizationId,
        creatorId: departure.creatorId,
        courseIds: courseIds.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (deps.cache && (contentIds.length > 0 || courseIds.length > 0)) {
    await clearDepartureCaches(deps, deps.cache, departure);
  }

  const somethingEnded =
    departure.endedAgreements.length > 0 ||
    contentIds.length > 0 ||
    courseIds.length > 0;
  if (somethingEnded && deps.sendEmail) {
    await sendRemovalEmail(deps, deps.sendEmail, departure, {
      courseSubscriptionsEnding,
    });
  }
}

async function clearDepartureCaches(
  deps: MemberDepartureDeps,
  cache: VersionedCache,
  departure: MemberDeparture
): Promise<void> {
  const { organizationId } = departure;
  try {
    await Promise.all([
      cache.invalidate(CacheType.COLLECTION_CONTENT_PUBLISHED),
      cache.invalidate(CacheType.COLLECTION_ORG_CONTENT(organizationId)),
      cache.invalidate(CacheType.CATEGORIES(organizationId)),
      cache.invalidate(CacheType.COLLECTION_ORG_JOURNEYS(organizationId)),
      invalidateOrgSlugCache({
        db: deps.db,
        cache,
        orgId: organizationId,
        logger: deps.obs,
      }),
    ]);
  } catch (error) {
    deps.obs.warn('Departure cache invalidation failed', {
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  // Per-user libraries, one item at a time: each fans out to the users who
  // could see it (capped inside invalidateContentAccess).
  for (const contentId of departure.catalogue.contentIds) {
    await invalidateContentAccess({
      db: deps.db,
      cache,
      waitUntil: deps.waitUntil,
      contentId,
      organizationId,
      reason: 'content_unpublished',
      logger: deps.obs,
    }).catch((error: unknown) => {
      deps.obs.warn('Departure library invalidation failed', {
        contentId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}

async function sendRemovalEmail(
  deps: MemberDepartureDeps,
  sendEmail: (params: SendEmailToWorkerParams) => void,
  departure: MemberDeparture,
  counts: { courseSubscriptionsEnding: number }
): Promise<void> {
  try {
    const [recipient, org] = await Promise.all([
      deps.db.query.users.findFirst({
        where: eq(schema.users.id, departure.creatorId),
        columns: { email: true, name: true },
      }),
      deps.db.query.organizations.findFirst({
        where: eq(schema.organizations.id, departure.organizationId),
        columns: { name: true },
      }),
    ]);
    if (!recipient?.email) {
      deps.obs.warn('Removal email skipped: recipient has no email', {
        organizationId: departure.organizationId,
        creatorId: departure.creatorId,
      });
      return;
    }
    sendEmail({
      to: recipient.email,
      toName: recipient.name || undefined,
      templateName: 'removed-from-organisation',
      category: 'transactional',
      userId: departure.creatorId,
      organizationId: departure.organizationId,
      data: {
        recipientName: recipient.name || 'there',
        orgName: org?.name ?? 'the organisation',
        removedOn: departure.at.toLocaleDateString('en-GB', {
          timeZone: 'UTC',
        }),
        agreementsEnded: String(departure.endedAgreements.length),
        contentOffSale: String(departure.catalogue.contentIds.length),
        coursesOffSale: String(departure.catalogue.courseIds.length),
        courseSubscriptionsEnding: String(counts.courseSubscriptionsEnding),
      },
    });
  } catch (error) {
    deps.obs.warn('Removal email failed', {
      organizationId: departure.organizationId,
      creatorId: departure.creatorId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
