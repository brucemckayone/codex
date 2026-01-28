/**
 * @codex/transcoding
 *
 * Media transcoding service package for RunPod GPU integration.
 *
 * This package provides:
 * - TranscodingService: Core business logic for transcoding lifecycle
 * - Error classes: Domain-specific errors for transcoding operations
 * - Path utilities: R2 key generation (SINGLE SOURCE OF TRUTH)
 * - Types: RunPod payloads, webhook types, service types
 *
 * @example
 * ```typescript
 * import {
 *   TranscodingService,
 *   getHlsMasterKey,
 *   TranscodingMediaNotFoundError,
 * } from '@codex/transcoding';
 *
 * const service = new TranscodingService({
 *   db: dbHttp,
 *   environment: 'production',
 *   obs: observabilityClient,
 *   runpodApiKey: env.RUNPOD_API_KEY,
 *   runpodEndpointId: env.RUNPOD_ENDPOINT_ID,
 *   webhookBaseUrl: 'https://media-api.codex.com',
 * });
 *
 * // Trigger transcoding (async - returns immediately)
 * await service.triggerJob(mediaId, creatorId);
 *
 * // Handle webhook callback (when RunPod completes)
 * await service.handleWebhook(validatedPayload);
 * ```
 */

// Errors
export {
  // Re-exported base errors
  BusinessLogicError,
  ForbiddenError,
  InternalServiceError,
  // Domain-specific errors
  InvalidMediaStateError,
  InvalidMediaTypeError,
  InvalidWebhookSignatureError,
  isTranscodingServiceError,
  MaxRetriesExceededError,
  MediaOwnershipError,
  NotFoundError,
  RunPodApiError,
  TranscodingJobNotFoundError,
  TranscodingMediaNotFoundError,
  TranscodingServiceError,
  ValidationError,
  wrapError,
} from './errors';
// Path utilities (SINGLE SOURCE OF TRUTH for R2/B2 keys)
export {
  // B2 paths (mezzanine archival)
  B2_PATH_CONFIG,
  getContentThumbnailKey,
  // R2 paths (delivery assets)
  getHlsMasterKey,
  getHlsPrefix,
  getHlsPreviewKey,
  getHlsVariantKey,
  getMezzanineKey,
  getMezzaninePrefix,
  getOrgLogoKey,
  getOriginalKey,
  getThumbnailKey,
  getTranscodingOutputKeys,
  getUserAvatarKey,
  getWaveformImageKey,
  getWaveformKey,
  isValidR2Key,
  PATH_CONFIG,
  parseR2Key,
} from './paths';
// Services
export {
  TranscodingService,
  type TranscodingServiceFullConfig,
} from './services';

// Types
export {
  type GetTranscodingStatusInput,
  getTranscodingStatusSchema,
  type HlsVariant,
  hlsVariantSchema,
  type MediaStatus,
  // Package-specific types
  type MediaType,
  type MezzanineStatus,
  mezzanineStatusEnum,
  type RetryTranscodingInput,
  type RunPodJobRequest,
  type RunPodJobResponse,
  type RunPodWebhookOutput,
  type RunPodWebhookPayload,
  retryTranscodingSchema,
  runpodJobStatusEnum,
  runpodWebhookOutputSchema,
  // Re-exported from @codex/validation
  runpodWebhookSchema,
  type TranscodingMediaItem,
  type TranscodingServiceConfig,
  type TranscodingStatusResponse,
  type TriggerTranscodingInput,
  transcodingPrioritySchema,
  transcodingStatusResponseSchema,
  triggerTranscodingSchema,
} from './types';
