# Org Studio Media Library — Feature Ideation

**Route**: `{slug}.*/studio/media` → `_org/[slug]/studio/media/+page.svelte`
**Current state**: Basic media item list with upload functionality. Shows processing status.
**Priority**: MEDIUM — core asset management for creators.

---

## Vision

The media library is the **asset manager** — the creator's personal vault of raw materials. It should feel like a professional DAM (Digital Asset Manager) but simplified for non-technical creators. Think Google Drive meets Adobe Lightroom.

---

## Media Grid / List

### Grid View (Visual)
- Thumbnail cards for video/audio/image
- Video: Frame thumbnail, duration badge, resolution badge
- Audio: Waveform visualization, duration badge
- Image: Thumbnail preview
- Status overlay: Processing spinner, Ready checkmark, Failed warning
- Multi-select for bulk operations
- Drag-and-drop upload zone (drop files anywhere on page)

### List View (Detailed)
- Table: Thumbnail (small), Filename, Type, Size, Duration, Status, Used In, Uploaded, Actions
- "Used In" column: Shows content items using this media (click to see list)
- Sortable by any column

### View Toggle
- Grid / List toggle (save preference)
- Size slider: Small / Medium / Large thumbnails in grid view

---

## Upload Experience

### Drag & Drop
- Drop zone appears when dragging files over the page
- "Drop files here to upload" with visual highlight
- Accept multiple files simultaneously
- File type validation before upload (show rejected files with reason)

### Upload Progress
- Per-file progress bar with percentage
- Overall batch progress: "3 of 7 files uploaded"
- Cancel individual uploads
- Estimated time remaining
- "Upload in background" — navigate away while uploads continue
- Upload queue management

### Post-Upload
- Automatically starts transcoding for video/audio
- Processing status: "Transcoding... (2 of 4 quality levels complete)"
- Estimated processing time
- Notification when processing completes (toast or email)

---

## Filters & Search

- Search: filename, tags, description
- Filter by: Type (video/audio/image), Status (processing/ready/failed), Date range, Size range
- Sort: Newest, Oldest, Largest, Smallest, Name A-Z
- "Unused media" filter: Show files not attached to any content (cleanup)

---

## Media Detail View (Modal or Sidebar)

When clicking a media item:

### Video Detail
- Video player preview (full quality)
- Metadata: Filename, size, duration, resolution, format, upload date
- Transcoding status: Show each quality level (1080p, 720p, 480p, 360p) with status
- HLS manifest URL (for admins/developers)
- Preview clip (auto-generated 30s clip)
- Thumbnail: Auto-generated, option to upload custom
- Tags: Add/remove tags for organization
- "Used In" list: Content items using this media with links

### Audio Detail
- Audio player with waveform
- Same metadata as video (minus resolution)
- Transcript (future, auto-generated)

### Image Detail
- Full-resolution preview
- Dimensions, file size, format
- Used as: thumbnail for [content items]

---

## Bulk Operations

- Select multiple items:
  - Delete selected (with "used in content" warning)
  - Tag selected
  - Download selected (as zip)
  - Re-process selected (retry failed transcoding)

---

## Storage Overview

- Storage usage indicator: "Using 14.2 GB of media storage"
- Breakdown by type: Video (12 GB), Audio (1.8 GB), Images (400 MB)
- Largest files list for cleanup
- "Unused files" cleanup wizard

---

## Import from Personal Library (Future, Multi-Creator)

- For creators who are members of multiple orgs
- "Import from Personal Library" button
- Browse personal media → select items to share with this org
- Sharing controls: "This org can use this media in their content"
- Revoke sharing at any time

---

## Data Requirements

| Feature | Data Source | Exists? |
|---------|------------|---------|
| Media list | content API (media items) | Yes |
| Upload (presigned URLs) | content API | Yes |
| Processing status | media/transcoding API | Yes |
| Media detail | content API | Yes |
| Usage tracking | content API (references) | Partial |
| Storage metrics | R2 API / admin API | Needs endpoint |
| Bulk operations | Needs batch endpoints | Needs work |

---

## Priority Ideas (Top 5)

1. **Drag-and-drop upload** with multi-file progress tracking
2. **Grid view with status overlays** (processing spinner, ready check, failed warning)
3. **Media detail sidebar/modal** with player preview and metadata
4. **"Used In" tracking** showing which content uses each media file
5. **Filter by unused media** for library cleanup
