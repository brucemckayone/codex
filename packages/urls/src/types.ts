/**
 * Canonical env name. Distinguishes:
 *  - `production`  — prod (revelations.studio wildcard zone route)
 *  - `staging`     — staging (revelations.studio with `-staging` suffix)
 *  - `dev`         — deployed long-lived dev (dev.revelations.studio with per-org
 *                    Cloudflare Custom Domains; see DevDomainService)
 *  - `development` — local development (lvh.me / nip.io / localhost)
 *  - `test`        — automated tests (lvh.me with non-secure cookies)
 *
 * Note: `dev` and `development` are intentionally different — the deployed
 * `dev` runs over HTTPS with secure cookies at dev.revelations.studio.
 */
export type EnvName = 'production' | 'staging' | 'dev' | 'development' | 'test';

/**
 * Backend service identifier. Must match `SERVICE_SUBDOMAIN` and
 * `SERVICE_PORT_MAP` in `env-hosts.ts`. Mirrors `@codex/constants` `ServiceName`
 * for compatibility but lives here as the routing-layer canonical type.
 */
export type ServiceName =
  | 'auth'
  | 'content'
  | 'access'
  | 'org'
  | 'ecom'
  | 'admin'
  | 'identity'
  | 'notifications'
  | 'media';

/**
 * Structured result of `parseHost(host)`. Returns everything callers need to
 * route, build URLs, or set cookies — without re-deriving any TLD-branch logic.
 */
export interface HostInfo {
  /**
   * Detected env from TLD. `null` when no match (custom domains, IPs, etc.) —
   * workers should pass env explicitly in that case.
   */
  env: EnvName | null;
  /**
   * What goes AFTER an org slug. Used for URL construction and cookie domain.
   * Examples: `lvh.me`, `dev.revelations.studio`, `revelations.studio`,
   * `192.168.1.10.nip.io`, `localhost`.
   */
  baseDomain: string;
  /**
   * First label before `baseDomain`, or `null` on apex. For deployed dev,
   * this is the org slug. For staging, this is the LITERAL prefix including
   * any `-staging` suffix (e.g. `codex-staging`) — backward-compat with
   * existing `extractSubdomain` behavior.
   */
  subdomain: string | null;
  /** Port suffix or `null`. */
  port: string | null;
  /**
   * For nip.io LAN testing — the extracted `192.168.1.10.nip.io` portion.
   * `null` when not a nip.io host. Used by cookie domain logic to set
   * `Domain=.{ip}.nip.io` for cross-subdomain mobile testing.
   */
  nipApex: string | null;
}
