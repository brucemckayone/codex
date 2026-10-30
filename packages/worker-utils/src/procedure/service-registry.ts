/**
 * Service Registry - Lazy-loaded service factory
 *
 * Creates services on-demand via JavaScript getters.
 * Services are instantiated only when accessed, avoiding unnecessary
 * creation of unused services and enabling proper cleanup.
 */

import {
  AccessRevocation,
  ContentAccessService,
  CourseAccessService,
  CourseInsightsService,
  CourseJourneyService,
  EntitlementsService,
  PlanAccessService,
} from '@codex/access';
import {
  AdminAnalyticsService,
  AdminContentManagementService,
  AdminCustomerManagementService,
  SupportService,
} from '@codex/admin';
import { AgreementService } from '@codex/agreements';
import {
  logCacheStats,
  VersionedCache,
  type VersionedCacheConfig,
} from '@codex/cache';
import {
  CdnCachePurger,
  R2Service,
  type R2SigningConfig,
} from '@codex/cloudflare-clients';
import type { CachePresetName } from '@codex/constants';
// Service imports
import {
  CategoriesService,
  ContentService,
  MediaItemService,
} from '@codex/content';
import {
  createDbClient,
  createHyperdriveDbClient,
  createPerRequestDbClient,
} from '@codex/database';
import { IdentityService } from '@codex/identity';
import {
  ImageProcessingService,
  OrphanedFileService,
} from '@codex/image-processing';
import {
  createEmailProvider,
  NotificationPreferencesService,
  NotificationsService,
  TemplateService,
} from '@codex/notifications';
import { ObservabilityClient } from '@codex/observability';
import { DevDomainService, OrganizationService } from '@codex/organization';
import {
  BrandingSettingsService,
  ContactSettingsService,
  PlatformSettingsFacade,
} from '@codex/platform-settings';
import {
  createStripeClient,
  FeeConfigService,
  PurchaseService,
} from '@codex/purchase';
import { StripeNotConfiguredError } from '@codex/service-errors';
import type { Bindings } from '@codex/shared-types';
import {
  ConnectAccountService,
  CourseSubscriptionService,
  PRICE_NOTICE_TIMEOUT_MS,
  SubscriptionService,
  TierService,
} from '@codex/subscription';
import {
  type AlertLedger,
  type MediaStatusFeed,
  type MediaStatusPublisher,
  TranscodingAlerts,
  TranscodingMaintenance,
  TranscodingService,
} from '@codex/transcoding';
import { buildServiceUrl } from '@codex/urls';
import {
  type SendEmailToWorkerParams,
  sendEmailToWorker,
  sendEmailToWorkerAwaited,
} from '../email/send-email';
import {
  DurableObjectMediaStatusFeed,
  WorkerMediaStatusPublisher,
} from '../media-status';
import { followUpMemberDeparture } from './member-departure';
import type { ServiceRegistry } from './types';
import type { BackgroundTracker } from './upload-shared';

/**
 * Service registry creation result
 */
export interface ServiceRegistryResult {
  /** Lazy-loaded service registry */
  registry: ServiceRegistry;
  /** Cleanup function to close all database connections */
  cleanup: () => Promise<void>;
}

/** The concrete Stripe client type, derived from the factory return. */
type StripeClient = ReturnType<typeof createStripeClient>;

/**
 * Wrap a Stripe-client resolver in a Proxy that defers resolution until the
 * first property access.
 *
 * WP-12 (Codex-fc5oh.12): the Stripe-backed service getters built their
 * constructor argument by calling the resolver EAGERLY. The resolver throws
 * `StripeNotConfiguredError` when the key is falsy, so merely accessing
 * `ctx.services.connect` (or subscription/tier/purchase) threw at construction —
 * BEFORE the handler ran. That turned read-only zero-state endpoints (a brand
 * new creator's empty Connect status returns DISCONNECTED without ever calling
 * Stripe; earnings-summary and payouts are pure DB reads) into 500
 * INTERNAL_ERROR responses whenever the key was missing or late-bound.
 *
 * The returned Proxy holds the constructor arg without resolving it. `resolve()`
 * (and its missing-key throw) runs lazily on the FIRST property access — i.e.
 * the first real Stripe API call. Services store the proxy as `this.stripe` and
 * only touch it inside async methods, so read paths never trip the guard, while
 * a genuine misconfiguration still surfaces (as `StripeNotConfiguredError`,
 * code `STRIPE_NOT_CONFIGURED`) the moment a Stripe call is actually attempted.
 * Codex-1g5lh.1 is precisely that case: `createTier`'s Connect check is a pure
 * DB read, so the proxy stayed unresolved until `stripe.products.create`.
 */
export function createLazyStripeProxy(
  resolve: () => StripeClient
): StripeClient {
  return new Proxy({} as StripeClient, {
    get(_target, prop) {
      const client = resolve();
      const value = Reflect.get(client as object, prop);
      // Bind methods to the real client so `this` resolves correctly; Stripe
      // resource namespaces (accounts, checkout, …) are objects and pass
      // through untouched.
      return typeof value === 'function' ? value.bind(client) : value;
    },
  });
}

/**
 * Resolve the worker's Stripe secret, or throw the typed misconfiguration
 * error.
 *
 * Codex-1g5lh.1: this guard used to throw a plain `Error`
 * ('STRIPE_SECRET_KEY not configured…'). `mapErrorToResponse` masks any
 * non-`ServiceError` as `500 INTERNAL_ERROR / "An unexpected error occurred"`,
 * so a worker deployed without the secret answered
 * `POST /api/organizations/:id/tiers` with a bare 500 that was
 * indistinguishable from a DB fault, a Stripe outage or a real bug — there was
 * nothing on the wire to act on. `StripeNotConfiguredError` carries the stable
 * `STRIPE_NOT_CONFIGURED` code instead, so the next occurrence is triageable
 * from the response alone.
 *
 * Nothing identifying the binding is put in the error's message or context:
 * `mapErrorToResponse` forwards a `ServiceError`'s message to the client
 * verbatim, and logs a 5xx's context (Codex-adcgb). The operator detail goes
 * to observability only.
 *
 * Exported for tests — the guard is the whole defect, and the throw is
 * otherwise only reachable through a real Stripe call.
 */
export function requireStripeSecretKey(
  env: Pick<Bindings, 'STRIPE_SECRET_KEY'>,
  environment?: string,
  obs?: ObservabilityClient
): string {
  const stripeKey = env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    obs?.error('Stripe client requested but no secret is bound', {
      source: 'service-registry.getStripeClient',
      binding: 'STRIPE_SECRET_KEY',
      environment,
    });
    throw new StripeNotConfiguredError();
  }
  return stripeKey;
}

/**
 * Creates lazy-loaded service registry
 *
 * Services are instantiated on first access via getters.
 * This avoids creating unused services and enables proper cleanup.
 *
 * @param env - Cloudflare environment bindings
 * @param obs - Optional observability client for logging
 * @param organizationId - Optional organization context for org-scoped services
 * @returns Service registry with cleanup function
 *
 * @example
 * ```typescript
 * const { registry, cleanup } = createServiceRegistry(c.env, obs, orgId);
 * try {
 *   const content = await registry.content.create(input, userId);
 * } finally {
 *   c.executionCtx.waitUntil(cleanup());
 * }
 * ```
 */
/**
 * Cache presets whose responses are shared between viewers, and are therefore
 * safe to serve from Hyperdrive's query cache.
 *
 * `private` and `fresh` are excluded, and so is an ABSENT preset: a route that
 * never declared one must not be silently opted into a 75-second staleness
 * window. The dangerous reading is the default, so safety is stated as an
 * allow-list rather than a deny-list — a preset added to CACHE_PRESETS later
 * gets the uncached binding until someone deliberately lists it here.
 */
const SHARED_CACHEABLE_PRESETS: ReadonlySet<CachePresetName> = new Set([
  'public',
  'static',
  'asset',
]);

/**
 * Pick the Hyperdrive binding for a route from its cache preset (Codex-s1i7h).
 *
 * DERIVED, NOT HAND-PICKED. There are 199 `procedure()` call sites; a
 * per-route choice between two bindings would be wrong somewhere within a
 * month, and the symptom — a stale read — is intermittent and unattributable.
 *
 * Returns `undefined` when the needed binding is absent, which makes the
 * caller fall back to the Neon driver against `DATABASE_URL`. That is the
 * SAFE direction: correct-but-unpooled beats fast-but-stale. It is worth a log
 * line though, because a worker that declares `HYPERDRIVE` without
 * `HYPERDRIVE_UNCACHED` silently splits its traffic across two drivers.
 */
export function selectHyperdrive(
  env: Bindings,
  cachePreset: CachePresetName | undefined,
  obs?: ObservabilityClient
): { connectionString: string } | undefined {
  // Not bound at all: this worker has not been migrated, or the binding was
  // removed to roll back. Either way, Neon.
  if (!env.HYPERDRIVE) return undefined;

  if (cachePreset && SHARED_CACHEABLE_PRESETS.has(cachePreset)) {
    return env.HYPERDRIVE;
  }

  if (!env.HYPERDRIVE_UNCACHED) {
    obs?.warn('HYPERDRIVE declared without HYPERDRIVE_UNCACHED', {
      signal: 'hyperdrive_binding_incomplete',
      cachePreset: cachePreset ?? 'none',
      // Says what the consequence is, so this is actionable without reading
      // the source: the route still works, just not through Hyperdrive.
      effect: 'route falls back to the Neon driver via DATABASE_URL',
    });
    return undefined;
  }

  return env.HYPERDRIVE_UNCACHED;
}

/**
 * What a caller outside `procedure()` may substitute in the registry it builds
 * (`createWebhookServices`, Codex-2hxff.54). `procedure()` passes none.
 */
export interface ServiceRegistryOverrides {
  /**
   * The Stripe client every Stripe-backed service shares. A webhook passes the
   * client it verified the event with, and its tests pass their mock.
   */
  stripe?: StripeClient;
  /**
   * Stay on the Neon driver even where Hyperdrive is bound. Webhooks and crons
   * ran on Neon before they shared this registry, and only production binds
   * Hyperdrive, so CI cannot exercise a webhook on it. Moving them is its own
   * change, verified on its own.
   */
  skipHyperdrive?: boolean;
  /**
   * Where media lifecycle changes go (Codex-l2c48.9). MediaStatusObject's
   * alarm passes a feed into itself, so a retry it runs reports straight
   * back to it rather than through a stub to itself.
   */
  mediaStatus?: MediaStatusFeed;
}

/**
 * Setup-fault alerts go once per fault per UTC day (Codex-l2c48.6): a KV key
 * that outlives its day. Not atomic, so two first reports racing may both
 * mail, which beats losing one.
 */
function kvAlertLedger(kv: NonNullable<Bindings['CACHE_KV']>): AlertLedger {
  return {
    async claim(key) {
      if ((await kv.get(key)) !== null) return false;
      await kv.put(key, '1', { expirationTtl: 36 * 60 * 60 });
      return true;
    },
  };
}

export async function createServiceRegistry(
  env: Bindings,
  _obs?: ObservabilityClient,
  organizationId?: string,
  executionCtx?: ExecutionContext,
  cachePreset?: CachePresetName,
  background?: BackgroundTracker['background'],
  overrides?: ServiceRegistryOverrides
): Promise<ServiceRegistryResult> {
  // Track cleanup functions for per-request DB clients
  const cleanupFns: Array<() => Promise<void>> = [];

  // Shared per-request DB client (for services needing transactions).
  // Declared HERE, before the eager Hyperdrive resolution below, because the
  // resolution writes into `_hyperdriveDb`.
  let _sharedDbClient: ReturnType<typeof createPerRequestDbClient> | undefined;
  let _hyperdriveDb:
    | Awaited<ReturnType<typeof createHyperdriveDbClient>>
    | undefined;

  // Hyperdrive (Codex-s1i7h). Resolved HERE, before the registry is returned,
  // because the service getters are synchronous: by the time any of them runs,
  // the client must already exist. createHyperdriveDbClient dynamically
  // imports node-postgres, so this await is also what keeps `pg` out of every
  // environment without a Hyperdrive binding — including `env.test`, where a
  // static import failed PR #487's first CI run at worker boot.
  //
  // A Pool constructs without dialing; the connection opens on first query,
  // so resolving eagerly costs nothing on requests that never transact. When
  // no binding serves this route this block is skipped entirely and the Neon
  // path below stays lazy — which is also the rollback lever: delete the
  // binding from a wrangler config and the worker reverts to Neon with no
  // code change.
  const hyperdriveOverride = overrides?.skipHyperdrive
    ? undefined
    : selectHyperdrive(env, cachePreset, _obs)?.connectionString;
  if (hyperdriveOverride) {
    _hyperdriveDb = await createHyperdriveDbClient(hyperdriveOverride);
    cleanupFns.push(_hyperdriveDb.cleanup);
  }

  /**
   * `waitUntil` handed to every `VersionedCache` built here (Codex-e32xz).
   *
   * `VersionedCache.get`/`getWithResult` write their data slot without awaiting
   * it. In workerd an un-awaited promise is cancelled as soon as the response
   * returns, so before this was wired the data slot NEVER landed — production
   * KV held 62 version keys and 0 data keys, a literal 0% hit rate. Registering
   * the put on the execution context keeps the response fast (nothing is
   * awaited inline) while guaranteeing the write completes.
   *
   * Wrapped in a closure, not `.bind()` — same effect, and it keeps the
   * "never pass `executionCtx.waitUntil` unbound" rule visible at the call
   * site. `undefined` when there is no ExecutionContext (unit tests), in which
   * case VersionedCache falls back to its old best-effort behaviour.
   *
   * NOT `tracker.background` from `procedure()`: that hook exists so DB work
   * finishes before the pool is torn down, and chaining a KV put onto it would
   * hold the Postgres connection open for the duration of a KV write for no
   * reason. A KV put touches no pool, so plain `waitUntil` is correct here.
   */
  const cacheWaitUntil = executionCtx
    ? (promise: Promise<unknown>) => executionCtx.waitUntil(promise)
    : undefined;

  /**
   * The deferral hook for background work that TOUCHES THE DATABASE — emails
   * that look up their recipients, price fan-outs (Codex-2hxff.2 review).
   *
   * `procedure()` tears this registry's pool down once the work it was TOLD
   * about settles, and plain `executionCtx.waitUntil` tells it nothing: cleanup
   * wins the race and every later query fails. So DB work goes through
   * `procedure()`'s tracker (`background`), and only falls back to plain
   * `waitUntil` for a caller that has no tracker. A rejection is logged here
   * rather than dropped: these tasks run after the response, so nothing else
   * would ever see it. KV-only work keeps `cacheWaitUntil` (above).
   */
  const dbWaitUntil: ((promise: Promise<unknown>) => void) | undefined =
    background || executionCtx
      ? (promise) => {
          const logged = promise.catch((error: unknown) => {
            _obs?.error('Background task failed after the response', {
              error: error instanceof Error ? error.message : String(error),
            });
          });
          if (background) void background(logged);
          else executionCtx?.waitUntil(logged);
        }
      : undefined;

  /**
   * Every cache this registry builds, so `cleanup()` can emit their stats.
   *
   * The registry is the right owner of that emit for the same reason it is the
   * right owner of `cacheWaitUntil`: it is the ONE place a worker's caches are
   * constructed, so a single change covers all six services instead of six
   * call-site edits that the next service would forget to copy.
   */
  const trackedCaches: VersionedCache[] = [];

  /**
   * Build a request-scoped cache and register it for the stats emit.
   *
   * All six services took a byte-identical construction before this existed;
   * routing them through one factory is what makes "the registry emits cache
   * stats" a property of the registry rather than a habit six getters share.
   *
   * `kv` is a PARAMETER rather than read off `env` in here: every call site
   * sits behind an `env.CACHE_KV` truthiness check, and that narrowing does not
   * cross a function boundary — reading it inside the factory reintroduces the
   * `KVNamespace | undefined` the call sites already ruled out.
   */
  function buildTrackedCache(kv: VersionedCacheConfig['kv']): VersionedCache {
    const cache = new VersionedCache({
      kv,
      prefix: 'cache',
      waitUntil: cacheWaitUntil,
      // A failed KV write or invalidation is otherwise silent, and a stale
      // entry outlives it by up to its TTL (Codex-2hxff.57).
      obs: _obs,
    });
    trackedCaches.push(cache);
    return cache;
  }

  // Service instances (created on demand)
  let _content: ContentService | undefined;
  let _categories: CategoriesService | undefined;
  let _media: MediaItemService | undefined;
  let _access: ContentAccessService | undefined;
  let _entitlements: EntitlementsService | undefined;
  let _imageProcessing: ImageProcessingService | undefined;
  let _organization: OrganizationService | undefined;
  let _devDomain: DevDomainService | undefined;
  let _settings: PlatformSettingsFacade | undefined;
  let _purchase: PurchaseService | undefined;
  let _feeConfig: FeeConfigService | undefined;
  let _transcoding: TranscodingService | undefined;
  let _transcodingMaintenance: TranscodingMaintenance | undefined;
  let _adminAnalytics: AdminAnalyticsService | undefined;
  let _adminContent: AdminContentManagementService | undefined;
  let _adminCustomer: AdminCustomerManagementService | undefined;
  let _support: SupportService | undefined;
  let _templates: TemplateService | undefined;
  let _notifications: NotificationsService | undefined;
  let _preferences: NotificationPreferencesService | undefined;
  let _identity: IdentityService | undefined;
  let _subscription: SubscriptionService | undefined;
  let _tier: TierService | undefined;
  let _connectAccount: ConnectAccountService | undefined;
  let _courseSubscription: CourseSubscriptionService | undefined;
  let _courseAccess: CourseAccessService | undefined;
  let _planAccess: PlanAccessService | undefined;
  let _courseJourney: CourseJourneyService | undefined;
  let _courseInsights: CourseInsightsService | undefined;
  let _agreements: AgreementService | undefined;

  // Shared per-request DB client (for services needing transactions).
  // TWO SHAPES, ONE FUNCTION: when a Hyperdrive binding serves this route the
  // client is created (async) at registry creation into `_hyperdriveDb`, and
  // getSharedDb just returns it. Otherwise the Neon client stays LAZY and
  // SYNC as it has always been — constructed on first use, so requests that
  // never touch a transactional service never pay for a Pool. (Both holders
  // are declared above, next to the eager resolution that writes the first
  // one.)
  /**
   * The fire-and-forget mailer the money services require (Codex-2hxff.55):
   * `sendEmailToWorker` on the request's `waitUntil`. Every request path has
   * an ExecutionContext; a registry built without one (a unit test) logs the
   * email it could not send rather than drop it silently: through the
   * ObservabilityClient, or `console.error` when there is none. Ids only,
   * never the address (silent #10).
   */
  function sendAfterResponse(params: SendEmailToWorkerParams): void {
    if (executionCtx) {
      sendEmailToWorker(env, executionCtx, params);
      return;
    }
    const message = 'Email not sent: the registry has no ExecutionContext';
    const data = {
      errorId: crypto.randomUUID(),
      templateName: params.templateName,
      ...(params.userId ? { userId: params.userId } : {}),
    };
    if (_obs) _obs.error(message, data);
    else console.error(`[service-registry] ${message}`, data);
  }

  /**
   * Get or create shared per-request DB client
   * Reuses single WebSocket connection for all services that need transactions
   */
  function getSharedDb() {
    if (_hyperdriveDb) return _hyperdriveDb.db;
    if (!_sharedDbClient) {
      _sharedDbClient = createPerRequestDbClient(env);
      cleanupFns.push(_sharedDbClient.cleanup);
    }
    return _sharedDbClient.db;
  }

  // Not a `ctx.services` entry: shared by the two transcoding getters.
  let _transcodingAlerts: TranscodingAlerts | undefined;
  /**
   * Transcoding's failure and setup-fault emails (Codex-l2c48.6), one shared
   * by the transcoding and transcodingMaintenance getters. None without an
   * execution context to send from. The lookups run after the response on
   * dbWaitUntil, which a webhook's pool waits for before closing.
   */
  function getTranscodingAlerts(): TranscodingAlerts | undefined {
    const ctx = executionCtx;
    if (!ctx || !dbWaitUntil) return undefined;
    if (!_transcodingAlerts) {
      _transcodingAlerts = new TranscodingAlerts({
        db: getSharedDb(),
        environment: getEnvironment(),
        mailer: (params) => {
          sendEmailToWorker(env, ctx, params);
        },
        webAppUrl: env.WEB_APP_URL,
        waitUntil: dbWaitUntil,
        ledger: env.CACHE_KV ? kvAlertLedger(env.CACHE_KV) : undefined,
      });
    }
    return _transcodingAlerts;
  }

  // Not a `ctx.services` entry: shared by the media and transcoding getters.
  let _mediaStatusFeed: MediaStatusFeed | undefined;
  /**
   * The status object's feed (Codex-l2c48.9): media-api binds MEDIA_STATUS.
   * None without an execution context to send from. A publish touches no
   * pool, so it rides plain waitUntil (`cacheWaitUntil`), as a KV put does.
   */
  function getMediaStatusFeed(): MediaStatusFeed | undefined {
    if (overrides?.mediaStatus) return overrides.mediaStatus;
    if (!env.MEDIA_STATUS || !cacheWaitUntil) return undefined;
    _mediaStatusFeed ??= new DurableObjectMediaStatusFeed(
      env.MEDIA_STATUS,
      cacheWaitUntil,
      _obs
    );
    return _mediaStatusFeed;
  }

  /**
   * MediaItemService's publisher. A worker without the binding (content-api,
   * organization-api's intro video) publishes through media-api.
   */
  function getMediaStatusPublisher(): MediaStatusPublisher | undefined {
    const feed = getMediaStatusFeed();
    if (feed) return feed;
    if (!env.WORKER_SHARED_SECRET || !cacheWaitUntil) return undefined;
    return new WorkerMediaStatusPublisher(
      buildServiceUrl('media', env),
      env.WORKER_SHARED_SECRET,
      cacheWaitUntil,
      _obs
    );
  }

  /**
   * Get environment (defaults to 'development')
   */
  function getEnvironment() {
    return env.ENVIRONMENT || 'development';
  }

  // Orphan-record PRODUCER for the media-api OrphanedFileCleanupDO sweep
  // (Codex-r85jo.3). Every ImageProcessingService built here — directly, or
  // inside IdentityService.uploadAvatar / deleteAvatar — must receive it:
  // without it the orphan-recording branch in upload-pipeline.ts can only take
  // its warn path,
  // and the DO drains a table nothing writes. Private to the registry, not a
  // `ctx.services.*` entry: no route has a reason to call it directly.
  let _orphanedFiles: OrphanedFileService | undefined;

  function getOrphanedFileService(): OrphanedFileService {
    if (!_orphanedFiles) {
      _orphanedFiles = new OrphanedFileService({
        db: getSharedDb(),
        environment: getEnvironment(),
      });
    }
    return _orphanedFiles;
  }

  // Shared Stripe client (created once, reused by purchase/subscription/tier/connect)
  let _stripeClient: ReturnType<typeof createStripeClient> | undefined;

  function getStripeClient() {
    if (!_stripeClient) {
      _stripeClient =
        overrides?.stripe ??
        createStripeClient(requireStripeSecretKey(env, getEnvironment(), _obs));
    }
    return _stripeClient;
  }

  // WP-12 (Codex-fc5oh.12): inject a lazy Stripe proxy instead of resolving the
  // client eagerly, so read-only zero-state endpoints never trip the missing-key
  // guard. See createLazyStripeProxy() above for the full rationale. Memoised so
  // all Stripe-backed services share one proxy (and one underlying client).
  let _lazyStripeClient: StripeClient | undefined;

  function getLazyStripeClient(): StripeClient {
    if (!_lazyStripeClient) {
      _lazyStripeClient = createLazyStripeProxy(getStripeClient);
    }
    return _lazyStripeClient;
  }

  const registry: ServiceRegistry = {
    // ========================================================================
    // Content Domain
    // ========================================================================

    get content() {
      if (!_content) {
        _content = new ContentService({
          db: getSharedDb(),
          environment: getEnvironment(),
          // Codex-8so68: the allowed host for `thumbnailUrl`. Not thrown on
          // when absent (unlike imageProcessing below, which cannot function
          // without it) — the service fails the thumbnail check CLOSED, so a
          // missing binding costs the ability to set a thumbnail, never an
          // open hotlink.
          r2PublicUrlBase: env.R2_PUBLIC_URL_BASE,
        });

        if (env.CACHE_KV) {
          _content.setCache(buildTrackedCache(env.CACHE_KV));
        }
      }
      return _content;
    },

    get categories() {
      if (!_categories) {
        _categories = new CategoriesService({
          db: getSharedDb(),
          environment: getEnvironment(),
        });
      }
      return _categories;
    },

    get media() {
      if (!_media) {
        // Build R2Service for media uploads.
        // Signing config generates presigned URLs for direct browser→R2 uploads.
        // In development, skip signing so the client uses the proxy upload
        // route (POST /api/media/:id/upload) through the worker instead —
        // real R2 endpoints reject dev origins with CORS errors.
        let mediaR2: R2Service | undefined;
        if (env.MEDIA_BUCKET) {
          const isDev = getEnvironment() === 'development';
          let signingConfig: R2SigningConfig | undefined;

          if (!isDev) {
            const accountId =
              typeof env.R2_ACCOUNT_ID === 'string'
                ? env.R2_ACCOUNT_ID
                : undefined;
            const accessKeyId =
              typeof env.R2_ACCESS_KEY_ID === 'string'
                ? env.R2_ACCESS_KEY_ID
                : undefined;
            const secretAccessKey =
              typeof env.R2_SECRET_ACCESS_KEY === 'string'
                ? env.R2_SECRET_ACCESS_KEY
                : undefined;
            const bucketName =
              typeof env.R2_BUCKET_MEDIA === 'string'
                ? env.R2_BUCKET_MEDIA
                : undefined;

            signingConfig =
              accountId && accessKeyId && secretAccessKey && bucketName
                ? { accountId, accessKeyId, secretAccessKey, bucketName }
                : undefined;

            if (!signingConfig) {
              _obs?.warn(
                'R2 signing config unavailable — presigned upload URLs will not be generated',
                {
                  hasAccountId: !!accountId,
                  hasAccessKeyId: !!accessKeyId,
                  hasSecretKey: !!secretAccessKey,
                  hasBucketName: !!bucketName,
                }
              );
            }
          }

          mediaR2 = new R2Service(env.MEDIA_BUCKET, {}, signingConfig);
        }

        _media = new MediaItemService({
          db: getSharedDb(),
          environment: getEnvironment(),
          r2: mediaR2,
          mediaStatus: getMediaStatusPublisher(),
        });
      }
      return _media;
    },

    get access() {
      if (!_access) {
        // Build R2Signer: dev uses unsigned CDN URLs, prod uses R2 presigned URLs
        let r2Signer: {
          generateSignedUrl(
            r2Key: string,
            expirySeconds: number
          ): Promise<string>;
          getObjectText(r2Key: string): Promise<string | null>;
        };
        const isDev = getEnvironment() === 'development';

        if (isDev && env.R2_PUBLIC_URL_BASE) {
          // Development: unsigned dev-cdn URLs (Miniflare R2 serves without signatures)
          const baseUrl = env.R2_PUBLIC_URL_BASE;
          r2Signer = {
            async generateSignedUrl(r2Key: string, _expirySeconds: number) {
              return `${baseUrl}/${r2Key}`;
            },
            // HLS playlist proxy reads `.m3u8` bytes via dev-cdn (Miniflare R2).
            async getObjectText(r2Key: string) {
              const response = await fetch(`${baseUrl}/${r2Key}`);
              if (!response.ok) return null;
              return response.text();
            },
          };
        } else if (env.MEDIA_BUCKET) {
          // Production: presigned R2 URLs via R2Service
          const accountId =
            typeof env.R2_ACCOUNT_ID === 'string'
              ? env.R2_ACCOUNT_ID
              : undefined;
          const accessKeyId =
            typeof env.R2_ACCESS_KEY_ID === 'string'
              ? env.R2_ACCESS_KEY_ID
              : undefined;
          const secretAccessKey =
            typeof env.R2_SECRET_ACCESS_KEY === 'string'
              ? env.R2_SECRET_ACCESS_KEY
              : undefined;
          const bucketName =
            typeof env.R2_BUCKET_MEDIA === 'string'
              ? env.R2_BUCKET_MEDIA
              : undefined;

          const signingConfig =
            accountId && accessKeyId && secretAccessKey && bucketName
              ? { accountId, accessKeyId, secretAccessKey, bucketName }
              : undefined;

          r2Signer = new R2Service(env.MEDIA_BUCKET, {}, signingConfig);
        } else {
          throw new Error(
            'R2 signing configuration unavailable. ' +
              'Ensure MEDIA_BUCKET binding is set, or R2_PUBLIC_URL_BASE for development.'
          );
        }

        // Wire AccessRevocation when CACHE_KV is bound so the progress
        // save path (and, in a follow-up, streaming URL minting) can
        // short-circuit on webhook-written revocation keys before hitting
        // the DB. When KV is absent, the service still enforces the
        // DB-level access check — revocation is defense-in-depth, not
        // the primary gate.
        const revocation = env.CACHE_KV
          ? new AccessRevocation(env.CACHE_KV)
          : undefined;

        _access = new ContentAccessService({
          db: getSharedDb(),
          environment: getEnvironment(),
          r2: r2Signer,
          purchaseService: registry.purchase,
          revocation,
          // HLS playlist-proxy wiring (WP-14): getStreamingUrl returns a
          // master-proxy URL on the content-api origin, and the proxy routes
          // verify the short-lived token signed with WORKER_SHARED_SECRET.
          contentApiBaseUrl: buildServiceUrl('content', env),
          hlsTokenSecret: env.WORKER_SHARED_SECRET,
          // Library tiles resolve a video poster's R2 key to a URL with it
          // (Codex-kk9nv.6).
          r2PublicUrlBase: env.R2_PUBLIC_URL_BASE,
        });
      }
      return _access;
    },

    get entitlements() {
      if (!_entitlements) {
        // READ resolution of stored `entitlements` grants (Codex-2pryk.2.3).
        // Read-only — the write path (grant-on-purchase / course-sub) is WP-6.
        _entitlements = new EntitlementsService({
          db: getSharedDb(),
          environment: getEnvironment(),
        });
      }
      return _entitlements;
    },

    get imageProcessing() {
      if (!_imageProcessing) {
        // Use ASSETS_BUCKET for public images (thumbnails, avatars, logos)
        // Falls back to MEDIA_BUCKET for backwards compatibility during migration
        const assetsBucket = env.ASSETS_BUCKET || env.MEDIA_BUCKET;

        if (!assetsBucket) {
          throw new Error(
            'ASSETS_BUCKET not configured. Required for image processing (thumbnails, avatars, logos).'
          );
        }

        if (!env.R2_PUBLIC_URL_BASE) {
          throw new Error(
            'R2_PUBLIC_URL_BASE not configured. Required for image processing (public image URLs).'
          );
        }

        const r2Service = new R2Service(assetsBucket);

        _imageProcessing = new ImageProcessingService({
          db: getSharedDb(),
          environment: getEnvironment(),
          r2Service,
          r2PublicUrlBase: env.R2_PUBLIC_URL_BASE,
          orphanedFileService: getOrphanedFileService(),
        });
      }
      return _imageProcessing;
    },

    // ========================================================================
    // Organization Domain
    // ========================================================================

    get organization() {
      if (!_organization) {
        _organization = new OrganizationService({
          db: getSharedDb(),
          environment: getEnvironment(),
          // Codex-8so68: the allowed host for `logoUrl`. Fails closed when
          // the binding is absent (see the content getter above).
          r2PublicUrlBase: env.R2_PUBLIC_URL_BASE,
          // Codex-2hxff.2: ownership-transfer emails, fire-and-forget off the
          // request path (the agreements wiring below, minus its boot-time
          // WEB_APP_URL requirement — this getter serves workers that never
          // send these emails, so a missing URL only skips the email).
          ownershipMailer: executionCtx
            ? (params) => {
                sendEmailToWorker(env, executionCtx, params);
              }
            : undefined,
          // Codex-2hxff.18 / .64: what a removal ended goes to the follow-up
          // (course subscriptions cancelled at period end, caches cleared, one
          // email to the creator). `async`, so even a throw while building a
          // service becomes a rejection the caller logs.
          onMemberRemoved: async (departure) => {
            await followUpMemberDeparture(
              {
                // Reads and KV only, so the stateless HTTP client, as
                // content-api's cache bump uses.
                db: createDbClient(env),
                cache: env.CACHE_KV
                  ? buildTrackedCache(env.CACHE_KV)
                  : undefined,
                waitUntil: (promise) => dbWaitUntil?.(promise),
                cancelCourseSubscriptions: (params) =>
                  registry.courseSubscription.cancelForCoursesOffSale(params),
                sendEmail: executionCtx
                  ? (params) => {
                      sendEmailToWorker(env, executionCtx, params);
                    }
                  : undefined,
                obs:
                  _obs ??
                  new ObservabilityClient('member-departure', getEnvironment()),
              },
              departure
            );
          },
          webAppUrl: env.WEB_APP_URL,
          // The email task looks its recipients up in the DB first.
          waitUntil: dbWaitUntil,
        });
      }
      return _organization;
    },

    /**
     * Dev-only Cloudflare Custom Domain provisioner. No-op outside
     * `ENVIRONMENT === 'dev'`. Reads CLOUDFLARE_API_TOKEN and
     * CLOUDFLARE_ACCOUNT_ID from worker env bindings; missing creds
     * turn the service off silently rather than failing org-create.
     */
    get devDomain() {
      if (!_devDomain) {
        _devDomain = new DevDomainService({
          db: getSharedDb(),
          environment: getEnvironment(),
          cloudflareApiToken:
            typeof env.CLOUDFLARE_API_TOKEN === 'string'
              ? env.CLOUDFLARE_API_TOKEN
              : undefined,
          cloudflareAccountId:
            typeof env.CLOUDFLARE_ACCOUNT_ID === 'string'
              ? env.CLOUDFLARE_ACCOUNT_ID
              : undefined,
          // zoneName removed in WP-6 — DevDomainService now derives the
          // hostname from ENV_HOSTS.dev.orgHost and the Cloudflare zone
          // name internally (always `revelations.studio`).
          webWorkerName: 'codex-web-dev',
        });
      }
      return _devDomain;
    },

    get settings() {
      if (!_settings) {
        if (!organizationId) {
          throw new Error(
            'organizationId required for settings service. ' +
              'Use policy.requireOrgMembership or extract from request params.'
          );
        }

        // Use ASSETS_BUCKET for public assets (logos, branding)
        // Falls back to MEDIA_BUCKET for backwards compatibility
        const assetsBucket = env.ASSETS_BUCKET || env.MEDIA_BUCKET;
        const r2 = assetsBucket ? new R2Service(assetsBucket) : undefined;

        _settings = new PlatformSettingsFacade({
          db: getSharedDb(),
          environment: getEnvironment(),
          organizationId,
          r2,
          // Pass R2 public URL base from env (BrandingSettingsService handles undefined gracefully)
          r2PublicUrlBase: env.R2_PUBLIC_URL_BASE,
          // A logo key whose R2 delete fails is recorded for the sweep, which
          // deletes from ASSETS_BUCKET, the bucket `r2` above is built over.
          orphanRecorder: getOrphanedFileService(),
        });
      }
      return _settings;
    },

    // ========================================================================
    // Commerce Domain
    // ========================================================================

    /**
     * Fee configuration service (Codex-m644n) — 3-tier DB-configurable fee
     * model with version-cache invalidation and audit logging. Consumed by
     * `purchase` (one-off path) and `subscription` (subscription path).
     */
    get feeConfig() {
      if (!_feeConfig) {
        const cache = env.CACHE_KV
          ? buildTrackedCache(env.CACHE_KV)
          : undefined;
        const waitUntil = executionCtx
          ? executionCtx.waitUntil.bind(executionCtx)
          : undefined;

        _feeConfig = new FeeConfigService({
          db: getSharedDb(),
          environment: getEnvironment(),
          cache,
          waitUntil,
        });
      }
      return _feeConfig;
    },

    get purchase() {
      if (!_purchase) {
        _purchase = new PurchaseService(
          {
            db: getSharedDb(),
            environment: getEnvironment(),
            // Codex-m644n: inject FeeConfigService so completePurchase walks
            // the 3-tier fallback chain instead of hardcoding DEFAULT_* consts.
            feeConfig: registry.feeConfig,
            // WP-10 (Codex-69t7c.10): a parked creator_payout sends
            // creator-connect-needed, fire-and-forget.
            mailer: sendAfterResponse,
            portalConfigurationId: env.STRIPE_PORTAL_CONFIGURATION_ID,
          },
          getLazyStripeClient()
        );
      }
      return _purchase;
    },

    /**
     * Codex-tnft0 (WP-2 of Codex-nk4km): revenue-share AgreementService.
     * Uses the shared per-request WebSocket client so accept/terminate
     * transactions reuse the existing connection. Per the PR #210
     * review, share-validation is platform-fee-independent (it reasons
     * purely about the post-platform pool — see `agreement-math.ts`),
     * so no `feeConfig` dep is threaded through here. WP-4 reads the
     * platform fee fresh in the payout pipeline.
     *
     * WP-5 (Codex-90de9): wire a mailer thunk so every lifecycle
     * mutation can fire a notification fire-and-forget AFTER the
     * transaction commits. Same pattern as the SubscriptionService
     * `mailer` slot — the service stays unaware of `Bindings` /
     * `ExecutionContext`; `sendEmailToWorker` under the hood schedules
     * the worker-to-worker fetch on `executionCtx.waitUntil`. When
     * `executionCtx` is absent (shouldn't happen inside `procedure()`
     * but be defensive), the mailer slot stays undefined and the
     * service silently skips emails — agreement mutations still
     * succeed.
     */
    get agreements() {
      if (!_agreements) {
        const mailer = executionCtx
          ? (params: {
              to: string;
              toName?: string;
              templateName:
                | 'agreement-proposed-by-owner'
                | 'agreement-countered-by-creator'
                | 'agreement-countered-by-owner'
                | 'agreement-accepted'
                | 'agreement-declined'
                | 'agreement-terminated'
                | 'agreement-expiring-soon';
              category: 'transactional';
              userId?: string;
              organizationId?: string | null;
              data: Record<string, string | number | boolean>;
            }) => {
              sendEmailToWorker(env, executionCtx, params);
            }
          : undefined;

        // The email links come from the env name, not `WEB_APP_URL`: the
        // apex host it names has no Studio, so every link built on it was
        // dead (Codex-2hxff.20 AGR-10). The service throws at construction
        // on an env name it cannot route.
        //
        // Codex-0omga (WP-5 polish): thread `executionCtx.waitUntil`
        // through so the lifecycle notification dispatch (3 DB lookups
        // + mailer fire) is offloaded from the API request critical
        // path. The lookups touch the DB, so the task goes on `dbWaitUntil`
        // (the pool stays open until it settles), not plain `waitUntil`.
        // When neither hook exists (shouldn't happen inside `procedure()`
        // but defensive) the service falls back to inline dispatch —
        // mutation still succeeds, response is just slightly slower.
        _agreements = new AgreementService({
          db: getSharedDb(),
          environment: getEnvironment(),
          mailer,
          waitUntil: dbWaitUntil,
        });
      }
      return _agreements;
    },

    // ========================================================================
    // Subscription Domain
    // ========================================================================

    get subscription() {
      if (!_subscription) {
        // Wire the cache + waitUntil orchestrator hook when both are
        // available so every public mutation on SubscriptionService
        // bumps the per-user library + per-org subscription KV version
        // keys fire-and-forget. When CACHE_KV is absent (local tests,
        // misconfigured env) or there's no executionCtx (shouldn't
        // happen inside `procedure()` but be defensive), the service
        // silently degrades to no-op — the mutation still succeeds.
        //
        // Mirror of the AccessRevocation wiring on `access` above —
        // same gating shape, same graceful-degrade semantics.
        const cache = env.CACHE_KV
          ? buildTrackedCache(env.CACHE_KV)
          : undefined;
        const waitUntil = executionCtx
          ? executionCtx.waitUntil.bind(executionCtx)
          : undefined;

        // The price-change notice is AWAITED: a subscriber's price moves
        // only once notifications-api accepts their notice (owner decision
        // D-P3, Codex-2hxff.43). The fan-out already runs after the
        // response (`dbWaitUntil`), so the send needs no ExecutionContext of
        // its own.
        const mailer = (params: {
          to: string;
          toName?: string;
          templateName: 'subscription-tier-price-change';
          category: 'transactional';
          userId?: string;
          organizationId?: string | null;
          data: Record<string, string | number | boolean>;
        }) =>
          sendEmailToWorkerAwaited(env, params, {
            timeoutMs: PRICE_NOTICE_TIMEOUT_MS,
          });

        // Web-app base URL powers the manage-subscription link inside
        // the price-change notice. `WEB_APP_URL` is the canonical
        // binding (same one webhook handlers accept as a method arg).
        // When missing, the email template falls back to a relative
        // path — still valid HTML, operator can fix the absolute URL
        // without needing to re-send.
        const webAppUrl = env.WEB_APP_URL;

        _subscription = new SubscriptionService(
          {
            db: getSharedDb(),
            environment: getEnvironment(),
            cache,
            waitUntil,
            mailer,
            // WP-10 (Codex-69t7c.10): the drains (resolvePendingPayouts, and
            // the payee-wide resolvePendingPayoutsForAccount, Codex-2hxff.13)
            // send one payout-released notification after pending→paid,
            // fire-and-forget.
            payoutMailer: sendAfterResponse,
            webAppUrl,
            // Codex-m644n: inject FeeConfigService so invoice + tier-change
            // flows resolve fees via the 3-tier fallback chain. Per-creator
            // fan-out additionally walks creator-override → org-default →
            // platform → constants, so two creators in the same invoice can
            // receive different splits.
            feeConfig: registry.feeConfig,
          },
          getLazyStripeClient()
        );
      }
      return _subscription;
    },

    get tier() {
      if (!_tier) {
        // Q1.2 (Codex-3xyyb): wire a propagator thunk so tier
        // create/update flows that change the canonical Stripe Price
        // automatically fan the new Price id out to every active /
        // cancelling subscription on the tier. The propagator runs on
        // `executionCtx.waitUntil` so the slow path (one Stripe call
        // per subscriber, batched) never blocks the request response.
        // When `executionCtx` is absent (shouldn't happen inside
        // `procedure()`, but be defensive), we still run propagation
        // awaited — the tier route handler will simply wait a bit
        // longer. The inner `propagateTierPriceToActiveSubscriptions`
        // method owns its own try/catch per sub; any rejection we
        // surface here is a catastrophic (pre-batch) failure worth
        // logging via the fire-and-forget tail.
        const propagator = (args: {
          tierId: string;
          newStripePriceId: string;
          organizationId: string;
          interval: 'month' | 'year';
        }): void => {
          const run = async () => {
            // Use the lazy getter so the SubscriptionService is only
            // instantiated if propagation actually fires — tier reads
            // and tier creates-without-price-change never pay the
            // construction cost.
            await registry.subscription.propagateTierPriceToActiveSubscriptions(
              args.tierId,
              args.newStripePriceId,
              // Only the changed interval's subscribers move (Codex-2hxff.3).
              { organizationId: args.organizationId, interval: args.interval }
            );
          };
          // The fan-out reads subscribers from the DB: `dbWaitUntil` keeps
          // the pool open until it settles and logs a rejection that
          // happens before the per-subscriber loop's own logging starts.
          if (dbWaitUntil) {
            dbWaitUntil(run());
          } else {
            // No hook available — best-effort fire-and-forget via
            // unawaited promise, still logged.
            run().catch((error: unknown) => {
              _obs?.error('Tier price propagation failed', {
                tierId: args.tierId,
                error: error instanceof Error ? error.message : String(error),
              });
            });
          }
        };

        _tier = new TierService(
          {
            db: getSharedDb(),
            // X7 (Codex-z9fzv): same per-request WebSocket client used
            // for transactions; `getSharedDb()` already returns a
            // DatabaseWs (it caches the createPerRequestDbClient
            // result), so passing it as both `db` and `dbWs` reuses
            // the connection.
            dbWs: getSharedDb(),
            environment: getEnvironment(),
            propagator,
          },
          getLazyStripeClient()
        );
      }
      return _tier;
    },

    get connect() {
      if (!_connectAccount) {
        _connectAccount = new ConnectAccountService(
          {
            db: getSharedDb(),
            environment: getEnvironment(),
          },
          getLazyStripeClient()
        );

        // Wire VersionedCache for `getStatus(orgId)` cache-aside. Mirrors the
        // ContentService cache-wiring pattern: construct first, then inject
        // the cache only when CACHE_KV is bound (skipped in unit tests).
        if (env.CACHE_KV) {
          _connectAccount.setCache(buildTrackedCache(env.CACHE_KV));
        }
      }
      return _connectAccount;
    },

    get courseSubscription() {
      if (!_courseSubscription) {
        // Course-sub payouts resolve fees via the same 3-tier fallback chain as
        // purchases/subscriptions; Stripe client is deferred (read-only course
        // pages never construct it) — same pattern as `subscription`/`tier`.
        // A plan price change runs its fan-out after the response
        // (Codex-2hxff.3). The fan-out reads subscribers per interval, so it
        // goes on `dbWaitUntil`, and awaits each notice before that
        // subscriber moves (D-P3, Codex-2hxff.43). The off-sale email stays
        // fire-and-forget: the cancel never waits on it.
        _courseSubscription = new CourseSubscriptionService(
          {
            db: getSharedDb(),
            environment: getEnvironment(),
            feeConfig: registry.feeConfig,
            mailer: (params) =>
              sendEmailToWorkerAwaited(env, params, {
                timeoutMs: PRICE_NOTICE_TIMEOUT_MS,
              }),
            offSaleMailer: sendAfterResponse,
            webAppUrl: env.WEB_APP_URL,
            waitUntil: dbWaitUntil,
          },
          getLazyStripeClient()
        );
      }
      return _courseSubscription;
    },

    get courseAccess() {
      if (!_courseAccess) {
        // Pure DB (no Stripe). Uses the shared WS client because `setTierAccess`
        // replaces a course's tier-access rows inside a transaction.
        _courseAccess = new CourseAccessService({
          db: getSharedDb(),
          environment: getEnvironment(),
        });
      }
      return _courseAccess;
    },

    get planAccess() {
      if (!_planAccess) {
        // Pure DB. The shared WS client: the checklist's delta write is one
        // transaction. Cache + waitUntil wire the post-write catalogue and
        // subscriber-library bumps; without either they degrade to no-ops.
        _planAccess = new PlanAccessService({
          db: getSharedDb(),
          environment: getEnvironment(),
          cache: env.CACHE_KV ? buildTrackedCache(env.CACHE_KV) : undefined,
          waitUntil: executionCtx
            ? executionCtx.waitUntil.bind(executionCtx)
            : undefined,
        });
      }
      return _planAccess;
    },

    get courseJourney() {
      if (!_courseJourney) {
        // Pure DB member-surface reads (Round-D): dashboard curriculum + progress
        // rollup, in-course practice/playlist, idempotent completion write.
        // Shares the WS client like the sibling course services.
        _courseJourney = new CourseJourneyService({
          db: getSharedDb(),
          environment: getEnvironment(),
          // Page images removed from a saved page are queued for the sweep.
          orphanedFileService: getOrphanedFileService(),
        });
      }
      return _courseJourney;
    },

    get courseInsights() {
      if (!_courseInsights) {
        // Pure DB studio reporting reads (Round-D · WP-7): course-scoped financial
        // + engagement aggregation for the owner/admin insights surface. Shares
        // the WS client like the sibling course services.
        _courseInsights = new CourseInsightsService({
          db: getSharedDb(),
          environment: getEnvironment(),
        });
      }
      return _courseInsights;
    },

    // ========================================================================
    // Media Domain
    // ========================================================================

    get transcoding() {
      if (!_transcoding) {
        const runpodApiKey = env.RUNPOD_API_KEY;
        const runpodEndpointId = env.RUNPOD_ENDPOINT_ID;

        if (!runpodApiKey || !runpodEndpointId) {
          throw new Error(
            'Incomplete transcoding configuration. ' +
              'Ensure RUNPOD_API_KEY and RUNPOD_ENDPOINT_ID secrets are set in the worker environment.'
          );
        }

        // API_URL is required in production for webhook callbacks
        const webhookBaseUrl = env.API_URL;
        if (!webhookBaseUrl && getEnvironment() !== 'development') {
          throw new Error(
            'API_URL not configured. Required for transcoding webhook callbacks.'
          );
        }

        // NOTE: B2 and R2 credentials are configured in RunPod's secret manager,
        // not passed via service config (security: avoids credential sprawl)
        //
        // TRANSCODING_WEBHOOK_URL overrides the webhook callback URL.
        // In local dev, the transcoder runs in Docker and can't reach localhost —
        // set this to http://host.docker.internal:4002 in .dev.vars.
        const transcodingWebhookUrl =
          env.TRANSCODING_WEBHOOK_URL ||
          webhookBaseUrl ||
          'http://localhost:4002';

        _transcoding = new TranscodingService({
          db: getSharedDb(),
          environment: getEnvironment(),
          runpodApiKey,
          runpodEndpointId,
          webhookBaseUrl: transcodingWebhookUrl,
          runpodApiBaseUrl: env.RUNPOD_API_URL,
          runpodDirectUrl: env.RUNPOD_DIRECT_URL,
          // Unset means the default; a bad value is the service's to
          // report (it logs at error and uses the default).
          runpodWorkersMax: env.RUNPOD_WORKERS_MAX
            ? Number(env.RUNPOD_WORKERS_MAX)
            : undefined,
          alerts: getTranscodingAlerts(),
          mediaStatus: getMediaStatusFeed(),
        });
      }
      return _transcoding;
    },

    get transcodingMaintenance() {
      if (!_transcodingMaintenance) {
        // Originals live in MEDIA_BUCKET. A HEAD needs no signing config.
        const originals = env.MEDIA_BUCKET
          ? new R2Service(env.MEDIA_BUCKET)
          : undefined;
        _transcodingMaintenance = new TranscodingMaintenance({
          db: getSharedDb(),
          environment: getEnvironment(),
          transcoding: this.transcoding,
          originalExists: originals
            ? async (key) => (await originals.head(key)) !== null
            : undefined,
          alerts: getTranscodingAlerts(),
          mediaStatus: getMediaStatusFeed(),
        });
      }
      return _transcodingMaintenance;
    },

    get images() {
      // Delegate to imageProcessing getter which has correct initialization
      return this.imageProcessing;
    },

    // ========================================================================
    // Admin Domain
    // ========================================================================

    get adminAnalytics() {
      if (!_adminAnalytics) {
        // Admin analytics uses HTTP client (read-only aggregations)
        _adminAnalytics = new AdminAnalyticsService({
          db: createDbClient(env),
          environment: getEnvironment(),
        });
      }
      return _adminAnalytics;
    },

    get adminContent() {
      if (!_adminContent) {
        _adminContent = new AdminContentManagementService({
          db: getSharedDb(),
          environment: getEnvironment(),
        });

        if (env.CACHE_KV) {
          _adminContent.setCache(buildTrackedCache(env.CACHE_KV));
        }
      }
      return _adminContent;
    },

    get adminCustomer() {
      if (!_adminCustomer) {
        _adminCustomer = new AdminCustomerManagementService({
          db: getSharedDb(),
          environment: getEnvironment(),
        });
      }
      return _adminCustomer;
    },

    /**
     * Codex-2hxff.28: platform support's refunds. The shared per-request
     * client, because settling a failed refund is one transaction; the lazy
     * Stripe proxy, so the queue's DB-only reads never need the key. The
     * purchase service gives a re-paid failed refund's access back (Q5d).
     */
    get support() {
      if (!_support) {
        _support = new SupportService({
          db: getSharedDb(),
          environment: getEnvironment(),
          stripe: getLazyStripeClient(),
          purchase: registry.purchase,
        });
      }
      return _support;
    },

    // ========================================================================
    // Notification Domain
    // ========================================================================

    get templates() {
      if (!_templates) {
        _templates = new TemplateService({
          db: getSharedDb(),
          environment: getEnvironment(),
        });
      }
      return _templates;
    },

    get notifications() {
      if (!_notifications) {
        const useMock = env.USE_MOCK_EMAIL === 'true';

        // Validate email provider credentials at startup
        if (!useMock && !env.RESEND_API_KEY) {
          throw new Error(
            'RESEND_API_KEY is required when USE_MOCK_EMAIL is not enabled. ' +
              'Set USE_MOCK_EMAIL=true for local development or provide RESEND_API_KEY.'
          );
        }

        const emailProvider = createEmailProvider({
          useMock,
          resendApiKey: env.RESEND_API_KEY,
          mailhogUrl: env.MAILHOG_URL,
        });

        _notifications = new NotificationsService({
          db: getSharedDb(),
          emailProvider,
          fromEmail: env.FROM_EMAIL || 'noreply@example.com',
          fromName: env.FROM_NAME || 'Codex',
          environment: getEnvironment(),
          // Inject brand token resolver so NotificationsService doesn't
          // create ad-hoc BrandingSettingsService/ContactSettingsService
          brandTokenResolver: async (orgId) => {
            const brandingSvc = new BrandingSettingsService({
              db: getSharedDb(),
              environment: getEnvironment(),
              organizationId: orgId,
            });
            const contactSvc = new ContactSettingsService({
              db: getSharedDb(),
              environment: getEnvironment(),
              organizationId: orgId,
            });
            const [branding, contact] = await Promise.all([
              brandingSvc.get(),
              contactSvc.get(),
            ]);
            return {
              primaryColor: branding.primaryColorHex ?? '#000000',
              logoUrl: branding.logoUrl ?? '',
              supportEmail: contact.supportEmail ?? '',
            };
          },
        });
      }
      return _notifications;
    },

    get preferences() {
      if (!_preferences) {
        _preferences = new NotificationPreferencesService({
          db: getSharedDb(),
          environment: getEnvironment(),
        });
      }
      return _preferences;
    },

    // ========================================================================
    // Identity Domain
    // ========================================================================

    get identity() {
      if (!_identity) {
        // Use ASSETS_BUCKET for public assets (avatars)
        // Falls back to MEDIA_BUCKET for backwards compatibility
        const assetsBucket = env.ASSETS_BUCKET || env.MEDIA_BUCKET;

        if (!assetsBucket) {
          throw new Error(
            'ASSETS_BUCKET not configured. Required for identity service (avatar uploads).'
          );
        }

        if (!env.R2_PUBLIC_URL_BASE) {
          throw new Error(
            'R2_PUBLIC_URL_BASE not configured. Required for identity service (public image URLs).'
          );
        }

        const r2Service = new R2Service(assetsBucket);

        // Create versioned cache if CACHE_KV is available
        const cache = env.CACHE_KV
          ? buildTrackedCache(env.CACHE_KV)
          : undefined;

        _identity = new IdentityService({
          db: getSharedDb(),
          environment: getEnvironment(),
          r2Service,
          r2PublicUrlBase: env.R2_PUBLIC_URL_BASE,
          cache,
          orphanedFileService: getOrphanedFileService(),
          // The CDN purge runs after the response (a fetch, no DB pool).
          waitUntil: cacheWaitUntil,
          // A deleted account's avatars leave the CDN edge (Codex-kk9nv.15).
          cdnPurger:
            env.CF_ZONE_ID && env.CF_API_TOKEN
              ? new CdnCachePurger({
                  zoneId: env.CF_ZONE_ID,
                  apiToken: env.CF_API_TOKEN,
                })
              : undefined,
        });
      }
      return _identity;
    },
  };

  /**
   * Cleanup all database connections, and emit each cache's hit/miss stats.
   *
   * Callers already run this on `waitUntil` after the response is returned
   * (see the example above), which is exactly the cadence the stats emit wants:
   * end of request, off the response path, costing the client nothing.
   *
   * The emit is wrapped so a logger fault can never fail a cleanup — the DB
   * teardown is the load-bearing half of this function and telemetry must not
   * be able to strand a connection. `logCacheStats` also returns early for a
   * cache that was never touched, so a request that read nothing logs nothing.
   */
  async function cleanup(): Promise<void> {
    if (_obs) {
      for (const cache of trackedCaches) {
        try {
          logCacheStats(cache, _obs, organizationId ? { organizationId } : {});
        } catch {
          // Telemetry is never worth a stranded DB connection.
        }
      }
    }

    await Promise.all(cleanupFns.map((fn) => fn()));
  }

  return { registry, cleanup };
}
