# Hero Section Enrichment — Continuation Prompt

Copy everything below into a new Claude Code session to resume work.

---

## Context

We've been enriching the org subdomain hero section. The hero sits over a full-page WebGL shader background (4 presets: suture, ether, warp, ripple) that's managed by `ShaderHero` in the org layout. The goal is a dramatic, data-driven hero that adapts to each org's brand.

## What's Done (Completed Tasks)

### Research & Planning
- Competitive analysis of Kajabi, Uscreen, Netflix, Mighty Networks, etc. hero patterns
- Full token system audit (colors, typography, spacing, materials, breakpoints)
- Plan file at `~/.claude/plans/reactive-conjuring-dusk.md` with 5 work packages

### Backend — Stats Endpoint (WP-1)
- **`packages/shared-types/src/api-responses.ts`** — `OrganizationPublicStatsResponse` with `content.{total,video,audio,written}`, `totalDurationSeconds`, `creators`, `totalViews`, `categories: string[]`
- **`packages/organization/src/services/organization-service.ts`** — `getPublicStats()` method with 4 concurrent queries (content counts via `COUNT FILTER`, duration via `SUM` on media join, creator count, `selectDistinct` categories)
- **`workers/organization-api/src/routes/organizations.ts`** — `GET /public/:slug/stats` route with KV caching
- **`packages/cache/src/cache-keys.ts`** — Added `ORG_STATS: 'org:stats'` (was colliding with `ORG_CONFIG`)
- **`apps/web/src/lib/server/api.ts`** — `api.org.getPublicStats(slug)` client method
- **`apps/web/src/lib/remote/org.remote.ts`** — `getPublicStats()` remote function
- **`apps/web/src/routes/_org/[slug]/(space)/+page.server.ts`** — Fetches stats in `Promise.all` with content

### Frontend — Hero Structure (WP-2)
- **`apps/web/src/routes/_org/[slug]/(space)/+page.svelte`** — Full restructure:
  - **Layout**: Full viewport (100dvh), `flex-direction: column; justify-content: flex-end` (bottom-anchored)
  - **Title**: `<h1>` extracted OUTSIDE `hero__content` div — sits at same z-level as shader canvas. Uses `color: white; mix-blend-mode: difference` which reacts to shader on desktop (not mobile — hardware compositor layer limitation)
  - **Brand gradient overlay**: `hero::after` with `z-index: 0`, uses `color-mix(in srgb, var(--color-brand-primary), black)` — brand-tinted dark gradient covering bottom 70% for text contrast
  - **`hero__content`**: `z-index: 1` (above gradient), contains logo, description, pills, CTAs, stats
  - **Content type pills**: `5 Videos`, `1 Audio` etc. — uppercase, semi-transparent white bg, `--text-xs`
  - **Category pills**: Auto-derived from stats.categories, lowercase, no bg fill, link to `/explore?category={name}`
  - **Dot separator**: Small circle between content type and category pills
  - **Dual CTAs**: Primary (white bg, brand color text) + Glass secondary (transparent white bg, white text)
  - **Auth-aware**: Logged out = "Start Exploring" + "Meet Creators" / Logged in = "Browse Content" + "My Library"
  - **Big stat numbers**: Items, Creators, Hours, Views with border-top separator
  - **i18n**: 15 `org_hero_*` messages in `apps/web/messages/en.json`

### Layout Changes
- **`apps/web/src/routes/_org/[slug]/+layout.svelte`**:
  - `isLanding` derived (`page.url.pathname === '/'`)
  - `org-main--blendable` class drops `view-transition-name` on landing page (was blocking `mix-blend-mode`)
  - ShaderHero now renders outside `{#if !isStudio}` guard (always present, the `isStudio` check moved to SidebarRail only)

### Key Architecture Decisions
- **mix-blend-mode: difference** on title works on desktop only. Mobile GPUs separate `position: fixed` canvas into hardware layers that blend modes can't cross. Graceful degradation: white text on mobile.
- **Title outside hero__content**: Required so it has no `z-index` isolation and can blend with the shader canvas. The gradient overlay (`z-index: 0`) and content (`z-index: 1`) layer correctly around it.
- **Brand gradient overlay**: Uses `--color-brand-primary` mixed with black, not generic black. This tints the gradient to match each org's brand.
- **Cache key separation**: Stats uses `CacheType.ORG_STATS` ('org:stats'), org info uses `CacheType.ORG_CONFIG` ('org:config'). They were colliding before.

## What Needs Attention Next

### Immediate — Design Polish (Codex-x58f)
The hero design needs visual refinement. Current state from user feedback:
- Pills may look cluttered/unclear depending on the shader/brand combination
- Need to verify the gradient overlay + pills + stats render well across different brand colors (test with light brands, dark brands, high-saturation brands)
- The content-area transition (gradient from hero into frosted content below) was tweaked by the user — verify it's smooth

### WP-3: Intro Video Backend (Codex-law5)
**Schema**: Add to `branding_settings` via Drizzle (NOT raw SQL):
```typescript
introVideoMediaItemId: uuid('intro_video_media_item_id').references(() => mediaItems.id, { onDelete: 'set null' }),
introVideoUrl: text('intro_video_url'),
introVideoR2Path: text('intro_video_r2_path'),
```
Generate migration: `pnpm db:generate` then `pnpm db:migrate`

**Transcoding**: Need brand-scoped public R2 paths (`brand/{orgId}/hls/{mediaId}/...`). Current media pipeline is creator-scoped with presigned URLs. Brand assets need public direct URLs (like the logo at `{r2PublicUrlBase}/{r2Path}`).

**Open decision**: Use org owner's userId as creatorId on the media item (pragmatic) vs making creatorId nullable for org-scoped assets (architectural).

**Service methods**: Follow `BrandingSettingsService.uploadLogo()` pattern in `packages/platform-settings/src/services/branding-settings-service.ts`

**API endpoints**: POST/DELETE/GET status at `/organizations/:id/settings/branding/intro-video`

### WP-4: Brand Editor Upload (Codex-2n9d, depends on WP-3)
New `BrandEditorIntroVideo.svelte` following `BrandEditorLogo.svelte` pattern. File picker → presigned URL → R2 → transcode → ready status.

### WP-5: Hero Play Button + Modal (Codex-dw2i, depends on WP-4)
- SVG play button on hero (glass circle, only when introVideoUrl exists)
- Video modal: `backdrop-filter: blur(var(--blur-2xl))` overlay (shader bleeds through)
- CSS mask for feathered edges: `mask-image: radial-gradient(ellipse 90% 90%, black 60%, transparent 100%)`
- Minimal HLS player using existing `createHlsPlayer()` from `$lib/components/VideoPlayer/hls.ts`

## Key Files
```
apps/web/src/routes/_org/[slug]/(space)/+page.svelte      — Hero page (THE main file)
apps/web/src/routes/_org/[slug]/(space)/+page.server.ts    — Server load (stats + content)
apps/web/src/routes/_org/[slug]/+layout.svelte             — Org layout (shader, branding)
apps/web/src/lib/remote/org.remote.ts                      — Remote functions
apps/web/src/lib/server/api.ts                             — API client
apps/web/messages/en.json                                  — i18n messages
packages/shared-types/src/api-responses.ts                 — Response types
packages/organization/src/services/organization-service.ts — Stats service method
packages/cache/src/cache-keys.ts                           — Cache types (ORG_STATS)
packages/database/src/schema/settings.ts                   — Branding schema (WP-3 target)
packages/platform-settings/src/services/branding-settings-service.ts — Upload service (WP-3)
packages/transcoding/src/paths.ts                          — R2 path helpers (WP-3)
~/.claude/plans/reactive-conjuring-dusk.md                 — Full plan
docs/hero-enrichment-verification.md                       — Test checklist
```

## Beads Tasks
```
DONE: Codex-psax  Hero section research & competitive analysis
DONE: Codex-cq6y  Stats endpoint — GET /public/:slug/stats
DONE: Codex-vuwb  Stats cache key collision fix — ORG_STATS
DONE: Codex-6316  Hero editorial layout — bottom-left, full viewport, brand gradient
DONE: Codex-2v2w  mix-blend-mode: difference on title
DONE: Codex-5fvl  Hero pills, categories, auth-aware dual CTAs, stats strip
DONE: Codex-ovq6  Title extracted from hero__content for z-index isolation

TODO: Codex-x58f  Hero design polish — verify across brands
TODO: Codex-law5  WP-3: Intro video backend (schema, transcoding, service, API)
TODO: Codex-2n9d  WP-4: Brand editor intro video upload (depends on WP-3)
TODO: Codex-dw2i  WP-5: Hero play button + video modal (depends on WP-4)
```

## Start the next session with
```
Run `bd ready` to see available tasks. Start with Codex-x58f (design polish) or Codex-law5 (WP-3 intro video backend). Read the plan at ~/.claude/plans/reactive-conjuring-dusk.md for full context.
```
