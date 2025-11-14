/**
 * Auth Worker - Environment Type Declarations
 *
 * Extends the shared cloudflare:test environment with auth-specific bindings.
 */

declare module 'cloudflare:test' {
  interface ProvidedEnv {
    // Auth-specific environment variables
    BETTER_AUTH_SECRET: string;
    WEB_APP_URL: string;
    API_URL: string;

    // Auth-specific KV namespaces
    AUTH_SESSION_KV: KVNamespace;
  }
}

export {};
