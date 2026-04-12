# Hero Enrichment — Verification Guide

## WP-1: Stats Endpoint with Categories

### Test the endpoint
```bash
# After restarting pnpm dev:
curl -s http://localhost:42071/api/organizations/public/studio-alpha/stats | python3 -m json.tool
```

**Expected response:**
```json
{
  "data": {
    "content": { "total": 8, "video": 5, "audio": 2, "written": 1 },
    "totalDurationSeconds": 12600,
    "creators": 3,
    "totalViews": 0,
    "categories": ["TypeScript", "Svelte", "Web Development"]
  }
}
```

**If you still get org info data:** The old cache entry hasn't expired. Restart `pnpm dev` to clear Miniflare KV. The fix was changing `CacheType.ORG_CONFIG` to `CacheType.ORG_STATS` in the stats route handler.

### Files changed
- `packages/shared-types/src/api-responses.ts` — added `categories: string[]` to `OrganizationPublicStatsResponse`
- `packages/organization/src/services/organization-service.ts` — added 4th concurrent `selectDistinct` query for categories
- `packages/cache/src/cache-keys.ts` — added `ORG_STATS: 'org:stats'` cache type
- `workers/organization-api/src/routes/organizations.ts` — stats route uses `CacheType.ORG_STATS`

### Rebuild after changes
```bash
pnpm --filter @codex/shared-types build
pnpm --filter @codex/organization build
pnpm --filter @codex/cache build
```

---

## WP-2: Hero Enrichment — Pills, Stats, Categories, CTA

### Visual checks (desktop)
1. Navigate to org landing page (e.g., `studio-alpha.lvh.me:3000`)
2. Verify these elements render in the hero:
   - [ ] Logo (top-left)
   - [ ] Org name (large, `mix-blend-mode: difference` reacting to shader on desktop)
   - [ ] Description text
   - [ ] **Content type pills**: "X Videos", "X Audio", "X Written" (glass style)
   - [ ] **Category pills**: clickable, link to `/explore?category={name}`
   - [ ] **Primary CTA**: solid button ("Start Exploring" logged out / "Browse Content" logged in)
   - [ ] **Secondary CTA**: glass button ("Meet Creators" logged out / "My Library" logged in)
   - [ ] **Stats**: big numbers with border-top separator (Items, Creators, Hours, Views)

### Visual checks (mobile / DevTools responsive)
3. Resize to mobile width (<640px):
   - [ ] CTAs stack vertically, full width
   - [ ] Pills wrap naturally
   - [ ] Stats wrap to multiple rows
   - [ ] Logo shrinks to `--space-11`
   - [ ] Hero min-height drops to 90dvh

### Auth-aware CTA check
4. Log out → verify CTAs say "Start Exploring" + "Meet Creators"
5. Log in → verify CTAs say "Browse Content" + "My Library"

### Category pill links
6. Click a category pill → should navigate to `/explore?category={name}`

### Files changed
- `apps/web/src/routes/_org/[slug]/(space)/+page.svelte` — hero markup (pills, dual CTAs, category links) + styles (glass pills, primary/glass CTA variants)
- `apps/web/src/routes/_org/[slug]/(space)/+page.server.ts` — fetches `getPublicStats(org.slug)` alongside content
- `apps/web/src/lib/remote/org.remote.ts` — `getPublicStats()` remote function
- `apps/web/src/lib/server/api.ts` — `api.org.getPublicStats(slug)` client method
- `apps/web/messages/en.json` — 15 `org_hero_*` i18n messages

---

## Known Issues

### Cache collision (FIXED)
The stats endpoint was returning org info data because both used `CacheType.ORG_CONFIG`. Fixed by adding `CacheType.ORG_STATS`. Requires `pnpm dev` restart to clear Miniflare KV.

### mix-blend-mode on mobile
`mix-blend-mode: difference` on the title works on desktop browsers but NOT on actual mobile devices. The shader canvas uses `position: fixed` which creates a separate hardware compositor layer on mobile GPUs — blend modes can't cross hardware layers. This is a graceful degradation: mobile shows normal `--color-text-on-brand` text.

---

## Remaining Work (Future Sessions)

### WP-3: Intro Video Backend
- Drizzle schema: add `introVideoMediaItemId`, `introVideoUrl`, `introVideoR2Path` to `branding_settings`
- Transcoding pipeline: brand-scoped public R2 paths (`brand/{orgId}/hls/{mediaId}/...`)
- Service methods: `uploadIntroVideo()`, `deleteIntroVideo()`, `getIntroVideoStatus()`
- API endpoints: POST/DELETE/GET status
- Public org info: add `introVideoUrl` to response

### WP-4: Brand Editor — Intro Video Upload
- New `BrandEditorIntroVideo.svelte` (follows `BrandEditorLogo.svelte` pattern)
- Upload flow: file picker -> presigned URL -> R2 upload -> transcode -> ready
- Register in brand editor levels

### WP-5: Hero — Play Button + Video Modal
- SVG play button (glass circle, centered in hero)
- Video modal with `backdrop-filter: blur(60px)` overlay
- CSS mask for blurred video edges: `mask-image: radial-gradient(ellipse ...)`
- Minimal HLS player using existing `createHlsPlayer()`
- Auto-play muted, click to unmute

### Full plan
See `/Users/brucemckay/.claude/plans/reactive-conjuring-dusk.md`
