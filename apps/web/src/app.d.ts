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
      };
      context: ExecutionContext;
      caches: CacheStorage;
    }

    interface Error {
      message: string;
      code?: string;
    }

    interface PageData {
      user: UserData | null;
    }
  }
}

export {};
