// See https://svelte.dev/docs/kit/types#app.d.ts
/// <reference types="@cloudflare/workers-types" />

declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    interface Platform {
      env: {
        ENVIRONMENT?: string;
        DATABASE_URL?: string;
        SESSION_SECRET?: string;
        AUTH_WORKER_URL?: string;
        API_URL?: string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ASSETS?: any;
      };
      context: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        waitUntil(promise: Promise<any>): void;
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      caches: any;
    }
  }
}

export {};
