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

  // Media metadata
  durationSeconds: z.number().int().min(0).max(86400).optional(), // Max 24 hours
  width: z.number().int().min(1).max(7680).optional(), // Max 8K
  height: z.number().int().min(1).max(4320).optional(), // Max 8K

  // HLS variants that are ready
  readyVariants: z.array(hlsVariantSchema).optional(),

  // Audio loudness (×100 for precision)
  loudnessIntegrated: z.number().int().optional(), // LUFS × 100
  loudnessPeak: z.number().int().optional(), // dBTP × 100
  loudnessRange: z.number().int().optional(), // LRA × 100
});

export type RunPodWebhookOutput = z.infer<typeof runpodWebhookOutputSchema>;

/**
 * RunPod webhook payload
 * Received when transcoding job completes (success or failure)
 */
export const runpodWebhookSchema = z.object({
  // Job identification
  jobId: z.string().min(1, 'Job ID is required'),
  status: runpodJobStatusEnum,

  // Output data (present on success)
  output: runpodWebhookOutputSchema.optional(),

  // Error message (present on failure)
  error: z.string().optional(),
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
