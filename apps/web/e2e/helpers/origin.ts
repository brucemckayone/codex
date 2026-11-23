/**
 * Where the e2e suite finds the web app: the ONE place its origin is set
 * (Codex-1yd58 WP-11).
 *
 * `PLAYWRIGHT_BASE_URL` overrides the default. CI sets it, and so does a
 * local run against a dev server that is already up (another worktree's, on
 * another port). Specs and helpers used to repeat the default port in URLs,
 * Origin headers and host fallbacks, so a run against any other port broke
 * them one by one. Build every URL from these exports instead;
 * `scripts/check-e2e-ports.mjs` (a CI static-analysis step) fails on the
 * default port written anywhere else under `e2e/`.
 *
 * `playwright.config.ts` imports `E2E_BASE_URL` too, for each project's
 * `baseURL` and for the dev server it starts when none is running.
 *
 * Read from the PROCESS environment when this module loads, so set
 * `PLAYWRIGHT_BASE_URL` in the shell or the CI job, not in `.env.test`: the
 * config's imports run before its `dotenv.config()` call.
 */

const DEFAULT_BASE_URL = 'http://lvh.me:5173';

/** The platform's base URL, without a trailing slash. */
export const E2E_BASE_URL = (
  process.env.PLAYWRIGHT_BASE_URL || DEFAULT_BASE_URL
).replace(/\/+$/, '');

const base = new URL(E2E_BASE_URL);

/** The platform origin (scheme, host and port), e.g. for an Origin header. */
export const E2E_ORIGIN = base.origin;

/** The host with its port: an org lives on `<slug>.${E2E_HOST}`. */
export const E2E_HOST = base.host;

/** The bare host name, without the port (the dev server's `--host`). */
export const E2E_HOSTNAME = base.hostname;

/** The port, as a string: the scheme's default when the URL names none. */
export const E2E_PORT =
  base.port || (base.protocol === 'https:' ? '443' : '80');

/** An org's origin: its subdomain of the base URL, with no path. */
export function orgOrigin(org: string, baseUrl: string = E2E_BASE_URL): string {
  const from = new URL(baseUrl);
  return `${from.protocol}//${org}.${from.host}`;
}

/**
 * Build an absolute URL on an org's subdomain from a base URL (a spec's
 * `baseURL` fixture, or `E2E_BASE_URL`).
 *
 * The org slug lives in the HOSTNAME, never the path, so a journey page cannot
 * be reached with a root-relative `page.goto()` unless the browser is already
 * on that subdomain. Reading the port from the base URL keeps every spec
 * portable between the default and a `PLAYWRIGHT_BASE_URL` override.
 */
export function orgUrl(baseUrl: string, org: string, path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${orgOrigin(org, baseUrl)}${suffix}`;
}
