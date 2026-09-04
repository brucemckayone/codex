/**
 * Standalone RunPod stub for the e2e API suite
 *
 * WHY THIS IS NOT A WORKER ROUTE.
 * media-api already carries `POST /internal/mock-runpod` (see
 * workers/media-api/src/index.ts). Pointing `RUNPOD_DIRECT_URL` at it makes
 * media-api fetch its OWN dev server: TranscodingService.triggerJob() issues
 * a request to localhost:4002 while media-api is the thing serving 4002.
 * wrangler answers a request that lands during an isolate reload with
 * HTTP 503 "Your worker restarted mid-request. Please try sending the request
 * again." TranscodingService logs that as `RunPod API error`, so the failure
 * reads as a third-party outage and is invisible as a harness problem.
 *
 * That is what failed `should allow retrying failed transcoding` in CI run
 * 33667762392 (2026-09-02) — 500 on the first attempt, then 422 on both
 * vitest retries because the atomic claim had already moved the row out of
 * `failed`. One flake in one test skipped the Production Deployment for
 * 438c1e2a, because deploy-production.yml gates on
 * `workflow_run.conclusion == 'success'`.
 *
 * A separate process cannot be reloaded by wrangler, so the dispatch target
 * is stable for the whole run.
 *
 * Deliberately dependency-free (`node:http` only): an e2e helper that pulls a
 * package at run time races the job's fixed timeout the first time the cache
 * is cold.
 */

import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { SERVICE_PORTS } from '@codex/constants';

/**
 * Bind to 127.0.0.1 rather than a hostname. workerd CAN reach loopback
 * (measured 2026-08-21), but `localhost` may resolve to ::1 first on some
 * runners while a Node server listening on 0.0.0.0 does not accept IPv6.
 */
const HOST = '127.0.0.1';

/** The value `RUNPOD_DIRECT_URL` must carry. Used verbatim by
 *  TranscodingService — no `/<endpointId>/run` is appended, which is why the
 *  variable is DIRECT and not `RUNPOD_API_URL`. */
export const MOCK_RUNPOD_URL = `http://${HOST}:${SERVICE_PORTS.MOCK_RUNPOD}/run`;

let server: Server | null = null;

/** Requests the stub accepted, so a test can assert a dispatch happened. */
export const mockRunPodStats = { dispatches: 0 };

/**
 * Start the stub. Resolves once it is accepting connections.
 *
 * If the port is already serving, the existing listener is reused rather than
 * treated as an error — the same affordance `worker-manager` gives workers, so
 * a local re-run after an interrupted suite does not need a manual kill.
 */
export async function startMockRunPod(): Promise<void> {
  if (server) return;

  server = createServer((req, res) => {
    // RunPod's /run only accepts POST; mirroring that keeps a wrong-method
    // bug in our own dispatch code visible instead of silently passing.
    if (req.method !== 'POST') {
      res.writeHead(405, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'method not allowed' }));
      return;
    }

    // PATH-STRICT ON PURPOSE. Answering any path would make a wrongly-set
    // RUNPOD_API_URL work: TranscodingService appends `/<endpointId>/run` to
    // a BASE url, so the dispatch would arrive at `/run/<id>/run` and a
    // permissive stub would happily accept it. The misconfiguration would
    // then be invisible here and only bite in an environment that talks to
    // the real RunPod. 404 makes it fail in CI instead.
    const path = (req.url ?? '').split('?')[0];
    if (path !== '/run') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          error: `mock-runpod serves POST /run only, got ${path}. If this looks like /run/<endpointId>/run, something set RUNPOD_API_URL (a BASE url) where RUNPOD_DIRECT_URL (used verbatim) belongs.`,
        })
      );
      return;
    }

    // Drain the body. Not inspected — the payload is asserted by
    // packages/transcoding's unit tests against a fetch mock, which can see
    // the request object itself. Left undrained, Node keeps the socket open
    // and the worker's AbortSignal.timeout(30_000) eventually fires.
    req.resume();
    req.on('end', () => {
      mockRunPodStats.dispatches++;
      // Shape mirrors RunPod's real /run response. IN_QUEUE (not COMPLETED)
      // because the e2e suite forges the completion webhook itself; a stub
      // that reported COMPLETED would let a broken webhook path pass.
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({ id: `mock-job-${randomUUID()}`, status: 'IN_QUEUE' })
      );
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        console.log(
          `✅ mock-runpod already listening on ${HOST}:${SERVICE_PORTS.MOCK_RUNPOD} (reusing)`
        );
        server?.removeListener('error', onError);
        server = null;
        resolve();
        return;
      }
      reject(error);
    };
    server?.once('error', onError);
    server?.listen(SERVICE_PORTS.MOCK_RUNPOD, HOST, () => {
      server?.removeListener('error', onError);
      console.log(`🚀 mock-runpod listening on ${MOCK_RUNPOD_URL}`);
      resolve();
    });
  });
}

/** Stop the stub. Safe to call when it was never started or was reused. */
export async function stopMockRunPod(): Promise<void> {
  const current = server;
  if (!current) return;
  server = null;
  await new Promise<void>((resolve) => current.close(() => resolve()));
  console.log('🛑 mock-runpod stopped');
}
