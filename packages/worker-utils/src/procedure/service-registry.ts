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
  EntitlementsService,
} from '@codex/access';
import {
  AdminAnalyticsService,
  AdminContentManagementService,
  AdminCustomerManagementService,
} from '@codex/admin';
import { AgreementService } from '@codex/agreements';
import { VersionedCache } from '@codex/cache';
import { R2Service, type R2SigningConfig } from '@codex/cloudflare-clients';
// Service imports
import {
  CategoriesService,
  ContentService,
  MediaItemService,
} from '@codex/content';
import { createDbClient, createPerRequestDbClient } from '@codex/database';
import { IdentityService } from '@codex/identity';
import { ImageProcessingService } from '@codex/image-processing';
import {
  createEmailProvider,
  NotificationPreferencesService,
  NotificationsService,
  TemplateService,
} from '@codex/notifications';
import type { ObservabilityClient } from '@codex/observability';
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
import type { Bindings } from '@codex/shared-types';
import {
  ConnectAccountService,
  CourseSubscriptionService,
  SubscriptionService,
  TierService,
} from '@codex/subscription';
import { TranscodingService } from '@codex/transcoding';
import { buildServiceUrl } from '@codex/urls';
import { sendEmailToWorker } from '../email/send-email';
import type { ServiceRegistry } from './types';

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
 * 'STRIPE_SECRET_KEY not configured' when the key is falsy, so merely accessing
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
 * a genuine misconfiguration still surfaces (as the same thrown error) the
 * moment a Stripe call is actually attempted.
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
export function createServiceRegistry(
  env: Bindings,
  _obs?: ObservabilityClient,
  organizationId?: string,
  executionCtx?: ExecutionContext
): ServiceRegistryResult {
  // Track cleanup functions for per-request DB clients
  const cleanupFns: Array<() => Promise<void>> = [];

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
  let _adminAnalytics: AdminAnalyticsService | undefined;
  let _adminContent: AdminContentManagementService | undefined;
  let _adminCustomer: AdminCustomerManagementService | undefined;
  let _templates: TemplateService | undefined;
  let _notifications: NotificationsService | undefined;
  let _preferences: NotificationPreferencesService | undefined;
  let _identity: IdentityService | undefined;
  let _subscription: SubscriptionService | undefined;
  let _tier: TierService | undefined;
  let _connectAccount: ConnectAccountService | undefined;
  let _courseSubscription: CourseSubscriptionService | undefined;
  let _courseAccess: CourseAccessService | undefined;
  let _agreements: AgreementService | undefined;

  // Shared per-request DB client (for services needing transactions)
  let _sharedDbClient: ReturnType<typeof createPerRequestDbClient> | undefined;

  /**
   * Get or create shared per-request DB client
   * Reuses single WebSocket connection for all services that need transactions
   */
  function getSharedDb() {
    if (!_sharedDbClient) {
      _sharedDbClient = createPerRequestDbClient(env);
      cleanupFns.push(_sharedDbClient.cleanup);
    }
    return _sharedDbClient.db;
  }

  /**
   * Get environment (defaults to 'development')
   */
  function getEnvironment() {
    return env.ENVIRONMENT || 'development';
  }

  // Shared Stripe client (created once, reused by purchase/subscription/tier/connect)
  let _stripeClient: ReturnType<typeof createStripeClient> | undefined;

  function getStripeClient() {
    if (!_stripeClient) {
      const stripeKey = env.STRIPE_SECRET_KEY;
      if (!stripeKey) {
        throw new Error(
          'STRIPE_SECRET_KEY not configured. ' +
            'Add secret to worker environment for Stripe operations.'
        );
      }
      _stripeClient = createStripeClient(stripeKey);
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
        });

        if (env.CACHE_KV) {
          _content.setCache(
            new VersionedCache({ kv: env.CACHE_KV, prefix: 'cache' })
          );
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
          ? new VersionedCache({ kv: env.CACHE_KV, prefix: 'cache' })
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
        // WP-10 (Codex-69t7c.10): wire creator-connect-needed mailer so a
        // parked creator_payout fires a notification fire-and-forget.
        // Same pattern as the subscription mailer above.
        const purchaseMailer = executionCtx
          ? (params: {
              to: string;
              toName?: string;
              templateName: 'creator-connect-needed';
              category: 'transactional';
              userId?: string;
              organizationId?: string | null;
              data: Record<string, string | number | boolean>;
            }) => {
              sendEmailToWorker(env, executionCtx, params);
            }
          : undefined;

        _purchase = new PurchaseService(
          {
            db: getSharedDb(),
            environment: getEnvironment(),
            // Codex-m644n: inject FeeConfigService so completePurchase walks
            // the 3-tier fallback chain instead of hardcoding DEFAULT_* consts.
            feeConfig: registry.feeConfig,
            mailer: purchaseMailer,
            webAppUrl: env.WEB_APP_URL,
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

        // Web-app base URL powers the deep link embedded inside every
        // agreement-lifecycle email. Codex-0omga (WP-5 polish): the
        // value is now MANDATORY at AgreementService construction; the
        // service itself throws if unset. We surface a more specific
        // error here so a misconfigured worker fails at boot rather
        // than at the first agreement mutation.
        const webAppUrl = env.WEB_APP_URL;
        if (!webAppUrl) {
          throw new Error(
            'AgreementService requires `env.WEB_APP_URL` to be set ' +
              'for notification deep-links. Check wrangler.jsonc.'
          );
        }

        // Codex-0omga (WP-5 polish): thread `executionCtx.waitUntil`
        // through so the lifecycle notification dispatch (3 DB lookups
        // + mailer fire) is offloaded from the API request critical
        // path. Mirrors the `subscription` waitUntil wiring above.
        // When `executionCtx` is absent (shouldn't happen inside
        // `procedure()` but defensive) the service falls back to
        // inline dispatch — mutation still succeeds, response is just
        // slightly slower.
        const waitUntil = executionCtx
          ? executionCtx.waitUntil.bind(executionCtx)
          : undefined;

        _agreements = new AgreementService({
          db: getSharedDb(),
          environment: getEnvironment(),
          mailer,
          webAppUrl,
          waitUntil,
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
          ? new VersionedCache({ kv: env.CACHE_KV, prefix: 'cache' })
          : undefined;
        const waitUntil = executionCtx
          ? executionCtx.waitUntil.bind(executionCtx)
          : undefined;

        // Q1.3 (Codex-7kc83): wire a mailer thunk so the price-change
        // propagation path can notify affected subscribers fire-and-
        // forget. The service stays unaware of Bindings /
        // ExecutionContext — it just calls `mailer(params)` and
        // `sendEmailToWorker` under the hood schedules the worker-to-
        // worker fetch on `executionCtx.waitUntil`. When
        // `executionCtx` is absent (shouldn't happen inside
        // `procedure()` but be defensive) we skip the mailer rather
        // than block — propagation still succeeds; the email side-
        // effect is skipped with a `this.obs.warn` from
        // SubscriptionService's dispatch guard.
        const mailer = executionCtx
          ? (params: {
              to: string;
              toName?: string;
              templateName: 'subscription-tier-price-change';
              category: 'transactional';
              userId?: string;
              organizationId?: string | null;
              data: Record<string, string | number | boolean>;
            }) => {
              sendEmailToWorker(env, executionCtx, params);
            }
          : undefined;

        // Web-app base URL powers the manage-subscription link inside
        // the price-change notice. `WEB_APP_URL` is the canonical
        // binding (same one webhook handlers accept as a method arg).
        // When missing, the email template falls back to a relative
        // path — still valid HTML, operator can fix the absolute URL
        // without needing to re-send.
        const webAppUrl = env.WEB_APP_URL;

        // WP-10 (Codex-69t7c.10): wire payout-released mailer so
        // resolvePendingPayouts fires a notification after pending→paid.
        // Same pattern as `mailer` above — service stays unaware of
        // Bindings / ExecutionContext.
        const payoutMailer = executionCtx
          ? (params: {
              to: string;
              toName?: string;
              templateName: 'payout-released';
              category: 'transactional';
              userId?: string;
              organizationId?: string | null;
              data: Record<string, string | number | boolean>;
            }) => {
              sendEmailToWorker(env, executionCtx, params);
            }
          : undefined;

        _subscription = new SubscriptionService(
          {
            db: getSharedDb(),
            environment: getEnvironment(),
            cache,
            waitUntil,
            mailer,
            payoutMailer,
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
              { organizationId: args.organizationId }
            );
          };
          if (executionCtx) {
            executionCtx.waitUntil(run());
          } else {
            // No waitUntil available — best-effort fire-and-forget via
            // unawaited promise. `.catch` guard prevents unhandled
            // rejection noise; the inner method already logs failures.
            run().catch(() => {});
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
          _connectAccount.setCache(
            new VersionedCache({ kv: env.CACHE_KV, prefix: 'cache' })
          );
        }
      }
      return _connectAccount;
    },

    get courseSubscription() {
      if (!_courseSubscription) {
        // Course-sub payouts resolve fees via the same 3-tier fallback chain as
        // purchases/subscriptions; Stripe client is deferred (read-only course
        // pages never construct it) — same pattern as `subscription`/`tier`.
        _courseSubscription = new CourseSubscriptionService(
          {
            db: getSharedDb(),
            environment: getEnvironment(),
            feeConfig: registry.feeConfig,
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
        });
      }
      return _transcoding;
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
          _adminContent.setCache(
            new VersionedCache({ kv: env.CACHE_KV, prefix: 'cache' })
          );
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
          ? new VersionedCache({
              kv: env.CACHE_KV,
              prefix: 'cache',
            })
          : undefined;

        _identity = new IdentityService({
          db: getSharedDb(),
          environment: getEnvironment(),
          r2Service,
          r2PublicUrlBase: env.R2_PUBLIC_URL_BASE,
          cache,
        });
      }
      return _identity;
    },
  };

  /**
   * Cleanup all database connections
   * Called after request processing completes
   */
  async function cleanup(): Promise<void> {
    await Promise.all(cleanupFns.map((fn) => fn()));
  }

  return { registry, cleanup };
}
