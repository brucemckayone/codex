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
import { buildServiceUrl } from '@codex/urls';
import type {
  GetPlaybackProgressInput,
  GetStreamingUrlInput,
  ListUserLibraryInput,
  SavePlaybackProgressInput,
} from '@codex/validation';
import { and, eq, isNull } from 'drizzle-orm';
import { LOG_EVENTS, LOG_SEVERITY } from '../constants';
import { AccessDeniedError, ContentNotFoundError } from '../errors';
import { AccessRevocation } from './access-revocation';
import {
  assertStreamingAccess,
  resolveHasContentAccess,
} from './content-access/access-decision';
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
 * See docs/subscription-cache-audit/phase-2-followup.md — Phase 3.
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
export class ContentAccessService extends BaseService {
  private readonly r2: R2Signer;
  private readonly purchaseService: PurchaseService;
  private readonly revocation: AccessRevocation | undefined;
  private readonly contentApiBaseUrl: string | undefined;
  private readonly hlsTokenSecret: string | undefined;

  constructor(config: ContentAccessServiceConfig) {
    super(config);
    this.r2 = config.r2;
    this.purchaseService = config.purchaseService;
    this.revocation = config.revocation;
    this.contentApiBaseUrl = config.contentApiBaseUrl;
    this.hlsTokenSecret = config.hlsTokenSecret;
  }

  /**
   * Check whether a user currently has access to a piece of content.
   *
   * This is the boolean equivalent of the access-decision logic embedded in
   * `getStreamingUrl`'s transaction — it does NOT throw `AccessDeniedError`
   * and does NOT generate signed URLs. See
   * `./content-access/access-decision.ts` for the full contract.
   */
  async hasContentAccess(userId: string, contentId: string): Promise<boolean> {
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
   * @param userId - Authenticated user ID
   * @param input - Content ID and optional expiry
   * @returns Streaming URL and expiration timestamp
   * @throws {ContentNotFoundError} Content doesn't exist, is draft, or is deleted
   * @throws {AccessDeniedError} User hasn't purchased content and isn't org member
   * @throws {R2SigningError} Failed to generate signed URL
   */
  async getStreamingUrl(
    userId: string,
    input: GetStreamingUrlInput
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
      // `savePlaybackProgress` (see Phase 4.1 of
      // docs/subscription-cache-audit/phase-2-followup.md).
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
        });

        // Personal content (no organizationId) can't be revoked at the org
        // scope — fall through to the transaction below. The content row
        // may also be missing entirely (not found / deleted); let the
        // transaction surface `ContentNotFoundError` with consistent
        // context rather than duplicating the 404 path here.
        const orgId = contentRow?.organizationId ?? null;
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
      const target = await this.db.transaction(
        async (tx) => {
          // Get content with media details (any organization)
          const contentRecord = await tx.query.content.findFirst({
            where: and(
              eq(content.id, input.contentId),
              eq(content.status, CONTENT_STATUS.PUBLISHED),
              isNull(content.deletedAt)
            ),
            with: {
              mediaItem: true, // Includes r2_key, content_type, duration
            },
          });

          if (!contentRecord) {
            this.obs.warn('Content not found or not accessible', {
              contentId: input.contentId,
              userId,
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
          // (written article → null-URL, else validated HLS descriptor).
          return resolveStreamableMedia(
            this.obs,
            input.contentId,
            contentRecord
          );
        },
        {
          isolationLevel: 'read committed', // Consistent snapshot for access verification
          accessMode: 'read only', // All operations are reads
        }
      );

      // Step 3: Build the streaming response (written null-URL, or mint the
      // HLS token + master-playlist proxy URL and presign the waveform).
      return await buildStreamingResponse(
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
    } catch (error) {
      this.handleError(error, 'getStreamingUrl');
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
   */
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
   */
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
    return buildUserLibrary({ db: this.db, obs: this.obs }, userId, input);
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
  });

  // Return service with cleanup function
  return { service, cleanup };
}
