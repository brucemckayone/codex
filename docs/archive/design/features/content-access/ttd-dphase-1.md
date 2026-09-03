# Content Access - Phase 1 TDD (Technical Design Document)

## System Overview

The Content Access system provides secure, authenticated access to purchased media content (video and audio) via a customer library and dedicated media players. It leverages server-side access control, signed R2 URLs for media streaming, and client-side playback progress tracking.

**Key Architecture Decisions**:

- **Server-Side Access Control**: All access checks are performed on the server before rendering content pages or generating media URLs.
- **Signed R2 URLs**: Media content is served from Cloudflare R2 using short-lived, signed URLs to prevent unauthorized direct access and hotlinking.
- **Unified Media Player**: A single Svelte component will handle both video and audio playback, adapting based on content type.
- **Playback Progress Tracking**: User progress is saved to the database to enable seamless resume functionality.

**Architecture Diagram**:

```d2
@import "design/features/content-access/d2-diagrams/content-access-architecture.d2"
```

The diagram shows the secure content access flow including purchase verification, signed R2 URL generation, HLS streaming, and playback progress tracking.

> **Phase 1 Architecture Note**: Phase 1 uses shared R2 buckets with organization-scoped paths (e.g., `{organizationId}/media/{mediaId}/...`) for media storage. All content access is isolated at the organization level, ensuring data security while simplifying infrastructure. Each organization's media content is stored in dedicated paths within shared buckets rather than separate per-organization buckets.

---

## Dependencies

See the centralized [Cross-Feature Dependencies](../../cross-feature-dependencies.md#3-content-access) document for details on dependencies between features.

### Technical Prerequisites

1.  **Auth System**: The `requireAuth()` guard and session management must be implemented.
2.  **E-Commerce System**: The `purchases` table must be available as the source of truth for access rights.
3.  **Content Management System**: The `content` and `media_items` tables are needed for metadata.
4.  **Media Transcoding System**: This feature relies on the HLS and waveform outputs from the transcoding process.
5.  **R2 Bucket Structure**: The bucket naming conventions must be established.

---

## Component List

### 1. Content Access Service (`packages/web/src/lib/server/content-access/service.ts`)

**Responsibility**: Centralized business logic for checking user access to content and generating secure media URLs.

**Interface**:

```typescript
export interface IContentAccessService {
  /**
   * Checks if a user has valid, non-refunded access to a specific item.
   * @param organizationId The ID of the organization (from user context).
   * @param userId The ID of the user.
   * @param itemId The ID of the item (content, offering, etc.).
   * @param itemType The type of the item (e.g., 'content', 'offering').
   * @returns True if access is granted, false otherwise.
   */
  checkAccess(
    organizationId: string,
    userId: string,
    itemId: string,
    itemType: string
  ): Promise<boolean>;

  /**
   * Generates a short-lived, signed URL for streaming media from R2.
   * @param organizationId The ID of the organization (from user context).
   * @param userId The ID of the user (for access validation).
   * @param mediaItemId The ID of the media item.
   * @returns A signed URL for the HLS master playlist (video/audio) or throws if access denied.
   */
  getSignedMediaStreamUrl(
    organizationId: string,
    userId: string,
    mediaItemId: string
  ): Promise<string>;

  /**
   * Saves or updates a user's playback progress for content.
   * @param organizationId The ID of the organization (from user context).
   * @param userId The ID of the user.
   * @param contentId The ID of the content item.
   * @param positionSeconds The current playback position in seconds.
   * @param durationSeconds The total duration of the content in seconds.
   */
  savePlaybackProgress(
    organizationId: string,
    userId: string,
    contentId: string,
    positionSeconds: number,
    durationSeconds: number
  ): Promise<void>;

  /**
   * Retrieves a user's last saved playback progress for content.
   * @param organizationId The ID of the organization (from user context).
   * @param userId The ID of the user.
   * @param contentId The ID of the content item.
   * @returns The last saved position in seconds, or 0 if no progress found.
   */
  getPlaybackProgress(
    organizationId: string,
    userId: string,
    contentId: string
  ): Promise<number>;
}
```

**Implementation Notes**:

- `checkAccess` will query the `purchases` table (or a future `content_access` table) for a `status = 'completed'` and `refundedAt IS NULL` record matching `organizationId`, `userId`, `itemId`, and `itemType`.
- `getSignedMediaStreamUrl` will first call `checkAccess`, then retrieve the `r2Path` for the HLS master playlist from `media_items` (e.g., `{organizationId}/media/{mediaId}/hls/master.m3u8`), and finally use the `R2Service` to generate the signed URL.
- `savePlaybackProgress` and `getPlaybackProgress` will interact with the `video_playback` table, filtering by `organization_id` for data isolation.
- The `organizationId` is provided by the user authentication context (`event.locals.user.organizationId`) after `requireAuth()` is called.

### 2. R2 Service (`packages/web/src/lib/server/r2/service.ts`)

**Responsibility**: Interact with Cloudflare R2 for file storage and signed URL generation.

**Note**: This service is already defined in [Content Management TDD](../content-management/ttd-dphase-1.md) and will be reused here. It provides `getDownloadUrl` which can be adapted for streaming.

### 3. Customer Library Page (`src/routes/library/+page.svelte` and `+page.server.ts`)

**Responsibility**: Display all purchased content to the user.

**`+page.server.ts` (Load Function)**:

- Requires authentication using `requireAuth()`. This provides `organizationId` via `event.locals.user.organizationId`.
- Fetches all `purchases` records for the logged-in user where `organization_id = organizationId`, `status = 'completed'` and `refundedAt IS NULL`.
- Joins with the `content` table to retrieve content metadata (title, thumbnail, description), ensuring content is also filtered by `organization_id`.
- Passes the list of purchased content to the Svelte component.

**`+page.svelte` (Frontend Component)**:

- Renders a grid/list of `ContentCard` components.
- Implements a basic search filter by content title.
- Navigates to `/content/[id]` when a content card is clicked.

### 4. Content Player Page (`src/routes/content/[id]/+page.svelte` and `+page.server.ts`)

**Responsibility**: Securely display the media player for a specific content item.

**`+page.server.ts` (Load Function)**:

- Requires authentication using `requireAuth()`. This provides `organizationId` via `event.locals.user.organizationId`.
- Extracts `id` (which is `contentId`) from `params`.
- Calls `contentAccessService.checkAccess(organizationId, userId, contentId, 'content')`.
- If `checkAccess` returns `false`, throws a redirect to `/purchase/[id]` (or a generic access denied page).
- Fetches `content` metadata and associated `media_items` details (filtered by `organization_id`).
- Calls `contentAccessService.getPlaybackProgress(organizationId, userId, contentId)` to retrieve last saved position.
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

- Requires authentication using `requireAuth()`. This provides `organizationId` via `event.locals.user.organizationId`.
- Extracts `id` (which is `mediaItemId`) from `params`.
- Calls `contentAccessService.getSignedMediaStreamUrl(organizationId, userId, mediaItemId)`.
- Returns the signed URL as JSON.

### 7. API Route: Save Playback Progress (`src/routes/api/playback/progress/+server.ts`)

**Responsibility**: Receives and saves the user's current playback position.

**`+server.ts` (POST Handler)**:

- Requires authentication using `requireAuth()`. This provides `organizationId` via `event.locals.user.organizationId`.
- Receives `contentId`, `positionSeconds`, `durationSeconds` from request body.
- Calls `contentAccessService.savePlaybackProgress(organizationId, userId, contentId, positionSeconds, durationSeconds)`.
- Returns a success response.

---

## Data Models / Schema

### 1. `video_playback` Table

**Purpose**: Stores the last known playback position for a customer on a specific content item within an organization.

```typescript
import { pgTable, uuid, integer, timestamp, boolean } from 'drizzle-orm/pg-core';
import { users } from './auth';
import { content } from './content';
import { organizations } from './organizations';

export const videoPlayback = pgTable('video_playback', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .references(() => organizations.id)
    .notNull(),
  customerId: uuid('customer_id')
    .references(() => users.id)
    .notNull(),
  contentId: uuid('content_id')
    .references(() => content.id)
    .notNull(),

  positionSeconds: integer('position_seconds').notNull().default(0),
  durationSeconds: integer('duration_seconds').notNull(), // Total duration of the media
  completed: boolean('completed').notNull().default(false), // True if watched >= 95%

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Unique constraint to ensure one playback record per user per content item within an organization
export const videoPlaybackUnique = unique('user_content_unique').on(
  videoPlayback.organizationId,
  videoPlayback.customerId,
  videoPlayback.contentId
);
```

### 2. Existing Tables (Read-Only Interaction)

- `users` (for `customerId`)
- `organizations` (for `organizationId`)
- `content` (for content metadata, filtered by `organization_id`)
- `media_items` (for media details, R2 paths including `{organizationId}/media/{mediaId}/...`)
- `purchases` (for access verification, filtered by `organization_id`)

---

## Access Control Flow (Detailed)

1.  **User Request**: Customer navigates to `/content/[contentId]`.
2.  **Server-Side Load (`+page.server.ts`)**:
    a. `requireAuth(event)`: Ensures user is logged in. If not, redirects to login. Provides `organizationId` via `event.locals.user.organizationId`.
    b. `contentAccessService.checkAccess(organizationId, userId, contentId, 'content')`:
    i. Queries `purchases` table: `SELECT * FROM purchases WHERE organization_id = organizationId AND customer_id = userId AND itemId = contentId AND itemType = 'content' AND status = 'completed' AND refundedAt IS NULL;`
    ii. Returns `true` if a valid purchase exists, `false` otherwise.
    c. **Access Denied**: If `checkAccess` returns `false`, `throw redirect(303, `/purchase/${contentId}`);`.
    d. **Access Granted**: If `checkAccess` returns `true`:
    i. Fetches `content` and associated `media_items` data (filtered by `organization_id`).
    ii. Fetches `initialPlaybackPosition = contentAccessService.getPlaybackProgress(organizationId, userId, contentId)`.
    iii. Returns `{ content, mediaItem, initialPlaybackPosition }` to the client.
3.  **Client-Side Render (`+page.svelte`)**:
    a. Renders `MediaPlayer` component with `mediaItem` and `initialPlaybackPosition`.
4.  **Media Player Initialization (`MediaPlayer.svelte`)**:
    a. On mount, the player requests the actual stream URL from the backend.
    b. `fetch('/api/media/${mediaItem.id}/stream-url')`.
5.  **API Route: Get Media Stream URL (`src/routes/api/media/[id]/stream-url/+server.ts`)**:
    a. `requireAuth(event)`. Provides `organizationId` via `event.locals.user.organizationId`.
    b. `contentAccessService.checkAccess(organizationId, userId, contentId, 'content')`: Re-validates access for the specific content.
    c. Retrieves `r2Path` for the HLS master playlist from `media_items` table (e.g., `{organizationId}/media/{mediaId}/hls/master.m3u8`).
    d. `signedUrl = r2Service.getDownloadUrl(sharedBucketName, r2Path, 3600)` (expires in 1 hour).
    e. Returns `{ streamUrl: signedUrl }`.
6.  **Media Playback**: Player receives `streamUrl` and begins HLS streaming.

---

## Resume Playback Flow (Detailed)

1.  **Player Event**: `MediaPlayer.svelte` listens for `timeupdate` events (e.g., every 15 seconds).
2.  **Client-Side API Call**: Dispatches `fetch('/api/playback/progress', { method: 'POST', body: { contentId, positionSeconds, durationSeconds } })`.
3.  **API Route: Save Playback Progress (`src/routes/api/playback/progress/+server.ts`)**:
    a. `requireAuth(event)`. Provides `organizationId` via `event.locals.user.organizationId`.
    b. `contentAccessService.savePlaybackProgress(organizationId, userId, contentId, positionSeconds, durationSeconds)`:
    i. Upserts (inserts or updates) a record in the `video_playback` table, filtering by `organization_id`.
    ii. Sets `completed = true` if `positionSeconds` is >= 95% of `durationSeconds`.
    c. Returns success.
4.  **Page Load**: When `/content/[id]` loads, `+page.server.ts` fetches `contentAccessService.getPlaybackProgress(organizationId, userId, contentId)` and passes it to the player.

---

## Testing Strategy

- **Unit Tests**: For `ContentAccessService` (mocking database and R2 interactions).
- **Integration Tests**: For API routes (`/api/media/[id]/stream-url`, `/api/playback/progress`).
- **E2E Tests**: For full user flows (login -> purchase -> library -> play content -> resume playback).

---

## Related Documents

- **PRD**: [Content Access PRD](./pdr-phase-1.md)
- **Cross-Feature Dependencies**:
  - [Auth TDD](../auth/ttd-dphase-1.md)
  - [E-Commerce TDD](../e-commerce/ttd-dphase-1.md)
  - [Content Management TDD](../content-management/ttd-dphase-1.md)
  - [Media Transcoding TDD](../media-transcoding/ttd-dphase-1.md)
- **Infrastructure**:
  - [R2 Bucket Structure](../../infrastructure/R2BucketStructure.md)
  - [Database Schema](../../infrastructure/DatabaseSchema.md)

---

**Document Version**: 1.0
**Last Updated**: 2025-10-20
**Status**: Draft - Awaiting Review
