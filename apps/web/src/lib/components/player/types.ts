/**
 * Preview Player Types
 *
 * Type definitions for the preview player component
 * which provides limited access to content before purchase.
 */

/**
 * Preview player access states
 *
 * - loading: Checking user access/preview availability
 * - preview: User can watch the 30-second preview
 * - unlocked: User has purchased the content
 * - locked: User needs to purchase/sign in to watch
 * - error: An error occurred while checking access
 */
export type AccessState =
  | 'loading'
  | 'preview'
  | 'unlocked'
  | 'locked'
  | 'error';

/**
 * Preview limit in seconds
 * Users can watch this many seconds before the preview is locked
 */
export const PREVIEW_LIMIT_SECONDS = 30;

/**
 * Preview player configuration
 */
export interface PreviewPlayerConfig {
  /** Content ID for access checking */
  contentId: string;
  /** Thumbnail image URL */
  thumbnailUrl?: string;
  /** Content title for display */
  title: string;
  /** Preview duration limit (default: 30) */
  previewLimit?: number;
  /** Auto-start playback on mount */
  autoplay?: boolean;
}

/**
 * Preview player state
 */
export interface PreviewPlayerState {
  /** Current access state */
  accessState: AccessState;
  /** Whether preview has ended */
  previewEnded: boolean;
  /** Current playback position */
  currentTime: number;
  /** Video element reference */
  video: HTMLVideoElement | null;
  /** HLS instance (if used) */
  hls: null | {
    destroy: () => void;
  };
}
