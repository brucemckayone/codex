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
  const registryResult = createServiceRegistry(
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
export function buildBaseProcedureContext<
  TPolicy extends ProcedurePolicy,
  TInput extends InputSchema | undefined,
>(
  c: Context<HonoEnv>,
  organizationId: string | undefined,
  validatedInput: unknown,
  registry: ServiceRegistry,
  obs: ObservabilityClient | undefined
): Omit<ProcedureContext<TPolicy, TInput>, 'services'> & {
  services: ServiceRegistry;
} {
  return {
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
