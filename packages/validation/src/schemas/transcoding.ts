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
export const mezzanineStatusEnum = z.enum([
  'pending',
  'processing',
  'ready',
  'failed',
]);

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
 * RunPod job status from webhook (completion or failure)
 */
export const runpodJobStatusEnum = z.enum(['completed', 'failed']);

/**
 * Transcoding pipeline step names
 * Sent by handler between each processing stage for progress tracking
 */
export const transcodingStepEnum = z.enum([
  'downloading',
  'probing',
  'mezzanine',
  'loudness',
  'encoding_variants',
  'preview',
  'thumbnails',
  'waveform',
  'uploading_outputs',
  'finalizing',
]);

export type TranscodingStep = z.infer<typeof transcodingStepEnum>;

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
  'source',
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
  hlsMasterKey: z.string().max(500).nullable().optional(),
  hlsPreviewKey: z.string().max(500).nullable().optional(),

  // Visual assets
  thumbnailKey: z.string().max(500).nullable().optional(),
  waveformKey: z.string().max(500).nullable().optional(),
  waveformImageKey: z.string().max(500).nullable().optional(),

  // B2 archival mezzanine key (video only)
  mezzanineKey: z.string().max(500).nullable().optional(),

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
  // NOTE: nullable() is required because Python sends None → JSON null for audio
  // files (no video dimensions). Zod .optional() only accepts undefined, not null.
  durationSeconds: z.number().int().min(1).max(86400).nullable().optional(), // Max 24 hours
  width: z.number().int().min(1).max(7680).nullable().optional(), // Max 8K
  height: z.number().int().min(1).max(4320).nullable().optional(), // Max 8K

  // HLS variants that are ready (bounded to prevent DoS via unbounded array)
  readyVariants: z.array(hlsVariantSchema).min(1).max(10),

  // Audio loudness (×100 for precision)
  // Integrated Loudness (LUFS × 100): Range -10000 to 1000 (-100.00 to +10.00 LUFS)
  // Upper bound is generous: ffmpeg can measure positive LUFS for heavily clipped audio.
  loudnessIntegrated: z
    .number()
    .int()
    .min(-10000)
    .max(1000)
    .optional()
    .describe('Integrated loudness in LUFS * 100 (e.g. -1400 = -14.0 LUFS)'),

  // True Peak (dBTP × 100): Range -10000 to 2000 (-100.00 to +20.00 dBTP)
  // Upper bound is generous: clipped audio can measure true peaks above +2 dBTP.
  loudnessPeak: z
    .number()
    .int()
    .min(-10000)
    .max(2000)
    .optional()
    .describe('True peak in dBTP * 100 (e.g. -100 = -1.0 dBTP)'),

  // Loudness Range (LU × 100): Range 0 to 50000 (0.00 to 500.00 LU)
  loudnessRange: z
    .number()
    .int()
    .min(0)
    .max(50000)
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

/**
 * RunPod progress webhook payload
 * Sent by handler between pipeline steps (fire-and-forget)
 */
export const runpodProgressWebhookSchema = z.object({
  jobId: z.string().min(1, 'Job ID is required'),
  status: z.literal('progress'),
  progress: z.number().int().min(0).max(100),
  step: transcodingStepEnum,
  mediaId: uuidSchema.optional(),
});

export type RunPodProgressWebhookPayload = z.infer<
  typeof runpodProgressWebhookSchema
>;

/**
 * Combined webhook schema (discriminated union on status)
 * Accepts completion, failure, or progress payloads
 */
export const runpodWebhookUnionSchema = z.discriminatedUnion('status', [
  runpodWebhookSchema.extend({ status: z.literal('completed') }),
  runpodWebhookSchema.extend({
    status: z.literal('failed'),
    // Python handler includes mediaId on failure so the service can find the
    // media item even when runpodJobId hasn't been stored yet (local /runsync)
    mediaId: uuidSchema.optional(),
  }),
  runpodProgressWebhookSchema,
]);

export type RunPodWebhookUnionPayload = z.infer<
  typeof runpodWebhookUnionSchema
>;

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
  transcodingProgress: z.number().int().min(0).max(100).nullable(),
  transcodingStep: transcodingStepEnum.nullable(),
  readyVariants: z.array(hlsVariantSchema).nullable(),
});

export type TranscodingStatusResponse = z.infer<
  typeof transcodingStatusResponseSchema
>;
