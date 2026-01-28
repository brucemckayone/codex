/**
 * Transcoding Types
 *
 * Re-exports validation schemas and types from @codex/validation,
 * plus additional types specific to the transcoding service.
 */

// Re-export all transcoding schemas and types from validation package
export {
  type GetTranscodingStatusInput,
  getTranscodingStatusSchema,
  hlsVariantSchema,
  mezzanineStatusEnum,
  type RetryTranscodingInput,
  type RunPodWebhookOutput,
  // Types
  type RunPodWebhookPayload,
  retryTranscodingSchema,
  runpodJobStatusEnum,
  runpodWebhookOutputSchema,
  // Schemas
  runpodWebhookSchema,
  type TranscodingStatusResponse,
  type TriggerTranscodingInput,
  transcodingPrioritySchema,
  transcodingStatusResponseSchema,
  triggerTranscodingSchema,
} from '@codex/validation';

/**
 * Media type for transcoding operations
 */
export type MediaType = 'video' | 'audio';

/**
 * Media status enum values
 */
export type MediaStatus =
  | 'uploading'
  | 'uploaded'
  | 'transcoding'
  | 'ready'
  | 'failed';

/**
 * HLS variant quality levels
 */
export type HlsVariant = '1080p' | '720p' | '480p' | '360p' | 'audio';

/**
 * RunPod job request payload
 * Sent when triggering a new transcoding job
 *
 * SECURITY: Credentials are NOT passed in job payloads.
 * - B2 credentials: Configure in RunPod's secret manager (injected as env vars)
 * - R2 credentials: Configure in RunPod's secret manager (injected as env vars)
 * - webhookSecret: Configure in RunPod's secret manager (for signing callbacks)
 *
 * The job payload only includes paths (inputKey) so the handler knows
 * which files to download/upload.
 */
export interface RunPodJobRequest {
  input: {
    mediaId: string;
    type: MediaType;
    creatorId: string;
    inputKey: string;
    webhookUrl: string;
    priority?: number;
  };
}

/**
 * RunPod API response when triggering a job
 */
export interface RunPodJobResponse {
  id: string;
  status: string;
}

/**
 * Service configuration for TranscodingService
 *
 * SECURITY: Credentials are NOT passed to RunPod via job payloads.
 * - B2 credentials: Configure in RunPod's secret manager (outside this codebase)
 * - R2 credentials: Configure in RunPod's secret manager (outside this codebase)
 * - webhookSecret: Configure in RunPod's secret manager (outside this codebase)
 *
 * This service only needs RunPod API credentials to trigger jobs.
 */
export interface TranscodingServiceConfig {
  runpodApiKey: string;
  runpodEndpointId: string;
  webhookBaseUrl: string;
  runpodApiBaseUrl?: string;
}

/**
 * Mezzanine processing status
 */
export type MezzanineStatus = 'pending' | 'processing' | 'ready' | 'failed';

/**
 * Media item data required for transcoding operations
 */
export interface TranscodingMediaItem {
  id: string;
  creatorId: string;
  mediaType: MediaType;
  status: MediaStatus;
  r2Key: string;
  transcodingAttempts: number;
  runpodJobId: string | null;
  transcodingError: string | null;
  transcodingPriority: number;
  hlsMasterPlaylistKey: string | null;
  hlsPreviewKey: string | null;
  thumbnailKey: string | null;
  waveformKey: string | null;
  waveformImageKey: string | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  readyVariants: string[] | null;
  /** B2 archival mezzanine key (high-quality CRF 18 intermediate) */
  mezzanineKey: string | null;
  /** Mezzanine processing status */
  mezzanineStatus: MezzanineStatus | null;
}
