// See https://svelte.dev/docs/kit/types#app.d.ts
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
        ASSETS?: any;
      };
      context: {
        waitUntil(promise: Promise<any>): void;
      };
      caches: CacheStorage & { default: Cache };
    }
  }
}

export {};
