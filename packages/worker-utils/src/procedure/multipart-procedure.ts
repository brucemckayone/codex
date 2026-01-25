/**
 * Multipart Procedure Function
 *
 * Extension of procedure() that handles multipart form-data requests (file uploads).
 * Provides the same security guarantees as procedure() while supporting:
 * - File uploads via FormData
 * - File validation (MIME type, size)
 * - Zod validation for non-file form fields
 *
 * This ensures file upload endpoints benefit from:
 * - Consistent auth/validation via policy enforcement
 * - Rate limiting
 * - Standard error handling
 * - Service injection
 *
 * @example
 * ```typescript
 * app.post('/api/organizations/:id/settings/branding/logo',
 *   multipartProcedure({
 *     policy: { auth: 'required', requireOrgManagement: true },
 *     input: { params: orgIdParamSchema },
 *     files: {
 *       logo: {
 *         required: true,
 *         maxSize: 5 * 1024 * 1024, // 5MB
 *         allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
 *       },
 *     },
 *     handler: async (ctx) => {
 *       const logoFile = ctx.files.logo;
 *       return await ctx.services.settings.uploadLogo(logoFile);
 *     },
 *   })
 * );
 * ```
 */

import type { ObservabilityClient } from '@codex/observability';
import { mapErrorToResponse } from '@codex/service-errors';
import type { HonoEnv } from '@codex/shared-types';
import type { Context } from 'hono';
import {
  enforcePolicyInline,
  generateRequestId,
  getClientIP,
  validateInput,
} from './helpers';
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
 * File field configuration
 */
export interface FileFieldConfig {
  /** Whether this file is required */
  required?: boolean;
  /** Maximum file size in bytes */
  maxSize?: number;
  /** Allowed MIME types */
  allowedMimeTypes?: readonly string[];
  /** Custom error message for invalid file type */
  invalidTypeMessage?: string;
  /** Custom error message for file too large */
  fileTooLargeMessage?: string;
}

/**
 * File validation schema - maps field names to file configs
 */
export type FileSchema = Record<string, FileFieldConfig>;

/**
 * Validated file data returned to handler
 */
export interface ValidatedFile {
  /** File name */
  name: string;
  /** MIME type */
  type: string;
  /** File size in bytes */
  size: number;
  /** File content as ArrayBuffer */
  buffer: ArrayBuffer;
}

/**
 * Infer file types from schema
 */
export type InferFiles<T extends FileSchema | undefined> = T extends FileSchema
  ? {
      [K in keyof T]: T[K]['required'] extends true
        ? ValidatedFile
        : ValidatedFile | undefined;
    }
  : Record<string, never>;

/**
 * Context with file data
 */
export interface MultipartProcedureContext<
  TPolicy extends ProcedurePolicy = { auth: 'required' },
  TInput extends InputSchema | undefined = undefined,
  TFiles extends FileSchema | undefined = undefined,
> extends Omit<ProcedureContext<TPolicy, TInput>, 'services'> {
  /** Validated files from the form data */
  files: InferFiles<TFiles>;
  /** Service registry */
  services: ServiceRegistry;
}

/**
 * Multipart procedure configuration
 */
export interface MultipartProcedureConfig<
  TPolicy extends ProcedurePolicy = { auth: 'required' },
  TInput extends InputSchema | undefined = undefined,
  TFiles extends FileSchema | undefined = undefined,
  TOutput = unknown,
> {
  /** Security policy configuration */
  policy?: TPolicy;
  /** Input validation schemas (for URL params/query) */
  input?: TInput;
  /** File field configurations */
  files?: TFiles;
  /** Handler function with fully typed context */
  handler: (
    ctx: MultipartProcedureContext<TPolicy, TInput, TFiles>
  ) => Promise<TOutput>;
  /** Success HTTP status code */
  successStatus?: 200 | 201 | 204;
}

// ============================================================================
// File Validation Errors
// ============================================================================

export class FileTooLargeError extends Error {
  constructor(
    public fieldName: string,
    public actualSize: number,
    public maxSize: number
  ) {
    super(
      `File '${fieldName}' exceeds maximum size of ${Math.round(maxSize / 1024 / 1024)}MB`
    );
    this.name = 'FileTooLargeError';
  }
}

export class InvalidFileTypeError extends Error {
  constructor(
    public fieldName: string,
    public actualType: string,
    public allowedTypes: readonly string[]
  ) {
    super(
      `File '${fieldName}' has invalid type '${actualType}'. Allowed: ${allowedTypes.join(', ')}`
    );
    this.name = 'InvalidFileTypeError';
  }
}

export class MissingFileError extends Error {
  constructor(public fieldName: string) {
    super(`Required file '${fieldName}' is missing`);
    this.name = 'MissingFileError';
  }
}

// ============================================================================
// Main Multipart Procedure
// ============================================================================

/**
 * Create a multipart form-data procedure handler
 *
 * Extends procedure() with:
 * - FormData parsing
 * - File validation (size, MIME type)
 * - Typed file access in handler
 *
 * Maintains all standard procedure() guarantees:
 * - Policy enforcement (auth, RBAC, org membership)
 * - Input validation for params/query
 * - Error handling
 * - Service injection
 */
export function multipartProcedure<
  const TPolicy extends ProcedurePolicy = { auth: 'required' },
  TInput extends InputSchema | undefined = undefined,
  TFiles extends FileSchema | undefined = undefined,
  TOutput = unknown,
>(
  config: MultipartProcedureConfig<TPolicy, TInput, TFiles, TOutput>
): (c: Context<HonoEnv>) => Promise<Response> {
  const {
    policy = { auth: 'required' } as TPolicy,
    input,
    files: fileSchema,
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
      const registryResult = createServiceRegistry(c.env, obs, organizationId);
      registry = registryResult.registry;
      cleanup = registryResult.cleanup;

      // ====================================================================
      // Step 3: Validate URL params/query (not body - that's FormData)
      // ====================================================================
      const validatedInput = await validateInput(c, input, false);

      // ====================================================================
      // Step 4: Parse and Validate FormData
      // ====================================================================
      const formData = await c.req.formData();
      const validatedFiles = await validateFiles(formData, fileSchema);

      // ====================================================================
      // Step 5: Build Context
      // ====================================================================
      const ctx: MultipartProcedureContext<TPolicy, TInput, TFiles> = {
        user: c.get('user') as MultipartProcedureContext<
          TPolicy,
          TInput,
          TFiles
        >['user'],
        session: c.get('session') as MultipartProcedureContext<
          TPolicy,
          TInput,
          TFiles
        >['session'],
        input: validatedInput as MultipartProcedureContext<
          TPolicy,
          TInput,
          TFiles
        >['input'],
        files: validatedFiles as InferFiles<TFiles>,
        requestId: c.get('requestId') || generateRequestId(),
        clientIP: c.get('clientIP') || getClientIP(c),
        userAgent: c.req.header('User-Agent') || 'unknown',
        organizationId: organizationId as MultipartProcedureContext<
          TPolicy,
          TInput,
          TFiles
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
// File Validation Helper
// ============================================================================

async function validateFiles<T extends FileSchema | undefined>(
  formData: FormData,
  schema: T
): Promise<InferFiles<T>> {
  if (!schema) {
    return {} as InferFiles<T>;
  }

  const result: Record<string, ValidatedFile | undefined> = {};

  for (const [fieldName, config] of Object.entries(schema)) {
    const file = formData.get(fieldName);

    // Check if file exists
    if (!file || !((file as unknown) instanceof File)) {
      if (config.required) {
        throw new MissingFileError(fieldName);
      }
      result[fieldName] = undefined;
      continue;
    }

    const validFile = file as unknown as File;

    // Validate MIME type
    if (
      config.allowedMimeTypes &&
      !config.allowedMimeTypes.includes(validFile.type)
    ) {
      throw new InvalidFileTypeError(
        fieldName,
        validFile.type,
        config.allowedMimeTypes
      );
    }

    // Validate file size
    if (config.maxSize && validFile.size > config.maxSize) {
      throw new FileTooLargeError(fieldName, validFile.size, config.maxSize);
    }

    // Read file content
    const buffer = await validFile.arrayBuffer();

    result[fieldName] = {
      name: validFile.name,
      type: validFile.type,
      size: validFile.size,
      buffer,
    };
  }

  return result as InferFiles<T>;
}
