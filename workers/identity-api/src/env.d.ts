import 'cloudflare:test';

declare module 'cloudflare:test' {
  interface ProvidedEnv {
    WORKER_SHARED_SECRET?: string;
    DB_METHOD?: string;
  }
}
