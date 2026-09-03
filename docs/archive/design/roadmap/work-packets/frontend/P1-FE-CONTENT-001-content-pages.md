# P1-FE-CONTENT-001: Content Pages

**Priority**: P1
**Status**: 🚧 Not Started
**Estimated Effort**: 5-7 days
**Beads Task**: Codex-vw8.4

---

## Table of Contents

- [Overview](#overview)
- [System Context](#system-context)
- [Content Detail Page](#content-detail-page)
- [Video Player Components](#video-player-components)
- [Access States](#access-states)
- [Progress Tracking](#progress-tracking)
- [Remote Functions](#remote-functions)
- [Dependencies](#dependencies)
- [Implementation Checklist](#implementation-checklist)
- [Testing Strategy](#testing-strategy)

---

## Overview

This work packet implements the content consumption experience - the content detail page with adaptive video player based on user access. The page displays content metadata, creator information, and either a preview player (for non-purchasers) or full player (for owners).

Key features:
- **Adaptive player**: Preview mode (30s clip + CTA) vs full player
- **HLS.js streaming**: Adaptive bitrate playback from R2
- **Media Chrome**: Accessible, customizable player controls
- **Progress tracking**: Resume playback where user left off
- **SEO optimization**: Pre-rendered metadata for crawlers

---

## System Context

### Upstream Dependencies

| System | What We Consume |
|--------|-----------------|
| **Content-API** (port 4001) | Content metadata, streaming URLs |
| **Access-API** (port 4001) | Access check, progress tracking |
| **Transcoding pipeline** | HLS video files in R2 |
| **P1-FE-FOUNDATION-001** | Project setup, hooks, API client |
| **P1-FE-FOUNDATION-002** | Card, Button, Badge, Skeleton |

### Downstream Consumers

| System | What We Provide |
|--------|-----------------|
| **P1-FE-ECOM-001** | Purchase CTA on preview page |
| **P1-FE-ACCESS-001** | Content card component |

### Data Flow

```
User visits /content/{slug}
    │
    ▼
+page.server.ts → fetch content metadata
    │
    ▼
Check access (authenticated? owned? free?)
    │
    ├─── No access → PreviewPlayer + PurchaseCTA
    │                  │
    │                  └── 30s preview clip URL
    │
    └─── Has access → VideoPlayer + ProgressTracker
                       │
                       ├── Full HLS stream URL (signed)
                       └── Resume position from progress API
```

---

## Content Detail Page

### Route Structure

```
src/routes/(org)/[slug]/(space)/content/[contentSlug]/
├── +page.svelte           # Main content page
├── +page.server.ts        # Server load function
└── content.remote.ts      # Remote functions (progress, likes)
```

### +page.server.ts

```typescript
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { createServerApi, ApiError } from '$lib/server/api';

export const load: PageServerLoad = async ({ params, locals, platform, setHeaders }) => {
  const { slug, contentSlug } = params;
  const api = createServerApi(platform);
  const sessionCookie = locals.session?.id;

  try {
    // Fetch content metadata
    const content = await api.fetch<ContentData>(
      'content',
      `/api/organizations/${slug}/content/${contentSlug}`
    );

    if (!content) {
      error(404, 'Content not found');
    }

    // Check access if authenticated
    let access = { hasAccess: false, progress: null as ProgressData | null };

    if (locals.userId) {
      try {
        access = await api.fetch<AccessData>(
          'access',
          `/api/access/content/${content.id}/check`,
          sessionCookie
        );
      } catch (e) {
        // Access check failed - treat as no access
        console.warn('Access check failed:', e);
      }
    } else if (content.price === 0) {
      // Free content - accessible to all authenticated users
      // But user is not authenticated, so show preview
      access.hasAccess = false;
    }

    // Get streaming URL if has access
    let streamUrl: string | null = null;
    if (access.hasAccess && content.videoId) {
      const stream = await api.fetch<{ url: string }>(
        'access',
        `/api/access/stream/${content.id}`,
        sessionCookie
      );
      streamUrl = stream.url;
    }

    // Cache public content metadata
    if (!locals.userId) {
      setHeaders({
        'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=60',
        'Vary': 'Accept-Language'
      });
    }

    return {
      content,
      hasAccess: access.hasAccess,
      progress: access.progress,
      streamUrl,
      previewUrl: content.previewUrl,
      organization: { slug }
    };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      error(404, 'Content not found');
    }
    throw e;
  }
};

interface ContentData {
  id: string;
  slug: string;
  title: string;
  description: string;
  type: 'video' | 'written';
  price: number;
  currency: string;
  duration: number; // seconds
  thumbnailUrl: string;
  previewUrl: string | null;
  videoId: string | null;
  creator: {
    id: string;
    name: string;
    username: string;
    avatarUrl: string | null;
  };
  publishedAt: string;
  viewCount: number;
}

interface AccessData {
  hasAccess: boolean;
  progress: ProgressData | null;
}

interface ProgressData {
  position: number; // seconds
  percentage: number;
  completed: boolean;
  lastWatched: string;
}
```

### +page.svelte

```svelte
<script lang="ts">
  import { VideoPlayer } from '$lib/components/player/VideoPlayer.svelte';
  import { PreviewPlayer } from '$lib/components/player/PreviewPlayer.svelte';
  import { PurchaseCTA } from '$lib/components/commerce/PurchaseCTA.svelte';
  import { ContentMeta } from '$lib/components/content/ContentMeta.svelte';
  import { CreatorCard } from '$lib/components/content/CreatorCard.svelte';
  import * as m from '$paraglide/messages';

  let { data } = $props();
  const { content, hasAccess, progress, streamUrl, previewUrl, organization } = data;
</script>

<svelte:head>
  <title>{content.title} | {organization.slug}</title>
  <meta name="description" content={content.description?.slice(0, 160)} />
  <meta property="og:title" content={content.title} />
  <meta property="og:description" content={content.description?.slice(0, 160)} />
  <meta property="og:image" content={content.thumbnailUrl} />
  <meta property="og:type" content="video.other" />
</svelte:head>

<div class="content-page">
  <div class="player-section">
    {#if hasAccess && streamUrl}
      <VideoPlayer
        src={streamUrl}
        title={content.title}
        poster={content.thumbnailUrl}
        startPosition={progress?.position ?? 0}
        contentId={content.id}
      />
    {:else if previewUrl}
      <PreviewPlayer
        src={previewUrl}
        poster={content.thumbnailUrl}
        duration={30}
        {content}
      />
    {:else}
      <!-- No preview available - show poster with CTA -->
      <div class="poster-only">
        <img src={content.thumbnailUrl} alt={content.title} />
        <PurchaseCTA {content} />
      </div>
    {/if}
  </div>

  <div class="content-details">
    <div class="main-content">
      <ContentMeta {content} />

      <div class="description">
        <h2>{m.content_about_title()}</h2>
        <p>{content.description}</p>
      </div>
    </div>

    <aside class="sidebar">
      <CreatorCard creator={content.creator} />

      {#if !hasAccess}
        <PurchaseCTA {content} />
      {/if}
    </aside>
  </div>
</div>

<style>
  .content-page {
    max-width: 1200px;
    margin: 0 auto;
    padding: var(--space-4);
  }

  .player-section {
    width: 100%;
    aspect-ratio: 16 / 9;
    background: var(--color-neutral-900);
    border-radius: var(--radius-lg);
    overflow: hidden;
    margin-bottom: var(--space-6);
  }

  .content-details {
    display: grid;
    grid-template-columns: 1fr 320px;
    gap: var(--space-6);
  }

  @media (max-width: 768px) {
    .content-details {
      grid-template-columns: 1fr;
    }
  }

  .description h2 {
    font-size: var(--text-lg);
    margin-bottom: var(--space-3);
  }

  .description p {
    color: var(--color-text-secondary);
    line-height: var(--leading-relaxed);
  }

  .sidebar {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .poster-only {
    position: relative;
    width: 100%;
    height: 100%;
  }

  .poster-only img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
</style>
```

---

## Video Player Components

### VideoPlayer.svelte (Full Access)

```svelte
<!-- src/lib/components/player/VideoPlayer.svelte -->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import Hls from 'hls.js';
  import { updateProgress } from './player.remote';

  interface Props {
    src: string;
    title: string;
    poster?: string;
    startPosition?: number;
    contentId: string;
  }

  let {
    src,
    title,
    poster,
    startPosition = 0,
    contentId
  }: Props = $props();

  let videoElement: HTMLVideoElement;
  let hls: Hls | null = null;
  let currentTime = $state(0);
  let duration = $state(0);
  let isPlaying = $state(false);

  // Progress saving interval
  let progressInterval: ReturnType<typeof setInterval>;
  const SAVE_INTERVAL = 10000; // 10 seconds

  onMount(() => {
    if (Hls.isSupported()) {
      hls = new Hls({
        startLevel: -1, // Auto quality
        capLevelToPlayerSize: true
      });

      hls.loadSource(src);
      hls.attachMedia(videoElement);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (startPosition > 0) {
          videoElement.currentTime = startPosition;
        }
      });

      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          console.error('HLS fatal error:', data);
          // Could show error UI here
        }
      });
    } else if (videoElement.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari native HLS
      videoElement.src = src;
      videoElement.addEventListener('loadedmetadata', () => {
        if (startPosition > 0) {
          videoElement.currentTime = startPosition;
        }
      });
    }

    // Progress saving
    progressInterval = setInterval(saveProgress, SAVE_INTERVAL);
  });

  onDestroy(() => {
    clearInterval(progressInterval);
    saveProgress(); // Save on unmount
    hls?.destroy();
  });

  async function saveProgress() {
    if (currentTime > 0 && duration > 0) {
      try {
        await updateProgress({
          contentId,
          position: Math.floor(currentTime),
          percentage: Math.floor((currentTime / duration) * 100),
          completed: currentTime >= duration * 0.95
        });
      } catch (e) {
        console.warn('Failed to save progress:', e);
      }
    }
  }

  function handleTimeUpdate() {
    currentTime = videoElement.currentTime;
    duration = videoElement.duration || 0;
  }

  function handlePlay() {
    isPlaying = true;
  }

  function handlePause() {
    isPlaying = false;
    saveProgress();
  }

  function handleEnded() {
    isPlaying = false;
    saveProgress();
  }
</script>

<media-controller class="video-player">
  <video
    bind:this={videoElement}
    slot="media"
    {poster}
    playsinline
    ontimeupdate={handleTimeUpdate}
    onplay={handlePlay}
    onpause={handlePause}
    onended={handleEnded}
  >
    <track kind="captions" label="English" srclang="en" />
  </video>

  <media-control-bar>
    <media-play-button></media-play-button>
    <media-mute-button></media-mute-button>
    <media-volume-range></media-volume-range>
    <media-time-display showduration></media-time-display>
    <media-time-range></media-time-range>
    <media-playback-rate-button></media-playback-rate-button>
    <media-captions-button></media-captions-button>
    <media-pip-button></media-pip-button>
    <media-fullscreen-button></media-fullscreen-button>
  </media-control-bar>
</media-controller>

<style>
  @import 'media-chrome';

  .video-player {
    width: 100%;
    height: 100%;
    --media-background-color: var(--color-neutral-900);
    --media-control-background: rgba(0, 0, 0, 0.7);
    --media-primary-color: var(--color-primary-500);
    --media-secondary-color: var(--color-neutral-300);
  }

  video {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
</style>
```

### PreviewPlayer.svelte (No Access)

```svelte
<!-- src/lib/components/player/PreviewPlayer.svelte -->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import Hls from 'hls.js';
  import { PurchaseCTA } from '$lib/components/commerce/PurchaseCTA.svelte';
  import * as m from '$paraglide/messages';

  interface Props {
    src: string;
    poster: string;
    duration: number;
    content: {
      id: string;
      title: string;
      price: number;
      currency: string;
    };
  }

  let { src, poster, duration, content }: Props = $props();

  let videoElement: HTMLVideoElement;
  let hls: Hls | null = null;
  let currentTime = $state(0);
  let showOverlay = $state(false);

  onMount(() => {
    if (Hls.isSupported()) {
      hls = new Hls();
      hls.loadSource(src);
      hls.attachMedia(videoElement);
    } else if (videoElement.canPlayType('application/vnd.apple.mpegurl')) {
      videoElement.src = src;
    }
  });

  onDestroy(() => {
    hls?.destroy();
  });

  function handleTimeUpdate() {
    currentTime = videoElement.currentTime;

    // Show overlay when preview ends
    if (currentTime >= duration) {
      videoElement.pause();
      showOverlay = true;
    }
  }

  function handlePlay() {
    showOverlay = false;
  }
</script>

<div class="preview-player">
  <video
    bind:this={videoElement}
    {poster}
    playsinline
    controls
    ontimeupdate={handleTimeUpdate}
    onplay={handlePlay}
  ></video>

  <!-- Progress bar showing preview limit -->
  <div class="preview-progress">
    <div
      class="preview-progress-bar"
      style:width="{Math.min((currentTime / duration) * 100, 100)}%"
    ></div>
    <span class="preview-label">{m.player_preview_label()}</span>
  </div>

  {#if showOverlay}
    <div class="preview-overlay">
      <div class="overlay-content">
        <h3>{m.player_preview_ended()}</h3>
        <p>{m.player_preview_cta()}</p>
        <PurchaseCTA {content} variant="prominent" />
      </div>
    </div>
  {/if}
</div>

<style>
  .preview-player {
    position: relative;
    width: 100%;
    height: 100%;
  }

  video {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .preview-progress {
    position: absolute;
    bottom: 60px;
    left: 0;
    right: 0;
    height: 4px;
    background: rgba(0, 0, 0, 0.5);
  }

  .preview-progress-bar {
    height: 100%;
    background: var(--color-primary-500);
    transition: width 0.1s linear;
  }

  .preview-label {
    position: absolute;
    right: var(--space-2);
    bottom: 8px;
    font-size: var(--text-xs);
    color: white;
    background: rgba(0, 0, 0, 0.7);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
  }

  .preview-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.9);
    display: flex;
    align-items: center;
    justify-content: center;
    animation: fadeIn var(--duration-normal) var(--ease-out);
  }

  .overlay-content {
    text-align: center;
    color: white;
    padding: var(--space-8);
  }

  .overlay-content h3 {
    font-size: var(--text-2xl);
    margin-bottom: var(--space-2);
  }

  .overlay-content p {
    margin-bottom: var(--space-4);
    color: var(--color-neutral-300);
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
</style>
```

---

## Progress Tracking

### Remote Functions

```typescript
// src/lib/components/player/player.remote.ts
import { command } from '$app/server';
import * as v from 'valibot';
import { createServerApi } from '$lib/server/api';

const progressSchema = v.object({
  contentId: v.string(),
  position: v.number(),
  percentage: v.number(),
  completed: v.boolean()
});

export const updateProgress = command(
  progressSchema,
  async (data, { platform, cookies }) => {
    const api = createServerApi(platform);
    const sessionCookie = cookies.get('codex-session');

    if (!sessionCookie) {
      throw new Error('Not authenticated');
    }

    await api.fetch(
      'access',
      `/api/access/progress`,
      sessionCookie,
      {
        method: 'POST',
        body: JSON.stringify(data)
      }
    );
  }
);
```

---

## Access States

### State Machine

```
┌─────────────────────────────────────────────────────────────────┐
│                    Content Access States                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Unauthenticated User                                          │
│   ├── Free content → Preview + "Sign in to watch"               │
│   └── Paid content → Preview + "Sign in to purchase"            │
│                                                                 │
│   Authenticated User                                            │
│   ├── Free content → Full player                                │
│   ├── Paid, purchased → Full player + resume                    │
│   └── Paid, not purchased → Preview + Purchase CTA              │
│                                                                 │
│   Creator/Admin                                                 │
│   └── All content → Full player (implicit access)               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Component Selection Logic

```typescript
// Determine which player to show
function getPlayerType(
  content: ContentData,
  hasAccess: boolean,
  isAuthenticated: boolean
): 'full' | 'preview' | 'poster' {
  // Has access → full player
  if (hasAccess) return 'full';

  // Has preview clip → preview player
  if (content.previewUrl) return 'preview';

  // No preview → poster with CTA only
  return 'poster';
}
```

---

## i18n Messages

```json
{
  "content_about_title": "About this content",
  "content_duration": "{minutes} min",
  "content_views": "{count} views",
  "content_published": "Published {date}",

  "player_preview_label": "Preview",
  "player_preview_ended": "Preview ended",
  "player_preview_cta": "Get full access to continue watching",
  "player_resume": "Resume from {time}",
  "player_watch_again": "Watch again",

  "purchase_price": "{price}",
  "purchase_buy_now": "Buy Now",
  "purchase_free": "Free",
  "purchase_owned": "You own this"
}
```

---

## Dependencies

### Required

| Dependency | Status | Description |
|------------|--------|-------------|
| P1-FE-FOUNDATION-001 | ✅ | Project setup |
| P1-FE-FOUNDATION-002 | ✅ | UI components |
| Content-API | ✅ | Content metadata |
| Access-API | ✅ | Access check, progress |
| Transcoding pipeline | ✅ | HLS video delivery |

### Package Dependencies

```json
{
  "dependencies": {
    "hls.js": "^1.5.0",
    "media-chrome": "^3.0.0"
  }
}
```

---

## Implementation Checklist

- [ ] **Route Setup**
  - [ ] Create (org)/[slug]/(space)/content/[contentSlug] route
  - [ ] Implement +page.server.ts with access checking
  - [ ] Add SEO meta tags

- [ ] **Video Player**
  - [ ] Create VideoPlayer component with HLS.js
  - [ ] Integrate Media Chrome for controls
  - [ ] Implement resume position
  - [ ] Add progress saving

- [ ] **Preview Player**
  - [ ] Create PreviewPlayer component
  - [ ] Add preview time limit
  - [ ] Show purchase CTA overlay

- [ ] **Supporting Components**
  - [ ] ContentMeta (title, duration, views)
  - [ ] CreatorCard (avatar, name, link)
  - [ ] PurchaseCTA (price, button)

- [ ] **Remote Functions**
  - [ ] updateProgress command
  - [ ] addLike command (optional)

- [ ] **Edge Caching**
  - [ ] Cache public content metadata
  - [ ] Hydrate access state client-side

- [ ] **Testing**
  - [ ] Unit tests for player logic
  - [ ] E2E tests for playback
  - [ ] Visual tests for player states

---

## Testing Strategy

### Unit Tests

```typescript
describe('VideoPlayer', () => {
  it('initializes HLS.js on mount');
  it('resumes from saved position');
  it('saves progress periodically');
  it('handles HLS errors gracefully');
});

describe('PreviewPlayer', () => {
  it('stops at preview duration');
  it('shows overlay when preview ends');
});
```

### Integration Tests

```typescript
describe('Content Page', () => {
  it('shows full player when user has access');
  it('shows preview player when user lacks access');
  it('shows purchase CTA for unauthenticated users');
  it('tracks progress for authenticated users');
});
```

### E2E Tests

```typescript
test('video playback flow', async ({ page }) => {
  await page.goto('/content/intro-video');
  await page.click('button[aria-label="Play"]');
  await page.waitForTimeout(5000);
  // Verify progress was saved
});
```

---

## Notes

### Performance Considerations

1. **Lazy load HLS.js**: Only load when video is visible
2. **Adaptive bitrate**: Let HLS.js auto-select quality
3. **Poster images**: Show immediately while player loads
4. **Edge caching**: Cache public content metadata

### Security Considerations

1. **Signed streaming URLs**: Time-limited, single-use tokens
2. **Access validation**: Server-side check before providing stream URL
3. **Progress API**: Only accept updates for owned content

### Future Enhancements

- Quality selector UI
- Keyboard shortcuts
- Picture-in-picture
- Closed captions
- Playback speed presets

---

**Last Updated**: 2026-01-12
**Template Version**: 1.0
