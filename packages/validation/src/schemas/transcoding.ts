import { z } from 'zod';
import { uuidSchema } from '../primitives';

/**
 * Transcoding Validation Schemas
 *
 * Validates RunPod webhook payloads and transcoding-related API inputs.
 * Aligned with P1-TRANSCODE-001 Media Transcoding Service.
 */

// ============================================================================
// Enums (align with database CHECK constraints)
// ============================================================================

/**
 * Mezzanine status enum
 * Aligns with database CHECK constraint: check_mezzanine_status
 */
export const mezzanineStatusEnum = z.enum(
  ['pending', 'processing', 'ready', 'failed'],
  {
    errorMap: () => ({
      message: 'Mezzanine status must be pending, processing, ready, or failed',
    }),
  }
);

/**
 * Transcoding priority enum (0-4 scale)
 * 0 = urgent, 2 = normal, 4 = backlog
 */
export const transcodingPrioritySchema = z
  .number()
  .int()
  .min(0, 'Priority must be at least 0')
  .max(4, 'Priority cannot exceed 4')
  .default(2);

// ============================================================================
// RunPod Webhook Schemas
// ============================================================================

/**
 * RunPod job status from webhook
 */
export const runpodJobStatusEnum = z.enum(['completed', 'failed'], {
  errorMap: () => ({ message: 'Job status must be completed or failed' }),
});

/**
 * Canonical thumbnail size variants
 * Used by: transcoding paths, RunPod handler, webhook validation
 * Python mirror: infrastructure/runpod/handler/main.py ALLOWED_THUMBNAIL_SIZES
 */
export const THUMBNAIL_SIZES = ['sm', 'md', 'lg'] as const;
export const thumbnailSizeSchema = z.enum(THUMBNAIL_SIZES);
export type ThumbnailSize = z.infer<typeof thumbnailSizeSchema>;

/**
 * HLS variant names (quality levels)
 */
export const hlsVariantSchema = z.enum([
  '1080p',
  '720p',
  '480p',
  '360p',
  'audio',
]);

/**
 * RunPod webhook output payload (on success)
 * Contains transcoded asset locations and metadata
 */
export const runpodWebhookOutputSchema = z.object({
  // Media identification
  mediaId: uuidSchema,
  type: z.enum(['video', 'audio']),

  // HLS outputs
  hlsMasterKey: z.string().max(500).optional(),
  hlsPreviewKey: z.string().max(500).optional(),

  // Visual assets
  thumbnailKey: z.string().max(500).optional(),
  waveformKey: z.string().max(500).optional(),
  waveformImageKey: z.string().max(500).optional(),

  // Multi-size thumbnail variants
  // Keys MUST match THUMBNAIL_SIZES constant above. If sizes change,
  // update both this schema and the THUMBNAIL_SIZES array.
  // Also update: infrastructure/runpod/handler/main.py ALLOWED_THUMBNAIL_SIZES
  thumbnailVariants: z
    .object({
      sm: z.string().max(500),
      md: z.string().max(500),
      lg: z.string().max(500),
    })
    .nullable()
    .optional(),

  // Media metadata
  durationSeconds: z.number().int().min(0).max(86400).optional(), // Max 24 hours
  width: z.number().int().min(1).max(7680).optional(), // Max 8K
  height: z.number().int().min(1).max(4320).optional(), // Max 8K

  // HLS variants that are ready (bounded to prevent DoS via unbounded array)
  readyVariants: z.array(hlsVariantSchema).max(10).optional(),

  // Audio loudness (×100 for precision)
  // Integrated Loudness (LUFS × 100): Range -10000 to 0 (-100.00 to 0.00 LUFS)
  loudnessIntegrated: z
    .number()
    .int()
    .min(-10000)
    .max(0)
    .optional()
    .describe('Integrated loudness in LUFS * 100 (e.g. -1400 = -14.0 LUFS)'),

  // True Peak (dBTP × 100): Range -10000 to 200 (-100.00 to +2.00 dBTP)
  loudnessPeak: z
    .number()
    .int()
    .min(-10000)
    .max(200)
    .optional()
    .describe('True peak in dBTP * 100 (e.g. -100 = -1.0 dBTP)'),

  // Loudness Range (LU × 100): Range 0 to 10000 (0.00 to 100.00 LU)
  loudnessRange: z
    .number()
    .int()
    .min(0)
    .max(10000)
    .optional()
    .describe('Loudness range in LU * 100 (e.g. 700 = 7.0 LU)'),
});

export type RunPodWebhookOutput = z.infer<typeof runpodWebhookOutputSchema>;

/**
 * RunPod webhook payload
 * Received when transcoding job completes (success or failure)
 *
 * @security HMAC-SHA256 signature verification REQUIRED before processing.
 * The webhook handler must verify the `x-runpod-signature` header using
 * RUNPOD_WEBHOOK_SECRET before trusting this payload. Never process
 * webhook data without signature verification.
 *
 * @see packages/security for HMAC verification utilities
 */
export const runpodWebhookSchema = z.object({
  // Job identification
  jobId: z.string().min(1, 'Job ID is required'),
  status: runpodJobStatusEnum,

  // Output data (present on success)
  output: runpodWebhookOutputSchema.optional(),

  // Error message (present on failure, max 2KB to match DB constraint)
  error: z.string().max(2000).optional(),
});

export type RunPodWebhookPayload = z.infer<typeof runpodWebhookSchema>;

// ============================================================================
// API Request Schemas
// ============================================================================

/**
 * Retry transcoding request
 * Used when manually retrying a failed transcoding job
 */
export const retryTranscodingSchema = z.object({
  mediaId: uuidSchema,
});

export type RetryTranscodingInput = z.infer<typeof retryTranscodingSchema>;

/**
 * Get transcoding status request
 */
export const getTranscodingStatusSchema = z.object({
  mediaId: uuidSchema,
});

export type GetTranscodingStatusInput = z.infer<
  typeof getTranscodingStatusSchema
>;

/**
 * Trigger transcoding request (internal/service use)
 */
export const triggerTranscodingSchema = z.object({
  mediaId: uuidSchema,
  priority: transcodingPrioritySchema.optional(),
});

export type TriggerTranscodingInput = z.infer<typeof triggerTranscodingSchema>;

// ============================================================================
// Response Types (for documentation/type safety)
// ============================================================================

/**
 * Transcoding status response
 */
export const transcodingStatusResponseSchema = z.object({
  status: z.enum(['uploading', 'uploaded', 'transcoding', 'ready', 'failed']),
  transcodingAttempts: z.number().int().min(0),
  transcodingError: z.string().nullable(),
  runpodJobId: z.string().nullable(),
  transcodingPriority: z.number().int().min(0).max(4),
  readyVariants: z.array(hlsVariantSchema).nullable(),
});

export type TranscodingStatusResponse = z.infer<
  typeof transcodingStatusResponseSchema
>;
