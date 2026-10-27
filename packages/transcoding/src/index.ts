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
 * // Claim an uploaded item; the RunPod call runs after the reply
 * const result = await service.triggerJobInternal(mediaId, creatorId);
 * if (!result.alreadyQueued) ctx.background(result.dispatchPromise);
 *
 * // Handle webhook callback (when RunPod completes)
 * await service.handleWebhook(validatedPayload);
 * ```
 */

// Dispatch rules (the webhook route classifies payloads before the service)
export { classifyWebhookPayload } from './dispatch';
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
  NotFoundError,
  TranscodingJobNotFoundError,
  TranscodingMediaNotFoundError,
  TranscodingNotRetryableError,
  TranscodingServiceError,
  ValidationError,
} from './errors';
// Live media status (Codex-l2c48.9): where lifecycle changes are published
export {
  type MediaStatusFeed,
  type MediaStatusPublisher,
  publishMediaRemoved,
  publishMediaStatus,
} from './media-status';
// Path utilities (SINGLE SOURCE OF TRUTH for R2/B2 keys)
export {
  // B2 paths (mezzanine archival)
  B2_PATH_CONFIG,
  getContentThumbnailBaseKey,
  getContentThumbnailKey,
  // R2 paths (delivery assets)
  getHlsMasterKey,
  getHlsPrefix,
  getHlsPreviewKey,
  getHlsVariantKey,
  getHlsVariantSegmentKey,
  getMediaThumbnailKey,
  getMediaThumbnailUrl,
  getMezzanineKey,
  getMezzaninePrefix,
  getOrgLogoKey,
  getOriginalKey,
  getThumbnailKey,
  getTranscodingOutputKeys,
  getUserAvatarBaseKey,
  getUserAvatarKey,
  getWaveformImageKey,
  getWaveformKey,
  isValidR2Key,
  PATH_CONFIG,
  parseR2Key,
  type ThumbnailSize,
} from './paths';
// Services
export {
  type AlertLedger,
  type MaintenanceReport,
  type RetryDueReport,
  TranscodingAlerts,
  type TranscodingMailer,
  TranscodingMaintenance,
  TranscodingService,
  type TranscodingServiceFullConfig,
} from './services';

// Types
export {
  hlsVariantSchema,
  type MediaStatus,
  // Package-specific types
  type MediaType,
  type MezzanineStatus,
  mezzanineStatusEnum,
  type RetryTranscodingInput,
  type RunPodJobRequest,
  type RunPodProgressWebhookPayload,
  type RunPodWebhookOutput,
  type RunPodWebhookPayload,
  type RunPodWebhookUnionPayload,
  retryTranscodingSchema,
  runpodJobStatusEnum,
  runpodProgressWebhookSchema,
  runpodWebhookOutputSchema,
  // Re-exported from @codex/validation
  runpodWebhookSchema,
  runpodWebhookUnionSchema,
  type TranscodingMediaItem,
  type TranscodingServiceConfig,
  type TranscodingStep,
  type TriggerTranscodingInput,
  transcodingPrioritySchema,
  transcodingStepEnum,
  triggerTranscodingSchema,
} from './types';
