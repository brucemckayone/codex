import 'cloudflare:test';

declare module 'cloudflare:test' {
  interface ProvidedEnv {
    RUNPOD_WEBHOOK_SECRET?: string;
    RUNPOD_API_KEY?: string;
    RUNPOD_ENDPOINT_ID?: string;
    WORKER_SHARED_SECRET?: string;
  }
}
