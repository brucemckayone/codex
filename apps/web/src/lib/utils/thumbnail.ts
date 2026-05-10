/**
 * Thumbnail resolution helper — single source of truth for which image to
 * show for a given piece of content.
 *
 * Priority ladder:
 *   1. content.thumbnailUrl    — creator-uploaded custom override
 *   2. mediaItem.thumbnailUrl  — auto-generated video poster (only present
 *                                for video; null for audio per schema)
 *   3. null                    — caller is responsible for showing a
 *                                synthetic fallback (waveform animation,
 *                                FilmIcon, FileTextIcon, etc.)
 *
 * Why this lives here, not at the call site:
 *   The same precedence is needed in ContentCard, hero spreads, audio /
 *   video player covers, library tiles, search results, and studio lists.
 *   Inlining `content.thumbnailUrl ?? content.mediaItem?.thumbnailUrl` at
 *   every consumer means the day we add waveform-image fallback for audio,
 *   we have to find every site again. Centralising the rule avoids drift.
 *
 * Note on audio waveforms: the audio waveform image (`waveformImageKey` on
 * the media schema) is currently exposed via the streaming API
 * (`getStreamingUrl().waveformUrl`) for live playback rendering, NOT on the
 * `mediaItem` wire shape. Surfacing it as a static cover-image fallback is
 * tracked as a separate architectural follow-up — see beads issues filed
 * alongside this commit.
 */

interface ThumbnailableContent {
  thumbnailUrl?: string | null;
  contentType?: 'video' | 'audio' | 'written' | string | null;
  mediaItem?: {
    thumbnailUrl?: string | null;
  } | null;
}

export function getDisplayThumbnail(
  content: ThumbnailableContent | null | undefined
): string | null {
  if (!content) return null;
  if (content.thumbnailUrl) return content.thumbnailUrl;
  return content.mediaItem?.thumbnailUrl ?? null;
}
