import type { KVNamespace, R2Bucket } from '@cloudflare/workers-types';
import { R2Service, type R2SigningConfig } from '@codex/cloudflare-clients';
import { CONTENT_STATUS, ENV_NAMES, type Env } from '@codex/constants';
import { createPerRequestDbClient } from '@codex/database';
import { content } from '@codex/database/schema';
import {
  createLazyStripeClient,
  createStripeClient,
  PurchaseService,
} from '@codex/purchase';
import {
  BaseService,
  type ServiceConfig,
  ValidationError,
} from '@codex/service-errors';
import type { EntitlementResolver } from '@codex/shared-types';
import { buildServiceUrl } from '@codex/urls';
import type {
  GetPlaybackProgressInput,
  GetStreamingUrlInput,
  ListUserLibraryInput,
  SavePlaybackProgressInput,
  WithdrawnContentQuery,
} from '@codex/validation';
import { and, eq, isNotNull, isNull, ne } from 'drizzle-orm';
import { LOG_EVENTS, LOG_SEVERITY } from '../constants';
import { AccessDeniedError, ContentNotFoundError } from '../errors';
import type {
  ContentBodySource,
  ContentHeld,
  ContentHeldBy,
  CourseEntryResponse,
  WithdrawnContent,
} from '../types';
import { AccessRevocation } from './access-revocation';
import {
  type AccessGrant,
  assertStreamingAccess,
  type GrantVia,
  isOfDeletedOrg,
  resolveContentGrant,
  resolveCourseDisputePauses,
  resolveHasContentAccess,
  type SubscriptionGrantVia,
} from './content-access/access-decision';
import {
  hasCourseEntitlement,
  resolveCourseEntitlementsBatch,
} from './content-access/entitlements-resolver';
import {
  listUserLibrary as buildUserLibrary,
  type UserLibraryResponse,
} from './content-access/library';
import {
  getPlaybackProgress as fetchPlaybackProgress,
  savePlaybackProgress as persistPlaybackProgress,
} from './content-access/playback-progress';
import { DevR2Signer, type R2Signer } from './content-access/r2-signer';
import {
  getHlsMasterPlaylist as buildHlsMasterPlaylist,
  getHlsVariantPlaylist as buildHlsVariantPlaylist,
  buildStreamingResponse,
  resolveStreamableMedia,
} from './content-access/streaming';

/**
 * Default TTL (in seconds) for presigned streaming URLs.
 *
 * Bounds how long a signed R2 URL remains valid after issuance, which is
 * the maximum window during which a revoked user (cancelled subscription,
 * failed payment, refund) can still stream content with a URL minted before
 * revocation. Cryptographic presigned URLs cannot be invalidated once issued,
 * so this TTL is the primary exposure-after-revocation control.
 *
 * 600s (10 min) balances:
 *   - Short enough that revocation takes effect within one client refresh cycle.
 *   - Long enough to cover a typical HLS segment fetch window without the
 *     client re-requesting a new URL mid-stream (HLS.js re-fetches the
 *     master playlist URL on manifest refresh, not per-segment).
 *
 * Callers may override by passing `input.expirySeconds` — bounded by the
 * Zod schema (`getStreamingUrlSchema`) to [300, 7200].
 *
 * See docs/payments/access.md — "Streaming revocation".
 */
export const DEFAULT_STREAMING_URL_TTL_SECONDS = 600;

export interface ContentAccessServiceConfig extends ServiceConfig {
  r2: R2Signer;
  purchaseService: PurchaseService;
  /**
   * Optional access revocation helper — when provided, `savePlaybackProgress`
   * (and, in a follow-up, `getStreamingUrl`) short-circuits on a revocation
   * key hit before performing any DB work.
   *
   * Injected by the service registry when `CACHE_KV` is bound. Omitted in
   * environments without KV (narrow unit tests, legacy factory callers);
   * in those paths the DB-level access check still runs.
   */
  revocation?: AccessRevocation;
  /**
   * Public origin of the content-api worker, e.g.
   * `https://api.revelations.studio` (prod) or `http://localhost:4001` (dev).
   *
   * `getStreamingUrl` returns a master-playlist PROXY URL on this origin
   * (instead of a direct presigned R2 master URL) so the proxy can rewrite
   * relative child URIs and re-sign them. Derived from
   * `buildServiceUrl('content', env)`. Optional so narrow unit tests that
   * never call the streaming path can omit it; a missing value at stream time
   * throws a typed error rather than emitting a broken URL.
   */
  contentApiBaseUrl?: string;
  /**
   * HMAC secret used to sign/verify short-lived HLS playlist-proxy tokens.
   *
   * Reuses `WORKER_SHARED_SECRET` (already provisioned on content-api, never
   * leaves the worker) — see factory/registry wiring. Optional for the same
   * reason as `contentApiBaseUrl`.
   */
  hlsTokenSecret?: string;
  /**
   * The env-owned public CDN base (`R2_PUBLIC_URL_BASE`). The library turns a
   * video poster's bare R2 key into a URL with it (Codex-kk9nv.6). Optional:
   * without it, an item with no custom thumbnail has no picture, never a key.
   */
  r2PublicUrlBase?: string;
}

/**
 * How the arm that granted a withdrawn item holds it, for the note the detail
 * page shows (Codex-ov2ii). Exhaustive over every arm but the two subscription
 * ones, so a new arm cannot ship without a note. A subscription grant carries
 * its period, so {@link heldFrom} reads it from the grant itself: those arms
 * reach here only through the departed-creator rule, until the next renewal.
 *
 * The nulls are the arms the decision never grants an unpublished row
 * (`GRANT_SURVIVES_UNPUBLICATION`): `free`, a follow, and every staff arm.
 * Staff preview their own drafts in the studio, so the team keeps the 404 on
 * a public URL.
 */
const HELD_BY: Record<
  Exclude<GrantVia, SubscriptionGrantVia>,
  Exclude<ContentHeldBy, 'subscription'> | null
> = {
  paid_purchase: 'purchase',
  subscribers_purchase: 'purchase',
  paid_entitlement: 'entitlement',
  subscribers_entitlement: 'entitlement',
  course: 'course',
  paid_course: 'course',
  subscribers_course: 'course',
  free: null,
  followers_follower: null,
  management: null,
  team_management: null,
  followers_management: null,
  subscribers_management: null,
  paid_management: null,
};

/** How a grant holds a withdrawn item, or null for an arm with no note. */
function heldFrom(grant: AccessGrant): ContentHeld | null {
  if ('periodEnd' in grant) {
    return { by: 'subscription', until: grant.periodEnd.toISOString() };
  }
  const by = HELD_BY[grant.via];
  return by == null ? null : { by, until: null };
}

/**
 * Content Access Service
 *
 * Responsibilities:
 * 1. Verify user has access to content (purchase or free)
 * 2. Generate time-limited signed R2 URLs for streaming
 * 3. Track video playback progress for resume functionality
 * 4. List user's content library with progress
 *
 * Security:
 * - All methods require authenticated userId
 * - Purchase verification before generating signed URLs
 * - Only published, non-deleted content is accessible
 * - Row-level security enforced via user_id filters
 *
 * Integration points:
 * - P1-CONTENT-001: Queries content and media_items tables
 * - P1-ECOM-001: Verifies purchases table for access
 * - R2 Service: Generates presigned URLs via AWS SDK
 *
 * Structure (Codex-2pryk.1.1): this class is a thin facade. The access
 * decision trees, streaming-URL/HLS logic, library aggregation, and playback
 * progress live in cohesive modules under `./content-access/*`; each method
 * delegates to them, injecting the collaborators (`db`, `obs`, `r2`,
 * `purchaseService`, `revocation`) they need.
 */
export class ContentAccessService
  extends BaseService
  implements EntitlementResolver
{
  private readonly r2: R2Signer;
  private readonly purchaseService: PurchaseService;
  private readonly revocation: AccessRevocation | undefined;
  private readonly contentApiBaseUrl: string | undefined;
  private readonly hlsTokenSecret: string | undefined;
  private readonly r2PublicUrlBase: string | undefined;

  constructor(config: ContentAccessServiceConfig) {
    super(config);
    this.r2 = config.r2;
    this.purchaseService = config.purchaseService;
    this.revocation = config.revocation;
    this.contentApiBaseUrl = config.contentApiBaseUrl;
    this.hlsTokenSecret = config.hlsTokenSecret;
    this.r2PublicUrlBase = config.r2PublicUrlBase;
  }

  /**
   * `EntitlementResolver.canView` (frozen contract, SPEC §6.3) — may the user
   * open this content ANYWHERE? The single authority `getStreamingUrl` gates on;
   * the boolean adapter over the collapsed decision core (see
   * `./content-access/access-decision.ts`). Does NOT throw on denial and does NOT
   * sign URLs. `userId` is `null` for anonymous visitors (public / free content).
   */
  async canView(userId: string | null, contentId: string): Promise<boolean> {
    return resolveHasContentAccess(
      {
        db: this.db,
        purchaseService: this.purchaseService,
        obs: this.obs,
      },
      userId,
      contentId
    );
  }

  /**
   * Check whether a user currently has access to a piece of content.
   *
   * Retained name for existing callers (`savePlaybackProgress` gate, content
   * invalidation fanout); delegates to {@link canView}, the collapsed resolver.
   */
  async hasContentAccess(userId: string, contentId: string): Promise<boolean> {
    return this.canView(userId, contentId);
  }

  /**
   * `EntitlementResolver.canEnterCourse` (frozen contract, SPEC §6.3) — may the
   * user open this course's DASHBOARD / journey? Course-scoped, so shared content
   * never leaks course access ("bought Course A that shares practice X with B" ⇒
   * can view X, cannot enter B). Grants on a course entitlement: a stored grant
   * (`course_purchase` / `course_subscription` / `grant`) OR a derived tier grant
   * (an active subscription intersecting `course_tier_access`). Tier grants are
   * derived live, so a lapsed tier loses course entry instantly — this is why the
   * gate is entitlement-based, NOT a stale `course_enrollments` row.
   */
  async canEnterCourse(
    userId: string | null,
    courseId: string
  ): Promise<boolean> {
    if (userId == null) return false;
    return hasCourseEntitlement(this.db, userId, courseId);
  }

  /**
   * The course page's can-enter answer (Codex-2hxff.60): {@link canEnterCourse},
   * unchanged, and on a refusal the dispute that holds the user's grant back,
   * by the course shelf's predicate (`resolveCourseDisputePauses`), so the
   * page shows the dispute notice instead of Buy or Join. A granted call costs
   * nothing more.
   *
   * The hold only picks the copy: if its lookup fails, the failure is logged
   * at error and the refusal stands with no hold, never a 500.
   */
  async getCourseEntry(
    userId: string,
    courseId: string
  ): Promise<CourseEntryResponse> {
    const canEnter = await this.canEnterCourse(userId, courseId);
    if (canEnter) return { canEnter, disputeHold: null };
    try {
      const pauses = await resolveCourseDisputePauses(this.db, userId, [
        courseId,
      ]);
      return { canEnter, disputeHold: pauses.get(courseId) ?? null };
    } catch (error) {
      this.obs.error('Course entry: the dispute lookup failed; no hold shown', {
        userId,
        courseId,
        error: error instanceof Error ? error.message : String(error),
      });
      return { canEnter, disputeHold: null };
    }
  }

  /**
   * `EntitlementResolver.canEnterCoursesBatch` (frozen contract) — resolve MANY
   * courses in a BOUNDED number of queries (two `SELECT`s, independent of N) so a
   * dashboard/library grid avoids N+1 on Neon HTTP (HARDENING §D/§E/§12). Returns
   * a map keyed by every requested course id (missing/denied ⇒ `false`).
   */
  async canEnterCoursesBatch(
    userId: string | null,
    courseIds: readonly string[]
  ): Promise<ReadonlyMap<string, boolean>> {
    const result = new Map<string, boolean>(courseIds.map((id) => [id, false]));
    if (userId == null || courseIds.length === 0) return result;

    const entitled = await resolveCourseEntitlementsBatch(
      this.db,
      userId,
      courseIds
    );
    for (const id of courseIds) {
      result.set(id, entitled.has(id));
    }
    return result;
  }

  /**
   * Generate signed streaming URL for content.
   *
   * Access control flow:
   * 1. KV revocation short-circuit (before any DB work, when wired)
   * 2. Read-only transaction: fetch content + media, run the access decision
   *    (`assertStreamingAccess`), then resolve the streamable media target
   * 3. Mint a short-lived HLS token and return the master-playlist proxy URL
   *
   * Transaction safety: access verification + media resolution share one
   * read-committed, read-only snapshot.
   *
   * With `options.includeBody`, the result also carries the content's body,
   * taken from the row the access decision just read, only once that decision
   * granted. A draft never published is granted to no one (Codex-nacky), so
   * its text never leaves here. It is how an entitled reader gets a gated
   * piece's body: the public content API returns a body only for fully public
   * rows (Codex-039vo). The detail pages ask for it; the player's URL
   * refreshes do not, so they never carry it.
   *
   * @param userId - Authenticated user ID
   * @param input - Content ID and optional expiry
   * @param options.includeBody - Also return the body (after access is granted)
   * @returns Streaming URL and expiration timestamp
   * @throws {ContentNotFoundError} Content doesn't exist, is deleted, or its
   *   organisation is deleted
   * @throws {AccessDeniedError} User hasn't purchased content and isn't org member
   * @throws {R2SigningError} Failed to generate signed URL
   */
  async getStreamingUrl(
    userId: string,
    input: GetStreamingUrlInput,
    options: { includeBody?: boolean } = {}
  ): Promise<{
    streamingUrl: string | null;
    waveformUrl: string | null;
    expiresAt: Date;
    contentType: 'video' | 'audio' | 'written';
    /**
     * HLS variants ready to stream (e.g. `['1080p', '720p', '480p', '360p']`).
     * Surfaced so the player can render a manual quality picker; omitted
     * when the media item has no recorded variants, or for written content.
     */
    readyVariants?: string[];
    /**
     * The content's body. Present only when `options.includeBody` was set and
     * access was granted.
     */
    body?: ContentBodySource;
  }> {
    // Resolve the TTL once. The Zod schema already applies a default when
    // input flows through `procedure()`, but programmatic callers that
    // construct `GetStreamingUrlInput` directly may omit `expirySeconds`;
    // fall back to the module-level constant so the safe default is
    // enforced at the service boundary regardless of entry path.
    const expirySeconds =
      input.expirySeconds ?? DEFAULT_STREAMING_URL_TTL_SECONDS;

    this.obs.info('Getting streaming URL', {
      userId,
      contentId: input.contentId,
      expirySeconds,
    });

    try {
      // ── Access revocation short-circuit ─────────────────────────────
      // KV revocation check runs BEFORE the DB transaction. A warm KV read
      // (~0.5ms) is dramatically cheaper than opening a read-only transaction
      // and issuing the access-decision queries, so any revocation hit
      // rejects without touching the DB. Mirrors the sibling gate in
      // `savePlaybackProgress` (see "Playback progress" in
      // docs/payments/access.md).
      //
      // This runs only when `this.revocation` is wired (i.e. CACHE_KV is
      // bound). Standalone factory callers that omit the KV binding skip
      // this check silently — the DB-level access decision still catches
      // unauthorized access inside the transaction below.
      if (this.revocation) {
        const contentRow = await this.db.query.content.findFirst({
          where: and(
            eq(content.id, input.contentId),
            isNull(content.deletedAt)
          ),
          columns: { organizationId: true },
          with: { organization: { columns: { deletedAt: true } } },
        });

        // Personal content (no organizationId) can't be revoked at the org
        // scope — fall through to the transaction below. The content row
        // may also be missing entirely (not found / deleted), or belong to a
        // deleted org (Codex-7ncbh); let the transaction surface
        // `ContentNotFoundError` with consistent context rather than
        // duplicating the 404 path here. A revocation answered first would
        // name its reason, a paused dispute included, for an item that is
        // gone.
        const orgId = isOfDeletedOrg(contentRow)
          ? null
          : (contentRow?.organizationId ?? null);
        if (orgId) {
          const revocation = await this.revocation.isRevoked(userId, orgId);
          if (revocation) {
            this.obs.warn('getStreamingUrl blocked — access revoked', {
              userId,
              contentId: input.contentId,
              organizationId: orgId,
              reason: revocation.reason,
              securityEvent: LOG_EVENTS.UNAUTHORIZED_ACCESS,
              severity: LOG_SEVERITY.MEDIUM,
              eventType: LOG_EVENTS.ACCESS_CONTROL,
            });
            throw new AccessDeniedError(userId, input.contentId, {
              message: 'Access revoked',
              reason: revocation.reason,
              organizationId: orgId,
            });
          }
        }
      }

      // Step 1 & 2: Verify access and fetch content/media data within a
      // read-only transaction (consistent snapshot for access verification).
      const { target, body } = await this.db.transaction(
        async (tx) => {
          // Get content with media details (any organization)
          // No `status` predicate (Codex-p3m5j). `assertStreamingAccess` runs
          // the same decision core as the boolean path, whose publication rule
          // grants unpublished content to a purchase-derived arm only — so a
          // one-off buyer keeps playback after the creator withdraws the item
          // from sale, and everyone else still gets AccessDeniedError.
          //
          // Filtering here would 404 the buyer before their purchase was
          // considered, and a 404 is also the WRONG shape: the item exists and
          // they own it. `deletedAt` STAYS — deleted is gone, not withdrawn.
          // So is an item of a deleted organisation, to every arm (Codex-7ncbh),
          // decided here, before the access decision, so its refusal is never
          // named a paused payment dispute.
          const contentRecord = await tx.query.content.findFirst({
            where: and(
              eq(content.id, input.contentId),
              isNull(content.deletedAt)
            ),
            with: {
              mediaItem: true, // Includes r2_key, content_type, duration
              organization: { columns: { deletedAt: true } },
            },
          });

          if (!contentRecord || isOfDeletedOrg(contentRecord)) {
            this.obs.warn('Content not found or not accessible', {
              contentId: input.contentId,
              userId,
              organizationDeleted: isOfDeletedOrg(contentRecord),
            });

            throw new ContentNotFoundError(input.contentId);
          }

          // Access decision (orgless guard + accessType tree). Throws
          // AccessDeniedError on denial; returns normally on grant.
          await assertStreamingAccess(
            tx,
            { purchaseService: this.purchaseService, obs: this.obs },
            userId,
            input.contentId,
            contentRecord
          );

          // Access check passed — resolve the streamable media target
          // (written article → null-URL, else validated HLS descriptor). The
          // body, when asked for, is this same row's: read under the snapshot
          // that granted access, after the decision, never before it. A row
          // never released got this far for no arm (Codex-nacky), so a grant
          // here is a grant to its text too.
          return {
            target: resolveStreamableMedia(
              this.obs,
              input.contentId,
              contentRecord
            ),
            body: options.includeBody
              ? {
                  contentBody: contentRecord.contentBody,
                  contentBodyJson: contentRecord.contentBodyJson,
                }
              : undefined,
          };
        },
        {
          isolationLevel: 'read committed', // Consistent snapshot for access verification
          accessMode: 'read only', // All operations are reads
        }
      );

      // Step 3: Build the streaming response (written null-URL, or mint the
      // HLS token + master-playlist proxy URL and presign the waveform).
      const response = await buildStreamingResponse(
        target,
        {
          r2: this.r2,
          contentApiBaseUrl: this.contentApiBaseUrl,
          hlsTokenSecret: this.hlsTokenSecret,
          obs: this.obs,
        },
        userId,
        input.contentId,
        expirySeconds
      );
      return body ? { ...response, body } : response;
    } catch (error) {
      this.handleError(error, 'getStreamingUrl');
    }
  }

  /**
   * An item that was published once, is not now, and that this reader still
   * has access to, by its detail URL's key (Codex-ov2ii).
   *
   * An item leaves the storefront when its creator unpublishes it, or when the
   * creator leaves the organisation (archived, stamped `offSaleAt`). The access
   * decision keeps granting some readers (a buyer, a course owner, a
   * subscriber until their next renewal; never staff, who preview in the
   * studio), but the detail pages found rows only through the published-only
   * public list, so those readers got "Content not found".
   *
   * Narrow on purpose: a published row is the public list's, and a row never
   * released (`publishedAt` null) is a draft that was never offered. The
   * decision is the streaming path's (same revocation check, same read-only
   * snapshot, same `decideContentAccess`), so this is not a second access rule.
   *
   * Every miss is the SAME 404, keyed on the slug the caller sent: no row,
   * deleted, a deleted org, revoked, or denied. A reader without access must
   * not learn that a withdrawn item exists, and `ContentNotFoundError`'s
   * context is serialised to the client.
   *
   * Revoked is a 404 too, by choice. On a published item a revoked reader
   * sees why (`AccessRevokedOverlay`, e.g. "payment failed"); here they see
   * "not found" for as long as the revocation key lives (its KV TTL, minutes).
   * Telling them why would need the row looked up first, for a reader the
   * gate has just refused, and a withdrawn item is the rarer page.
   *
   * @returns The public row's shape with no body, and how the reader holds it
   * @throws {ContentNotFoundError} In every case but a grant
   */
  async getWithdrawnContent(
    userId: string,
    query: WithdrawnContentQuery
  ): Promise<WithdrawnContent> {
    const notFound = () => new ContentNotFoundError(query.slug);

    try {
      if (this.revocation && 'orgId' in query) {
        const revocation = await this.revocation.isRevoked(userId, query.orgId);
        if (revocation) {
          // As getStreamingUrl logs it, so monitoring sees revoked attempts
          // on this path too.
          this.obs.warn('getWithdrawnContent blocked — access revoked', {
            userId,
            organizationId: query.orgId,
            reason: revocation.reason,
            securityEvent: LOG_EVENTS.UNAUTHORIZED_ACCESS,
            severity: LOG_SEVERITY.MEDIUM,
            eventType: LOG_EVENTS.ACCESS_CONTROL,
          });
          throw notFound();
        }
      }

      const conditions = [
        eq(content.slug, query.slug),
        ne(content.status, CONTENT_STATUS.PUBLISHED),
        isNotNull(content.publishedAt),
        isNull(content.deletedAt),
      ];
      if ('orgId' in query) {
        conditions.push(eq(content.organizationId, query.orgId));
      } else {
        conditions.push(
          eq(content.creatorId, query.creatorId),
          isNull(content.organizationId)
        );
      }

      const { row, grant } = await this.db.transaction(
        async (tx) => {
          const found = await tx.query.content.findFirst({
            where: and(...conditions),
            with: {
              mediaItem: true,
              // The public list's creator projection: no email.
              creator: { columns: { id: true, name: true } },
              organization: true,
            },
          });
          // A deleted org's pieces are gone with it, as on the public list.
          if (!found || isOfDeletedOrg(found)) {
            throw notFound();
          }

          const decision = await resolveContentGrant(
            tx,
            { purchaseService: this.purchaseService, obs: this.obs },
            userId,
            found.id,
            found
          );
          if ('reason' in decision) {
            this.obs.info('Withdrawn content: no access', {
              userId,
              contentId: found.id,
              reason: decision.reason,
            });
            throw notFound();
          }
          return { row: found, grant: decision.grant };
        },
        { isolationLevel: 'read committed', accessMode: 'read only' }
      );

      const held = heldFrom(grant);
      // The decision never grants these arms an unpublished row; if it ever
      // does, say so and fail closed rather than invent a reason for the note.
      if (held == null) {
        this.obs.error('Withdrawn content granted by an arm with no note', {
          userId,
          contentId: row.id,
          via: grant.via,
        });
        throw notFound();
      }

      return {
        // No body: it comes from `/stream?include=body`, as for any gated
        // piece. No topic slugs: only the org landing reads them.
        content: {
          ...row,
          contentBody: null,
          contentBodyJson: null,
          categorySlugs: [],
        },
        held,
      };
    } catch (error) {
      this.handleError(error, 'getWithdrawnContent');
    }
  }

  /**
   * Read the HLS MASTER playlist from R2 and rewrite each child variant URI to
   * an absolute variant-proxy URL carrying the SAME token (WP-14).
   *
   * Auth is the verified token (checked at the route via `verifyHlsToken`) —
   * this method does NOT re-run the DB access decision.
   *
   * @returns Rewritten master playlist text, or `null` when the master object
   *          is absent in R2 (route maps to 404).
   *
   * Called at workers/content-api/src/routes/content-access.ts:230 on the
   * `service` destructured from `createContentAccessService(c.env)` — this
   * route bypasses procedure() to own its DB lifecycle, so the receiver is a
   * factory's destructured return value, which dead-code detection cannot
   * resolve to this class.
   */
  // fallow-ignore-next-line unused-class-member
  async getHlsMasterPlaylist(input: {
    contentId: string;
    creatorId: string;
    mediaId: string;
    token: string;
  }): Promise<string | null> {
    return buildHlsMasterPlaylist(
      { r2: this.r2, contentApiBaseUrl: this.contentApiBaseUrl },
      input
    );
  }

  /**
   * Read an HLS VARIANT playlist from R2 and rewrite each relative segment URI
   * to an absolute SigV4-presigned R2 URL (WP-14).
   *
   * @returns Rewritten variant playlist text, or `null` when the variant
   *          object is absent in R2 (route maps to 404).
   *
   * Called at workers/content-api/src/routes/content-access.ts:287, same
   * destructured-factory receiver as `getHlsMasterPlaylist` above.
   */
  // fallow-ignore-next-line unused-class-member
  async getHlsVariantPlaylist(input: {
    creatorId: string;
    mediaId: string;
    variant: string;
    expirySeconds: number;
  }): Promise<string | null> {
    return buildHlsVariantPlaylist({ r2: this.r2 }, input);
  }

  /**
   * Save playback progress (upsert pattern).
   *
   * Access gate: KV revocation check, then a DB-level access check
   * (`hasContentAccess`), then the upsert. See
   * `./content-access/playback-progress.ts` for the full contract.
   *
   * @throws {ForbiddenError} Access revoked, or user lacks access to content
   */
  async savePlaybackProgress(
    userId: string,
    input: SavePlaybackProgressInput
  ): Promise<void> {
    return persistPlaybackProgress(
      {
        db: this.db,
        obs: this.obs,
        revocation: this.revocation,
        checkAccess: (uid, cid) => this.hasContentAccess(uid, cid),
      },
      userId,
      input
    );
  }

  /**
   * Get playback progress for specific content.
   *
   * @returns Progress object or null
   */
  async getPlaybackProgress(
    userId: string,
    input: GetPlaybackProgressInput
  ): Promise<{
    positionSeconds: number;
    durationSeconds: number;
    completed: boolean;
    updatedAt: Date;
  } | null> {
    return fetchPlaybackProgress({ db: this.db }, userId, input);
  }

  /**
   * List user's purchased content library with playback progress.
   *
   * @returns Paginated list of content with progress
   */
  async listUserLibrary(
    userId: string,
    input: ListUserLibraryInput
  ): Promise<UserLibraryResponse> {
    return buildUserLibrary(
      {
        db: this.db,
        obs: this.obs,
        r2PublicUrlBase: this.r2PublicUrlBase,
        purchaseService: this.purchaseService,
      },
      userId,
      input
    );
  }
}

/**
 * Environment configuration for ContentAccessService
 *
 * This type uses Partial to align with the shared Bindings type,
 * but the factory function validates all required fields are present.
 */
export interface ContentAccessEnv {
  /** R2 bucket binding from Cloudflare Workers */
  MEDIA_BUCKET?: R2Bucket;
  /** KV namespace for access revocation block list (optional) */
  CACHE_KV?: KVNamespace;
  /** Environment name (development, staging, production) */
  ENVIRONMENT?: string;
  /** Cloudflare Account ID for R2 endpoint */
  R2_ACCOUNT_ID?: string;
  /** R2 API token Access Key ID */
  R2_ACCESS_KEY_ID?: string;
  /** R2 API token Secret Access Key */
  R2_SECRET_ACCESS_KEY?: string;
  /** R2 bucket name for media (e.g., codex-media-production) */
  R2_BUCKET_MEDIA?: string;
  /** Base URL for dev-cdn proxy (local development only, e.g. http://localhost:4100) */
  R2_PUBLIC_URL_BASE?: string;
  /** Stripe secret key for purchase verification */
  STRIPE_SECRET_KEY?: string;
  /** Database connection method (LOCAL_PROXY, NEON_BRANCH, PRODUCTION) */
  DB_METHOD?: string;
  /** Database URL for connections */
  DATABASE_URL?: string;
  /** Local proxy database URL (for LOCAL_PROXY mode) */
  DATABASE_URL_LOCAL_PROXY?: string;
  /**
   * Worker-to-worker HMAC shared secret. Reused (WP-14) to sign/verify the
   * short-lived HLS playlist-proxy tokens — already provisioned on content-api,
   * never leaves the worker.
   */
  WORKER_SHARED_SECRET?: string;
  /** Per-service URL override consumed by `buildServiceUrl('content', env)`. */
  API_URL?: string;
}

/**
 * Factory function for dependency injection
 *
 * Used in API endpoints to create service instance with environment config.
 * Requires R2 signing credentials for presigned URL generation.
 *
 * @throws Error if required environment variables are missing
 */
export function createContentAccessService(env: ContentAccessEnv): {
  service: ContentAccessService;
  cleanup: () => Promise<void>;
} {
  let r2: R2Signer;
  if (env.ENVIRONMENT === ENV_NAMES.DEVELOPMENT && env.R2_PUBLIC_URL_BASE) {
    r2 = new DevR2Signer(env.R2_PUBLIC_URL_BASE);
  } else {
    if (!env.MEDIA_BUCKET) {
      throw new ValidationError('MEDIA_BUCKET binding is required', {
        field: 'MEDIA_BUCKET',
      });
    }
    if (!env.R2_ACCOUNT_ID) {
      throw new ValidationError(
        'R2_ACCOUNT_ID environment variable is required',
        {
          field: 'R2_ACCOUNT_ID',
        }
      );
    }
    if (!env.R2_ACCESS_KEY_ID) {
      throw new ValidationError(
        'R2_ACCESS_KEY_ID environment variable is required',
        {
          field: 'R2_ACCESS_KEY_ID',
        }
      );
    }
    if (!env.R2_SECRET_ACCESS_KEY) {
      throw new ValidationError(
        'R2_SECRET_ACCESS_KEY environment variable is required',
        {
          field: 'R2_SECRET_ACCESS_KEY',
        }
      );
    }
    if (!env.R2_BUCKET_MEDIA) {
      throw new ValidationError(
        'R2_BUCKET_MEDIA environment variable is required',
        {
          field: 'R2_BUCKET_MEDIA',
        }
      );
    }

    const signingConfig: R2SigningConfig = {
      accountId: env.R2_ACCOUNT_ID,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      bucketName: env.R2_BUCKET_MEDIA,
    };

    r2 = new R2Service(env.MEDIA_BUCKET, {}, signingConfig);
  }

  // Create per-request database client with WebSocket support for transactions
  const { db, cleanup } = createPerRequestDbClient(env);

  // Create Stripe client and PurchaseService.
  //
  // The streaming access path only calls PurchaseService.verifyPurchase (a DB
  // read) and never touches the Stripe API. content-api is intentionally NOT
  // provisioned with a STRIPE_SECRET_KEY (Stripe secrets are ecom-api only),
  // so when the key is absent we build a lazy client that constructs freely
  // but throws only if a Stripe call is ever attempted — otherwise every
  // stream request would 500 with "Stripe API key is required" (Codex-eys81).
  const environment = env.ENVIRONMENT ?? 'development';
  const stripe = env.STRIPE_SECRET_KEY
    ? createStripeClient(env.STRIPE_SECRET_KEY)
    : createLazyStripeClient();
  const purchaseService = new PurchaseService({ db, environment }, stripe);
  const revocation = env.CACHE_KV
    ? new AccessRevocation(env.CACHE_KV)
    : undefined;

  // Public content-api origin for the HLS playlist-proxy URLs returned by
  // getStreamingUrl. `buildServiceUrl('content', env)` honours the API_URL
  // override, else falls back to the env's canonical content-api host.
  const contentApiBaseUrl = buildServiceUrl('content', env as unknown as Env);

  const service = new ContentAccessService({
    db,
    environment,
    r2,
    purchaseService,
    revocation,
    contentApiBaseUrl,
    hlsTokenSecret: env.WORKER_SHARED_SECRET,
    r2PublicUrlBase: env.R2_PUBLIC_URL_BASE,
  });

  // Return service with cleanup function
  return { service, cleanup };
}
