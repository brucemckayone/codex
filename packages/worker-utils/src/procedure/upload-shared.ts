/**
 * Shared Upload Procedure Scaffolding
 *
 * Common orchestration helpers used by BOTH `multipartProcedure()` (FormData
 * file uploads) and `binaryUploadProcedure()` (raw ArrayBuffer uploads).
 *
 * The two procedures differ only in how they read the request body —
 * `multipart` parses FormData and validates per-field, `binary` reads a raw
 * `ArrayBuffer` and sniffs Content-Type. Every other step is identical:
 * policy enforcement, service registry creation, URL-param validation,
 * context assembly, response envelope, error handling, DB cleanup.
 *
 * This module exists to eliminate ~165 lines of scaffold duplication
 * (Codex-j9xcl). It is NOT part of the public API — exported from the
 * package barrel only so each procedure file can import it directly.
 */

import type { ObservabilityClient } from '@codex/observability';
import type { HonoEnv } from '@codex/shared-types';
import type { Context } from 'hono';
import { enforcePolicyInline, generateRequestId, getClientIP } from './helpers';
import { PaginatedResult } from './paginated-result';
import { createServiceRegistry } from './service-registry';
import type {
  InputSchema,
  ProcedureContext,
  ProcedurePolicy,
  ServiceRegistry,
} from './types';

interface UploadOrchestrationResult {
  organizationId: string | undefined;
  registry: ServiceRegistry;
  cleanup: () => Promise<void>;
}

/**
 * Enforce policy (auth, RBAC, IP, org membership) and create a fresh
 * service registry. Returns the resolved `organizationId` (re-read from
 * the context because `enforcePolicyInline` may set it when
 * `requireOrgMembership` is true) along with the registry + its cleanup
 * closure.
 */
export async function runUploadOrchestration(
  c: Context<HonoEnv>,
  policy: ProcedurePolicy,
  obs: ObservabilityClient | undefined
): Promise<UploadOrchestrationResult> {
  await enforcePolicyInline(c, policy, obs);
  const organizationId = c.get('organizationId');
  // Awaited for the same reason as in procedure(): the registry may resolve
  // a Hyperdrive client (dynamic node-postgres import) before returning.
  const registryResult = await createServiceRegistry(
    c.env,
    obs,
    organizationId,
    c.executionCtx
  );
  return {
    organizationId,
    registry: registryResult.registry,
    cleanup: registryResult.cleanup,
  };
}

/**
 * Build the shared 14-key procedure context. Used by `procedure()` and by
 * both upload procedures (`binaryUploadProcedure`, `multipartProcedure`).
 *
 * The upload procedures spread the result and layer the file-slot key
 * (`file: ValidatedBinaryFile` for binary, `files: InferFiles<TFiles>` for
 * multipart) on top of this base. `procedure()` consumes the result
 * directly — the return shape is structurally identical to
 * `ProcedureContext<TPolicy, TInput>`.
 *
 * Typed as `Omit<ProcedureContext, 'services'>` with an explicit
 * `ServiceRegistry` — matching the shape each upload context extends
 * (both contexts do `extends Omit<ProcedureContext<…>, 'services'>` and
 * then redeclare `services: ServiceRegistry`). For `procedure()`, this is
 * structurally a `ProcedureContext<TPolicy, TInput>` since
 * `ProcedureContext.services` is `ServiceRegistry`.
 */
/**
 * Collects handler-registered background work so the caller can tear down the
 * service registry only after that work has settled.
 *
 * Exists because `waitUntil(cleanup())` and a handler's own
 * `waitUntil(backgroundTask)` are siblings, not ordered: cleanup calls
 * `pool.end()` on the shared per-request DB client and, being near-instant,
 * reliably wins. Any DB access the background task attempts afterwards fails
 * with a bare "Failed query" — and when the task's whole purpose was to record
 * a failure, that failure disappears silently.
 */
export interface BackgroundTracker {
  /** Register a task; returns the same promise so it can be used inline. */
  background: <T>(promise: Promise<T>) => Promise<T>;
  /** Resolves once every registered task has settled (never rejects). */
  settled: () => Promise<unknown>;
}

export function createBackgroundTracker(): BackgroundTracker {
  const tasks: Promise<unknown>[] = [];

  return {
    background: (promise) => {
      tasks.push(promise);
      return promise;
    },
    // allSettled attaches handlers, so a rejecting task cannot surface as an
    // unhandled rejection, and one failure never skips cleanup.
    settled: () => Promise.allSettled(tasks),
  };
}

export function buildBaseProcedureContext<
  TPolicy extends ProcedurePolicy,
  TInput extends InputSchema | undefined,
>(
  c: Context<HonoEnv>,
  organizationId: string | undefined,
  validatedInput: unknown,
  registry: ServiceRegistry,
  obs: ObservabilityClient | undefined,
  background: BackgroundTracker['background']
): Omit<ProcedureContext<TPolicy, TInput>, 'services'> & {
  services: ServiceRegistry;
} {
  return {
    background,
    // KV-write escape hatch. `waitUntil` and NOT the `background` tracker
    // above: the tracker exists to hold off `pool.end()` for background
    // DATABASE work, and a cache write has no pool to lose — routing it
    // through the tracker would only delay this request's own cleanup behind
    // it. See ProcedureContext.cacheWrite.
    cacheWrite: (promise) => {
      // Best-effort by definition, and an unhandled rejection inside
      // waitUntil() is noise the caller cannot catch, so swallow here rather
      // than asking every caller to remember `.catch()`.
      c.executionCtx.waitUntil(promise.catch(() => {}));
    },
    user: c.get('user') as ProcedureContext<TPolicy, TInput>['user'],
    session: c.get('session') as ProcedureContext<TPolicy, TInput>['session'],
    input: validatedInput as ProcedureContext<TPolicy, TInput>['input'],
    requestId: c.get('requestId') || generateRequestId(),
    clientIP: c.get('clientIP') || getClientIP(c),
    userAgent: c.req.header('User-Agent') || 'unknown',
    organizationId: organizationId as ProcedureContext<
      TPolicy,
      TInput
    >['organizationId'],
    organizationRole: c.get('organizationRole'),
    env: c.env,
    executionCtx: c.executionCtx,
    obs,
    services: registry,
  };
}

/**
 * Emit the standard upload-procedure success response. Mirrors the
 * envelope contract used by `procedure()`:
 *   - 204 → empty body
 *   - `PaginatedResult` → `{ items, pagination }`
 *   - anything else → `{ data: result }`
 */
export function sendUploadResponse(
  c: Context<HonoEnv>,
  result: unknown,
  successStatus: 200 | 201 | 204
): Response {
  if (successStatus === 204) {
    return c.body(null, 204);
  }
  if (result instanceof PaginatedResult) {
    return c.json(
      { items: result.items, pagination: result.pagination },
      successStatus
    );
  }
  return c.json({ data: result }, successStatus);
}
