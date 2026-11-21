/**
 * The workers the e2e suite calls, each on its `SERVICE_PORTS` port from
 * `@codex/constants`, never a port written out (Codex-1yd58 WP-11;
 * `scripts/check-e2e-ports.mjs` fails on one anywhere under `e2e/`). The web
 * app's own origin is `./origin.ts`.
 *
 * A call keeps the host it has always used:
 *  - `lvh.me` for a call that SETS cookies: the Set-Cookie carries
 *    `Domain=.lvh.me`, which Chromium drops from a localhost response
 *    (`e2e/CLAUDE.md`, "Cookie domain gotcha");
 *  - `localhost` for a health check, or a call that sets no cookie;
 *  - `127.0.0.1` where Node resolves localhost to IPv6 first and wrangler is
 *    not listening there (`content-cache.spec.ts`).
 */
import { SERVICE_PORTS } from '@codex/constants';

export { SERVICE_PORTS };

/** A worker, by its `SERVICE_PORTS` name. */
export type Worker = keyof typeof SERVICE_PORTS;

/** The host a worker call uses (see above). */
export type WorkerHost = 'lvh.me' | 'localhost' | '127.0.0.1';

/** `http://<host>:<port>` for `worker`. */
export function workerUrl(
  worker: Worker,
  host: WorkerHost = 'localhost'
): string {
  return `http://${host}:${SERVICE_PORTS[worker]}`;
}
