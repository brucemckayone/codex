import { TRANSCODING_ERROR_MAX_LENGTH } from '@codex/constants';
import { z } from 'zod';
import { readStillFolderName } from '../image';
import { creatorIdSchema, uuidSchema } from '../primitives';

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
 * Python mirror: infrastructure/runpod/handler/main.py FLAT_POSTER_SIZES (sm/md/lg)
 * and POSTER_SIZES (+ xl); the contract fixtures pin both to this schema.
 */
export const THUMBNAIL_SIZES = ['sm', 'md', 'lg'] as const;
export const thumbnailSizeSchema = z.enum(THUMBNAIL_SIZES);
export type ThumbnailSize = z.infer<typeof thumbnailSizeSchema>;

/**
 * HLS variant names (quality levels) — the LOGICAL variant labels reported in
 * `readyVariants` (webhook payload, DB, streaming response, client quality
 * picker). For audio the transcoder collapses its bitrate rungs to the single
 * logical label `audio` (see infrastructure/runpod/handler/main.py
 * `transcode_audio_hls` → `return ["audio"]`).
 *
 * NOTE: this is NOT the same set as the PHYSICAL R2 directory names the master
 * playlist references — use `hlsVariantPathSchema` for that. See its docblock.
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
 * PHYSICAL HLS variant directory names — the path segment the transcoder emits
 * into `master.m3u8` (`<variant>/index.m3u8`) and creates as an R2 directory.
 * These are what the token-authenticated variant-playlist proxy receives as its
 * `:variant` route param, so this enum is the allowlist that stops the proxy
 * being coerced into building an arbitrary R2 key path.
 *
 * This DIFFERS from `hlsVariantSchema` (the logical `readyVariants` set):
 *   - video rungs coincide (`720p` label == `720p` directory), plus `source`;
 *   - audio has NO physical `audio/` directory — it is split into bitrate rungs
 *     `128k` / `64k` (RunPod `AUDIO_VARIANTS`), which the master references
 *     directly. Reusing the logical enum here 403'd all audio playback.
 *
 * Python mirror: infrastructure/runpod/handler/main.py — `HLS_VARIANTS` keys
 * (video) + the `source` fallback + `AUDIO_VARIANTS` keys (audio). `1080p` and
 * `360p` are kept for forward-compat (the v1 ladder dropped them; re-adding is
 * a config-only change and the proxy must not 403 if they return).
 */
export const hlsVariantPathSchema = z.enum([
  '1080p',
  '720p',
  '480p',
  '360p',
  'source',
  '128k',
  '64k',
]);

/**
 * RunPod webhook output payload (on success)
 * Contains transcoded asset locations and metadata
 */
export const runpodWebhookOutputSchema = z
  .object({
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
    // sm/md/lg MUST match THUMBNAIL_SIZES constant above. If sizes change,
    // update both this schema and the THUMBNAIL_SIZES array.
    // Also update main.py POSTER_SIZES / FLAT_POSTER_SIZES, and regenerate the
    // contract fixtures (infrastructure/runpod/tests/fixtures/README.md).
    // `xl` comes only from a handler writing posters in the sized image layout
    // (job input contract 2, Codex-l2c48); an older image sends three sizes.
    thumbnailVariants: z
      .object({
        sm: z.string().max(500),
        md: z.string().max(500),
        lg: z.string().max(500),
        xl: z.string().max(500).optional(),
      })
      .nullable()
      .optional(),

    // Media metadata
    // NOTE: nullable() is required because Python sends None → JSON null for audio
    // files (no video dimensions). Zod .optional() only accepts undefined, not null.
    durationSeconds: z.number().int().min(1).max(86400).nullable().optional(), // Max 24 hours
    // Max 8K in either orientation: the handler reports the picture as shown
    // (upright), so a portrait 8K clip is 4320x7680 (Codex-l2c48.8).
    width: z.number().int().min(1).max(7680).nullable().optional(),
    height: z.number().int().min(1).max(7680).nullable().optional(),

    // HLS variants that are ready (bounded to prevent DoS via unbounded array)
    readyVariants: z.array(hlsVariantSchema).min(1).max(10),

    // Audio loudness (×100 for precision). nullable(): the handler sends None
    // when ENABLE_LOUDNESS_ANALYSIS is off, which would otherwise reject the
    // whole completion webhook.
    // Integrated Loudness (LUFS × 100): Range -10000 to 1000 (-100.00 to +10.00 LUFS)
    // Upper bound is generous: ffmpeg can measure positive LUFS for heavily clipped audio.
    loudnessIntegrated: z
      .number()
      .int()
      .min(-10000)
      .max(1000)
      .nullable()
      .optional()
      .describe('Integrated loudness in LUFS * 100 (e.g. -1400 = -14.0 LUFS)'),

    // True Peak (dBTP × 100): Range -10000 to 2000 (-100.00 to +20.00 dBTP)
    // Upper bound is generous: clipped audio can measure true peaks above +2 dBTP.
    loudnessPeak: z
      .number()
      .int()
      .min(-10000)
      .max(2000)
      .nullable()
      .optional()
      .describe('True peak in dBTP * 100 (e.g. -100 = -1.0 dBTP)'),

    // Loudness Range (LU × 100): Range 0 to 50000 (0.00 to 500.00 LU)
    loudnessRange: z
      .number()
      .int()
      .min(0)
      .max(50000)
      .nullable()
      .optional()
      .describe('Loudness range in LU * 100 (e.g. 700 = 7.0 LU)'),
  })
  .superRefine((output, ctx) => {
    // A poster in the sized image layout (`{w}x{h}-{nonce}/`) promises all four
    // sizes: the web lists xl for any such folder from its NAME alone, so a
    // missing file would be a broken srcset candidate nobody logs. The flat
    // layout an older handler writes has no xl and no promise.
    const key = output.thumbnailKey;
    if (!key) return;
    const folder = key.slice(0, key.lastIndexOf('/'));
    if (!readStillFolderName(folder.slice(folder.lastIndexOf('/') + 1))) return;
    for (const size of [...THUMBNAIL_SIZES, 'xl'] as const) {
      if (output.thumbnailVariants?.[size] !== `${folder}/${size}.webp`) {
        ctx.addIssue({
          code: 'custom',
          path: ['thumbnailVariants', size],
          message: `A sized poster folder needs ${folder}/${size}.webp`,
        });
      }
    }
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

  // Error message (present on failure). Truncated to the 2KB column rather
  // than bounded: Python cuts at 2000 code points, Zod counts UTF-16 units, so
  // ffmpeg stderr carrying emoji metadata would otherwise reject the whole
  // failure webhook and lose the failure it reports.
  error: z
    .string()
    .transform((message) => message.slice(0, TRANSCODING_ERROR_MAX_LENGTH))
    .optional(),

  // Why the job failed, ideally a job-side TRANSCODING_ERROR_CODES value
  // (@codex/constants). Accepted as ANYTHING: the handler deploys separately,
  // and Python sends None as null, so any bound here would reject the failure
  // webhook it rides on. The service maps it with toJobErrorCode and logs a
  // raw value it does not recognise (isTranscodingErrorCode).
  errorCode: z.unknown().optional(),
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
  // Echoed by the handler since Codex-l2c48.8 so the tick routes to the
  // creator's status shard; it never decides who sees it (the object shows a
  // tick only on the row it already holds). A value this can't take is
  // dropped rather than costing the tick; an older handler sends none.
  creatorId: creatorIdSchema.nullish().catch(undefined),
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
    // media item even when runpodJobId hasn't been stored yet (local /runsync).
    // nullish(): a failure raised before mediaId is read arrives as null.
    mediaId: uuidSchema.nullish(),
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
