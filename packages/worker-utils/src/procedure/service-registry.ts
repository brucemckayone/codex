/**
 * Service Registry - Lazy-loaded service factory
 *
 * Creates services on-demand via JavaScript getters.
 * Services are instantiated only when accessed, avoiding unnecessary
 * creation of unused services and enabling proper cleanup.
 */

import {
  type ContentAccessService,
  createContentAccessService,
} from '@codex/access';
import {
  AdminAnalyticsService,
  AdminContentManagementService,
  AdminCustomerManagementService,
} from '@codex/admin';
import { R2Service } from '@codex/cloudflare-clients';

// Service imports
import { ContentService, MediaItemService } from '@codex/content';
import { createDbClient, createPerRequestDbClient } from '@codex/database';
import { IdentityService } from '@codex/identity';
import { ImageProcessingService } from '@codex/image-processing';
import {
  createEmailProvider,
  NotificationsService,
  TemplateService,
} from '@codex/notifications';
import type { ObservabilityClient } from '@codex/observability';
import { OrganizationService } from '@codex/organization';
import { PlatformSettingsFacade } from '@codex/platform-settings';
import { createStripeClient, PurchaseService } from '@codex/purchase';
import type { Bindings } from '@codex/shared-types';
import { TranscodingService } from '@codex/transcoding';
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
  organizationId?: string
): ServiceRegistryResult {
  // Track cleanup functions for per-request DB clients
  const cleanupFns: Array<() => Promise<void>> = [];

  // Service instances (created on demand)
  let _content: ContentService | undefined;
  let _media: MediaItemService | undefined;
  let _access: ContentAccessService | undefined;
  let _imageProcessing: ImageProcessingService | undefined;
  let _organization: OrganizationService | undefined;
  let _settings: PlatformSettingsFacade | undefined;
  let _purchase: PurchaseService | undefined;
  let _transcoding: TranscodingService | undefined;
  let _adminAnalytics: AdminAnalyticsService | undefined;
  let _adminContent: AdminContentManagementService | undefined;
  let _adminCustomer: AdminCustomerManagementService | undefined;
  let _templates: TemplateService | undefined;
  let _notifications: NotificationsService | undefined;
  let _images: ImageProcessingService | undefined;
  let _identity: IdentityService | undefined;

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
      }
      return _content;
    },

    get media() {
      if (!_media) {
        _media = new MediaItemService({
          db: getSharedDb(),
          environment: getEnvironment(),
        });
      }
      return _media;
    },

    get access() {
      if (!_access) {
        // createContentAccessService creates its own per-request DB client
        const result = createContentAccessService(env);
        _access = result.service;
        cleanupFns.push(result.cleanup);
      }
      return _access;
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

    get purchase() {
      if (!_purchase) {
        const stripeKey = env.STRIPE_SECRET_KEY;
        if (!stripeKey) {
          throw new Error(
            'STRIPE_SECRET_KEY not configured. ' +
              'Add secret to worker environment for purchase operations.'
          );
        }
        const stripe = createStripeClient(stripeKey);
        _purchase = new PurchaseService(
          {
            db: getSharedDb(),
            environment: getEnvironment(),
          },
          stripe
        );
      }
      return _purchase;
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
        _transcoding = new TranscodingService({
          db: getSharedDb(),
          environment: getEnvironment(),
          runpodApiKey,
          runpodEndpointId,
          webhookBaseUrl: webhookBaseUrl || 'http://localhost:4002',
          runpodApiBaseUrl: env.RUNPOD_API_URL,
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
        });
      }
      return _notifications;
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

        _identity = new IdentityService({
          db: getSharedDb(),
          environment: getEnvironment(),
          r2Service,
          r2PublicUrlBase: env.R2_PUBLIC_URL_BASE,
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
