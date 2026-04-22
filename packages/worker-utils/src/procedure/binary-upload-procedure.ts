/**
 * Binary Upload Procedure Function
 *
 * Extension of procedure() that handles raw binary body uploads (e.g. video/audio files).
 * Provides the same security guarantees as procedure() while supporting:
 * - Raw ArrayBuffer body reading
 * - Content-Type validation against an allowlist
 * - File size validation
 * - Typed file access in handler via ctx.file
 *
 * This is the binary counterpart to multipartProcedure() (which handles FormData).
 * Both ensure file upload endpoints benefit from:
 * - Consistent auth/validation via policy enforcement
 * - Rate limiting
 * - Standard error handling
 * - Service injection
 *
 * @example
 * ```typescript
 * import { FILE_SIZES, SUPPORTED_MEDIA_MIME_TYPES } from '@codex/constants';
 *
 * app.post('/api/media/:id/upload',
 *   binaryUploadProcedure({
 *     policy: { auth: 'required', roles: ['creator', 'admin'] },
 *     input: { params: createIdParamsSchema() },
 *     file: {
 *       maxSize: FILE_SIZES.MEDIA_MAX_BYTES,
 *       allowedMimeTypes: SUPPORTED_MEDIA_MIME_TYPES,
 *     },
 *     handler: async (ctx) => {
 *       return await ctx.services.media.upload(
 *         ctx.input.params.id,
 *         ctx.file.body,
 *         ctx.file.contentType,
 *         ctx.user.id,
 *       );
 *     },
 *   })
 * );
 * ```
 */

import type { ObservabilityClient } from '@codex/observability';
import { mapErrorToResponse, ValidationError } from '@codex/service-errors';
import type { HonoEnv } from '@codex/shared-types';
import type { Context } from 'hono';
import {
  enforcePolicyInline,
  generateRequestId,
  getClientIP,
  validateInput,
} from './helpers';
import { PaginatedResult } from './paginated-result';
import { createServiceRegistry } from './service-registry';
import type {
  InputSchema,
  ProcedureContext,
  ProcedurePolicy,
  ServiceRegistry,
} from './types';

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for the binary file being uploaded
 */
export interface BinaryFileConfig {
  /** Maximum file size in bytes */
  maxSize?: number;
  /** Minimum file size in bytes (reject empty/corrupt uploads) */
  minSize?: number;
  /** Allowed Content-Type values (Set or array) */
  allowedMimeTypes?: ReadonlySet<string> | readonly string[];
}

/**
 * Validated binary file data provided to the handler
 */
export interface ValidatedBinaryFile {
  /** Raw file content */
  body: ArrayBuffer;
  /** Validated Content-Type */
  contentType: string;
  /** File size in bytes */
  size: number;
}

/**
 * Context with binary file data
 */
export interface BinaryUploadContext<
  TPolicy extends ProcedurePolicy = { auth: 'required' },
  TInput extends InputSchema | undefined = undefined,
> extends Omit<ProcedureContext<TPolicy, TInput>, 'services'> {
  /** Validated binary file from the request body */
  file: ValidatedBinaryFile;
  /** Service registry */
  services: ServiceRegistry;
}

/**
 * Binary upload procedure configuration
 */
export interface BinaryUploadProcedureConfig<
  TPolicy extends ProcedurePolicy = { auth: 'required' },
  TInput extends InputSchema | undefined = undefined,
  TOutput = unknown,
> {
  /** Security policy configuration */
  policy?: TPolicy;
  /** Input validation schemas (for URL params/query — not body) */
  input?: TInput;
  /** Binary file configuration (MIME allowlist, max size) */
  file?: BinaryFileConfig;
  /** Handler function with fully typed context including ctx.file */
  handler: (ctx: BinaryUploadContext<TPolicy, TInput>) => Promise<TOutput>;
  /** Success HTTP status code */
  successStatus?: 200 | 201 | 204;
}

// ============================================================================
// Main Binary Upload Procedure
// ============================================================================

/**
 * Create a binary upload procedure handler
 *
 * Extends procedure() with:
 * - Raw ArrayBuffer body reading
 * - Content-Type validation against allowlist
 * - File size validation
 * - Typed file access in handler via ctx.file
 *
 * Maintains all standard procedure() guarantees:
 * - Policy enforcement (auth, RBAC, org membership)
 * - Input validation for params/query
 * - Error handling
 * - Service injection
 */
export function binaryUploadProcedure<
  const TPolicy extends ProcedurePolicy = { auth: 'required' },
  TInput extends InputSchema | undefined = undefined,
  TOutput = unknown,
>(
  config: BinaryUploadProcedureConfig<TPolicy, TInput, TOutput>
): (c: Context<HonoEnv>) => Promise<Response> {
  const {
    policy = { auth: 'required' } as TPolicy,
    input,
    file: fileConfig,
    handler,
    successStatus = 200,
  } = config;

  return async (c: Context<HonoEnv>) => {
    const obs = c.get('obs') as ObservabilityClient | undefined;
    let organizationId = c.get('organizationId');

    let registry: ReturnType<typeof createServiceRegistry>['registry'];
    let cleanup: (() => Promise<void>) | undefined;

    try {
      // ====================================================================
      // Step 1: Enforce Policy (auth, RBAC, IP, org membership)
      // ====================================================================
      await enforcePolicyInline(c, policy, obs);
      organizationId = c.get('organizationId');

      // ====================================================================
      // Step 2: Create Service Registry
      // ====================================================================
      const registryResult = createServiceRegistry(
        c.env,
        obs,
        organizationId,
        c.executionCtx
      );
      registry = registryResult.registry;
      cleanup = registryResult.cleanup;

      // ====================================================================
      // Step 3: Validate URL params/query (not body — that's raw binary)
      // ====================================================================
      const validatedInput = await validateInput(c, input, false);

      // ====================================================================
      // Step 4: Read and Validate Binary Body
      // ====================================================================
      const validatedFile = await validateBinaryBody(c, fileConfig);

      // ====================================================================
      // Step 5: Build Context
      // ====================================================================
      const ctx: BinaryUploadContext<TPolicy, TInput> = {
        user: c.get('user') as BinaryUploadContext<TPolicy, TInput>['user'],
        session: c.get('session') as BinaryUploadContext<
          TPolicy,
          TInput
        >['session'],
        input: validatedInput as BinaryUploadContext<TPolicy, TInput>['input'],
        file: validatedFile,
        requestId: c.get('requestId') || generateRequestId(),
        clientIP: c.get('clientIP') || getClientIP(c),
        userAgent: c.req.header('User-Agent') || 'unknown',
        organizationId: organizationId as BinaryUploadContext<
          TPolicy,
          TInput
        >['organizationId'],
        organizationRole: c.get('organizationRole'),
        env: c.env,
        executionCtx: c.executionCtx,
        obs,
        services: registry,
      };

      // ====================================================================
      // Step 6: Execute Handler
      // ====================================================================
      const result = await handler(ctx);

      // ====================================================================
      // Step 7: Return Response
      // ====================================================================
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
    } catch (error) {
      // ====================================================================
      // Step 8: Error Handling
      // ====================================================================
      const { statusCode, response } = mapErrorToResponse(error, { obs });
      return c.json(response, statusCode);
    } finally {
      // ====================================================================
      // Step 9: Cleanup
      // ====================================================================
      if (cleanup) {
        c.executionCtx.waitUntil(cleanup());
      }
    }
  };
}

// ============================================================================
// Binary Body Validation
// ============================================================================

async function validateBinaryBody(
  c: Context<HonoEnv>,
  config?: BinaryFileConfig
): Promise<ValidatedBinaryFile> {
  const contentType =
    c.req.header('content-type') ?? 'application/octet-stream';

  // Validate Content-Type against allowlist
  if (config?.allowedMimeTypes) {
    const allowed =
      config.allowedMimeTypes instanceof Set
        ? config.allowedMimeTypes
        : new Set(config.allowedMimeTypes);

    // Strip charset/boundary params for comparison (e.g. "video/mp4; charset=utf-8" → "video/mp4")
    const mimeOnly = contentType.split(';')[0]?.trim() ?? contentType;

    if (!allowed.has(mimeOnly)) {
      throw new ValidationError(
        `Content-Type '${mimeOnly}' is not allowed. Accepted: ${[...allowed].join(', ')}`,
        { code: 'INVALID_CONTENT_TYPE' }
      );
    }
  }

  // Read raw body
  const body = await c.req.arrayBuffer();
  const size = body.byteLength;

  // Validate empty body
  if (size === 0) {
    throw new ValidationError('Request body is empty', {
      code: 'EMPTY_BODY',
    });
  }

  // Validate minimum file size
  if (config?.minSize && size < config.minSize) {
    const minKB = Math.round(config.minSize / 1024);
    throw new ValidationError(
      `File size ${size} bytes is below minimum of ${minKB}KB`,
      { code: 'FILE_TOO_SMALL' }
    );
  }

  // Validate maximum file size
  if (config?.maxSize && size > config.maxSize) {
    const maxMB = Math.round(config.maxSize / 1024 / 1024);
    throw new ValidationError(
      `File size ${Math.round(size / 1024 / 1024)}MB exceeds maximum of ${maxMB}MB`,
      { code: 'FILE_TOO_LARGE' }
    );
  }

  return {
    body,
    contentType: contentType.split(';')[0]?.trim() ?? contentType,
    size,
  };
}
