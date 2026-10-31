// See https://svelte.dev/docs/kit/types#app.d.ts
/// <reference types="@cloudflare/workers-types" />

import type { SessionData, UserData } from '$lib/types';

declare global {
  namespace App {
    interface Locals {
      /** Authenticated user data (null if not authenticated) */
      user: UserData | null;
      /** Session data (null if no valid session) */
      session: SessionData | null;
      /** User ID shortcut (null if not authenticated) */
      userId: string | null;
      /** Unique request ID for tracing */
      requestId: string;
    }

    interface Platform {
      env: {
        ENVIRONMENT?: string;
        DATABASE_URL?: string;
        SESSION_SECRET?: string;
        AUTH_WORKER_URL?: string;
        API_URL?: string;
        ORG_API_URL?: string;
        ECOM_API_URL?: string;
        ADMIN_API_URL?: string;
        CONTENT_API_URL?: string;
        IDENTITY_API_URL?: string;
        MEDIA_API_URL?: string;
        NOTIFICATIONS_API_URL?: string;
        /** Cloudflare Analytics Engine dataset for metrics */
        ANALYTICS?: AnalyticsEngineDataset;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ASSETS?: any;
        /** Versioned cache KV namespace */
        CACHE_KV?: KVNamespace;
        /**
         * Public R2 buckets served by the CDN asset hook (WP-2). The production
         * `*.revelations.studio/*` route shadows the cdn-assets / cdn-platform
         * R2 custom domains, so the worker serves these public buckets itself.
         * Only bound in environments where the shadowing wildcard exists.
         */
        ASSETS_BUCKET?: R2Bucket;
        PLATFORM_BUCKET?: R2Bucket;
      };
      context: ExecutionContext;
      caches: CacheStorage;
    }

    interface Error {
      message: string;
      code?: string;
      /**
       * An ISO-8601 instant after which a refused write can succeed. Set by
       * `updateCourseMonetisation` for a course plan Stripe refuses until the
       * hour turns (Codex-2hxff.66); the browser shows it in local time.
       */
      retryAfter?: string;
      /**
       * Why a write was refused, from the worker's `details.reason` (a
       * ServiceError context field, client-facing by design). Set by
       * `forwardClientErrors`; the agreement dialogs read it
       * (`RecipientCannotHoldAgreementError`, Codex-2hxff.76/.77).
       */
      reason?: string;
      /**
       * The course page slots whose media was deleted, from a publish refused
       * with `details.code: 'MEDIA_DELETED'` (Codex-6sbn1). Set by
       * `saveJourneyPage`; the page builder names them and opens Settings.
       */
      slots?: string[];
    }

    interface PageData {
      user: UserData | null;
    }
  }
}

export {};
