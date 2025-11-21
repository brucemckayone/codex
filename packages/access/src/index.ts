/**
 * @codex/access
 *
 * Content access control and playback tracking for Codex platform.
 *
 * Core Responsibilities:
 * - Verify user access to content (free vs purchased)
 * - Generate time-limited signed R2 URLs for streaming
 * - Track video/audio playback progress for resume functionality
 * - Provide user content library with watch history
 *
 * Integration Points:
 * - Used by: Auth worker (streaming URLs), Admin dashboard (analytics)
 * - Depends on: @codex/database (content, purchases), @codex/cloudflare-clients (R2)
 *
 * Security Model:
 * - All operations require authenticated user ID (from JWT)
 * - Row-level security: Users can only access their own data
 * - Access control: Paid content requires purchase verification
 */

// Re-export validation schemas for convenience
export {
  type GetPlaybackProgressInput,
  type GetStreamingUrlInput,
  getPlaybackProgressSchema,
  getStreamingUrlSchema,
  type ListUserLibraryInput,
  listUserLibrarySchema,
  type SavePlaybackProgressInput,
  savePlaybackProgressSchema,
} from '@codex/validation';
export type {
  ContentAccessEnv,
  ContentAccessServiceConfig,
} from './services/ContentAccessService';
export {
  ContentAccessService,
  createContentAccessService,
} from './services/ContentAccessService';
