# Content Access - Phase 1 TDD (Technical Design Document)

## System Overview

The Content Access system provides secure, authenticated access to purchased media content (video and audio) via a customer library and dedicated media players. It leverages server-side access control, signed R2 URLs for media streaming, and client-side playback progress tracking.

**Key Architecture Decisions**:
- **Server-Side Access Control**: All access checks are performed on the server before rendering content pages or generating media URLs.
- **Signed R2 URLs**: Media content is served from Cloudflare R2 using short-lived, signed URLs to prevent unauthorized direct access and hotlinking.
- **Unified Media Player**: A single Svelte component will handle both video and audio playback, adapting based on content type.
- **Playback Progress Tracking**: User progress is saved to the database to enable seamless resume functionality.

**Architecture Diagram**: See [Content Access Architecture](../_assets/content-access-architecture.png) (Placeholder for future diagram)

---

## Dependencies

### Must Be Completed First

1.  **Auth System** ([Auth TDD](../auth/ttd-dphase-1.md)):
    - `requireAuth()` guard for all protected routes.
    - User authentication and session management.
2.  **E-Commerce System** ([E-Commerce TDD](../e-commerce/ttd-dphase-1.md)):
    - `purchases` table as the source of truth for completed transactions.
    - The `purchases` table now uses `itemId` and `itemType` for polymorphic relationships.
3.  **Content Management System** ([Content Management TDD](../content-management/ttd-dphase-1.md)):
    - `content` table for content metadata (title, description, thumbnail).
    - `media_items` table for media file details (HLS master playlist keys, waveform keys).
4.  **Media Transcoding System** ([Media Transcoding TDD](../media-transcoding/ttd-dphase-1.md)):
    - Provides HLS master playlists for both video and audio.
    - Provides waveform JSON for audio.
5.  **R2 Bucket Structure** ([Infrastructure - R2 Bucket Structure](../../infrastructure/R2BucketStructure.md)):
    - Defines bucket naming conventions and file keys for media and assets.

### Can Be Developed In Parallel
- Admin Dashboard (displays content access analytics)

---

## Component List

### 1. Content Access Service (`packages/web/src/lib/server/content-access/service.ts`)

**Responsibility**: Centralized business logic for checking user access to content and generating secure media URLs.

**Interface**:
```typescript
export interface IContentAccessService {
  /**
   * Checks if a user has valid, non-refunded access to a specific item.
   * @param userId The ID of the user.
   * @param itemId The ID of the item (content, offering, etc.).
   * @param itemType The type of the item (e.g., 'content', 'offering').
   * @returns True if access is granted, false otherwise.
   */
  checkAccess(userId: string, itemId: string, itemType: string): Promise<boolean>;

  /**
   * Generates a short-lived, signed URL for streaming media from R2.
   * @param userId The ID of the user (for access validation).
   * @param mediaItemId The ID of the media item.
   * @returns A signed URL for the HLS master playlist (video/audio) or throws if access denied.
   */
  getSignedMediaStreamUrl(userId: string, mediaItemId: string): Promise<string>;

  /**
   * Saves or updates a user's playback progress for a media item.
   * @param userId The ID of the user.
   * @param mediaItemId The ID of the media item.
   * @param positionSeconds The current playback position in seconds.
   * @param durationSeconds The total duration of the media item in seconds.
   */
  savePlaybackProgress(userId: string, mediaItemId: string, positionSeconds: number, durationSeconds: number): Promise<void>;

  /**
   * Retrieves a user's last saved playback progress for a media item.
   * @param userId The ID of the user.
   * @param mediaItemId The ID of the media item.
   * @returns The last saved position in seconds, or 0 if no progress found.
   */
  getPlaybackProgress(userId: string, mediaItemId: string): Promise<number>;
}
```

**Implementation Notes**:
- `checkAccess` will query the `purchases` table (or a future `content_access` table) for a `status = 'completed'` and `refundedAt IS NULL` record matching `userId`, `itemId`, and `itemType`.
- `getSignedMediaStreamUrl` will first call `checkAccess`, then retrieve the `hlsMasterPlaylistKey` from `media_items`, and finally use the `R2Service` to generate the signed URL.
- `savePlaybackProgress` and `getPlaybackProgress` will interact with the `video_playback` table.

### 2. R2 Service (`packages/web/src/lib/server/r2/service.ts`)

**Responsibility**: Interact with Cloudflare R2 for file storage and signed URL generation.

**Note**: This service is already defined in [Content Management TDD](../content-management/ttd-dphase-1.md) and will be reused here. It provides `getDownloadUrl` which can be adapted for streaming.

### 3. Customer Library Page (`src/routes/library/+page.svelte` and `+page.server.ts`)

**Responsibility**: Display all purchased content to the user.

**`+page.server.ts` (Load Function)**:
- Requires authentication using `requireAuth()`.
- Fetches all `purchases` records for the logged-in user where `status = 'completed'` and `refundedAt IS NULL`.
- Joins with the `content` table to retrieve content metadata (title, thumbnail, description).
- Passes the list of purchased content to the Svelte component.

**`+page.svelte` (Frontend Component)**:
- Renders a grid/list of `ContentCard` components.
- Implements a basic search filter by content title.
- Navigates to `/content/[id]` when a content card is clicked.

### 4. Content Player Page (`src/routes/content/[id]/+page.svelte` and `+page.server.ts`)

**Responsibility**: Securely display the media player for a specific content item.

**`+page.server.ts` (Load Function)**:
- Requires authentication using `requireAuth()`.
- Extracts `id` (which is `itemId`) from `params`.
- Calls `contentAccessService.checkAccess(userId, itemId, 'content')`.
- If `checkAccess` returns `false`, throws a redirect to `/purchase/[id]` (or a generic access denied page).
- Fetches `content` metadata and associated `media_items` details.
- Calls `contentAccessService.getPlaybackProgress(userId, mediaItemId)` to retrieve last saved position.
- Passes all necessary data (content, media item, initial playback position) to the Svelte component.

**`+page.svelte` (Frontend Component)**:
- Receives content data, media item data, and initial playback position from `load` function.
- Renders the `MediaPlayer` component, passing it the media item details and initial position.

### 5. Media Player Component (`src/lib/components/MediaPlayer.svelte`)

**Responsibility**: A reusable Svelte component that renders either a video or audio player based on the `media_item.type`.

**Implementation Notes**:
- **Video Playback**: Integrates the Mux Web Component Player (or similar HLS-compatible player).
- **Audio Playback**: Uses a custom HTML5 audio player or a dedicated HLS audio player library.
- **Signed URL Handling**: The player will receive a signed HLS master playlist URL. It should not expose this URL.
- **Playback Progress**: On `timeupdate` events (e.g., every 15 seconds), dispatches an event or calls an API to `savePlaybackProgress`.
- **Quality Selection**: For video, allows users to select HLS quality variants.

### 6. API Route: Get Media Stream URL (`src/routes/api/media/[id]/stream-url/+server.ts`)

**Responsibility**: Generates and returns a short-lived signed URL for the HLS master playlist.

**`+server.ts` (GET Handler)**:
- Requires authentication using `requireAuth()`.
- Extracts `id` (which is `mediaItemId`) from `params`.
- Calls `contentAccessService.getSignedMediaStreamUrl(userId, mediaItemId)`.
- Returns the signed URL as JSON.

### 7. API Route: Save Playback Progress (`src/routes/api/playback/progress/+server.ts`)

**Responsibility**: Receives and saves the user's current playback position.

**`+server.ts` (POST Handler)**:
- Requires authentication using `requireAuth()`.
- Receives `mediaItemId`, `positionSeconds`, `durationSeconds` from request body.
- Calls `contentAccessService.savePlaybackProgress(userId, mediaItemId, positionSeconds, durationSeconds)`.
- Returns a success response.

---

## Data Models / Schema

### 1. `video_playback` Table

**Purpose**: Stores the last known playback position for a user on a specific media item.

```typescript
import { pgTable, uuid, integer, timestamp } from 'drizzle-orm/pg-core';
import { users } from './auth';
import { mediaItems } from './media';

export const videoPlayback = pgTable('video_playback', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  mediaItemId: uuid('media_item_id').references(() => mediaItems.id).notNull(),

  positionSeconds: integer('position_seconds').notNull().default(0),
  durationSeconds: integer('duration_seconds').notNull(), // Total duration of the media
  completed: boolean('completed').notNull().default(false), // True if watched >= 95%

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
});

// Unique constraint to ensure one playback record per user per media item
export const videoPlaybackUnique = unique('user_media_unique').on(videoPlayback.userId, videoPlayback.mediaItemId);
```

### 2. Existing Tables (Read-Only Interaction)
- `users` (for `userId`)
- `content` (for content metadata)
- `media_items` (for media details, HLS keys, waveform keys)
- `purchases` (for access verification)

---

## Access Control Flow (Detailed)

1.  **User Request**: Customer navigates to `/content/[contentId]`.
2.  **Server-Side Load (`+page.server.ts`)**:
    a.  `requireAuth(event)`: Ensures user is logged in. If not, redirects to login.
    b.  `contentAccessService.checkAccess(event.locals.user.id, contentId, 'content')`:
        i.  Queries `purchases` table: `SELECT * FROM purchases WHERE customerId = userId AND itemId = contentId AND itemType = 'content' AND status = 'completed' AND refundedAt IS NULL;`
        ii. Returns `true` if a valid purchase exists, `false` otherwise.
    c.  **Access Denied**: If `checkAccess` returns `false`, `throw redirect(303, `/purchase/${contentId}`);`.
    d.  **Access Granted**: If `checkAccess` returns `true`:
        i.  Fetches `content` and associated `media_items` data.
        ii. Fetches `initialPlaybackPosition = contentAccessService.getPlaybackProgress(userId, mediaItemId)`.
        iii. Returns `{ content, mediaItem, initialPlaybackPosition }` to the client.
3.  **Client-Side Render (`+page.svelte`)**:
    a.  Renders `MediaPlayer` component with `mediaItem` and `initialPlaybackPosition`.
4.  **Media Player Initialization (`MediaPlayer.svelte`)**:
    a.  On mount, the player requests the actual stream URL from the backend.
    b.  `fetch('/api/media/${mediaItem.id}/stream-url')`.
5.  **API Route: Get Media Stream URL (`src/routes/api/media/[id]/stream-url/+server.ts`)**:
    a.  `requireAuth(event)`.
    b.  `contentAccessService.checkAccess(event.locals.user.id, mediaItemId, mediaItem.type)`: Re-validates access for the specific media item.
    c.  Retrieves `hlsMasterPlaylistKey` from `media_items` table.
    d.  `signedUrl = r2Service.getDownloadUrl(mediaItem.bucketName, hlsMasterPlaylistKey, 3600)` (expires in 1 hour).
    e.  Returns `{ streamUrl: signedUrl }`.
6.  **Media Playback**: Player receives `streamUrl` and begins HLS streaming.

---

## Resume Playback Flow (Detailed)

1.  **Player Event**: `MediaPlayer.svelte` listens for `timeupdate` events (e.g., every 15 seconds).
2.  **Client-Side API Call**: Dispatches `fetch('/api/playback/progress', { method: 'POST', body: { mediaItemId, positionSeconds, durationSeconds } })`.
3.  **API Route: Save Playback Progress (`src/routes/api/playback/progress/+server.ts`)**:
    a.  `requireAuth(event)`.
    b.  `contentAccessService.savePlaybackProgress(event.locals.user.id, mediaItemId, positionSeconds, durationSeconds)`:
        i.  Upserts (inserts or updates) a record in the `video_playback` table.
        ii. Sets `completed = true` if `positionSeconds` is >= 95% of `durationSeconds`.
    c.  Returns success.
4.  **Page Load**: When `/content/[id]` loads, `+page.server.ts` fetches `contentAccessService.getPlaybackProgress(userId, mediaItemId)` and passes it to the player.

---

## Testing Strategy

-   **Unit Tests**: For `ContentAccessService` (mocking database and R2 interactions).
-   **Integration Tests**: For API routes (`/api/media/[id]/stream-url`, `/api/playback/progress`).
-   **E2E Tests**: For full user flows (login -> purchase -> library -> play content -> resume playback).

---

## Related Documents

-   **PRD**: [Content Access PRD](./pdr-phase-1.md)
-   **Cross-Feature Dependencies**:
    -   [Auth TDD](../auth/ttd-dphase-1.md)
    -   [E-Commerce TDD](../e-commerce/ttd-dphase-1.md)
    -   [Content Management TDD](../content-management/ttd-dphase-1.md)
    -   [Media Transcoding TDD](../media-transcoding/ttd-dphase-1.md)
-   **Infrastructure**:
    -   [R2 Bucket Structure](../../infrastructure/R2BucketStructure.md)
    -   [Database Schema](../../infrastructure/DatabaseSchema.md)

---

**Document Version**: 1.0
**Last Updated**: 2025-10-20
**Status**: Draft - Awaiting Review
