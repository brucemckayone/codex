# Brand Editor Investigation

**Status**: active (iter-018 kickoff, 2026-04-23 — looped via /design-system cron every 20m)
**Driver**: User report: "font families are not saved — only show while editing, revert on reload"; two light/dark toggles out of sync; some fields don't work
**Scope**: map the full brand pipeline, identify every gap between control → persistence → hydration → CSS consumer, fix the bugs

This doc is the **persistent context store** for the investigation. Each iteration of the /design-system loop reads from here, adds findings, and updates the bead list. Do not duplicate this content elsewhere.

---

## 1. Pipeline (save + read paths)

```
SAVE PATH
  ┌─────────────────────────────────────────────────────────────────────┐
  │ BrandEditor UI controls (apps/web/src/lib/components/brand-editor/) │
  │   Level components → brandEditor.updateField(key, val)              │
  │                      brandEditor.updateTokenOverride(key, val)      │
  └─────────────────────────────────────────────────────────────────────┘
                                │  (immediate, no debounce)
                                ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ brand-editor-store.svelte.ts — state.pending                        │
  │   $effect: injectBrandVars(state.pending) → live CSS preview        │
  │   $effect: sessionStorage persistence                               │
  └─────────────────────────────────────────────────────────────────────┘
                                │  (user clicks Save)
                                ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ BrandEditorMount.svelte:40 handleSave()                             │
  │   payload = brandEditor.getSavePayload()                            │
  │   updateBrandingCommand({ orgId, primary, fonts, ..., heroLayout }) │
  │   NOTE: omits textColorHex/shadowScale/shadowColor/textScale/       │
  │         headingWeight/bodyWeight — those flow via tokenOverrides    │
  └─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ branding.remote.ts:216 updateBrandingCommand                        │
  │   Zod schema validates, api.org.updateBranding(orgId, payload)      │
  │   await invalidateCache(platform, orgId)                            │
  │   getBrandingSettings(orgId).refresh()  (non-critical)              │
  │   MISSING: invalidate('cache:org-versions') to re-run layout load   │
  └─────────────────────────────────────────────────────────────────────┘
                                │  PUT /api/organizations/:id/settings/branding
                                ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ workers/organization-api/src/routes/settings.ts:258                 │
  │   procedure() → ctx.services.settings.updateBranding(body)          │
  │   → branding-settings-service.ts:159 upsert via fieldMap            │
  │                                                                     │
  │   waitUntil(Promise.all([                                           │
  │     updateBrandCache(env, orgId),           // BRAND_KV brand:{slug}│
  │     cache.invalidate(orgId),                // CACHE_KV orgId ver   │
  │     cache.invalidate(slug)  // DB lookup    // CACHE_KV slug ver    │
  │   ]))                                                               │
  │                                                                     │
  │   ⚠ ALL THREE IN waitUntil — fire-and-forget, returns 200 first    │
  └─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
                         PostgreSQL branding_settings
                         (columns: primary_color_hex, font_body, ...,
                          token_overrides jsonb)


READ PATH (on reload)
  ┌─────────────────────────────────────────────────────────────────────┐
  │ apps/web/src/routes/_org/[slug]/+layout.server.ts                   │
  │   api.org.getPublicInfo(slug) → GET /public/:slug/info              │
  │   depends('cache:org-versions')                                     │
  └─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ workers/organization-api/src/routes/organizations.ts:362            │
  │   cache.get(slug, CacheType.ORG_CONFIG, fetchPublicOrgInfo, 30min)  │
  │   ⚠ If slug-keyed CACHE_KV entry is stale, returns pre-save data   │
  └─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ _org/[slug]/+layout.svelte:55, 376-377                              │
  │   brandFontBody = data.org?.brandFonts?.body                        │
  │   style:--brand-font-body="'FontName', var(--font-sans)"            │
  │   Plus read from legacy columns (brandShadowScale, textColor, etc.) │
  │   Plus read from tokenOverrides JSON → injectTokenOverrides(el)     │
  └─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ lib/theme/tokens/org-brand.css (gated by [data-org-brand])          │
  │   --font-body: var(--brand-font-body, var(--font-sans))             │
  │   --font-sans: var(--brand-font-body, 'Inter'), 'Inter-fallback'... │
  │   font-family: var(--font-sans)                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Storage layers

| Layer | Type | Key | Writer | Reader | TTL |
|---|---|---|---|---|---|
| `branding_settings` | Postgres table | `organization_id` PK | `BrandingSettingsService.update` | service `.get()` | — |
| `CACHE_KV` | KV via `VersionedCache` | `slug` (30min TTL) | `cache.invalidate(slug)` in worker waitUntil | `cache.get(slug, ORG_CONFIG, …)` in `public/:slug/info` | 30 min |
| `CACHE_KV` | KV via `VersionedCache` | `orgId` (version only) | `invalidateCache(platform, orgId)` in branding.remote.ts (awaited) + worker waitUntil | `$effect` in org layout reads `data.versions` for staleness | — (version bump) |
| `BRAND_KV` | KV blob | `brand:{slug}` | `updateBrandCache()` in worker waitUntil | **unknown — no known reader found in main app** (see [Codex-fopbo](https://linear / bd id)) | 30 min |
| `sessionStorage` | Browser | `codex-brand-editor-draft` | `brand-editor-store.svelte.ts` `$effect` | same store on mount | session |

---

## 3. Known bugs (iter-018 findings)

| Bead | Priority | Title | Root file(s) |
|---|---|---|---|
| `Codex-ja9zp` | P1 | CACHE_KV slug invalidation race — stale font/color on reload | `workers/organization-api/src/routes/settings.ts:171-203` |
| `Codex-7afgp` | P1 | No client `invalidate('cache:org-versions')` after save — layout doesn't refresh | `apps/web/src/lib/remote/branding.remote.ts:261-267` |
| `Codex-g49b4` | P2 | 6 columns write-orphaned: `textColorHex`, `shadowScale`, `shadowColor`, `textScale`, `headingWeight`, `bodyWeight` | `apps/web/src/lib/components/brand-editor/BrandEditorMount.svelte:49-69` |
| `Codex-mdg94` | P2 | Audit fine-tune panels — confirm values route to `tokenOverrides` | `apps/web/src/lib/components/brand-editor/levels/BrandEditor*FineTune*.svelte` |
| `Codex-fopbo` | P3 | `BRAND_KV` vs `CACHE_KV` — document or consolidate | `workers/organization-api/src/routes/settings.ts:97-164` |
| `Codex-ag8l8` | P3 | Font CSS value format inconsistency (live preview vs SSR) | `apps/web/src/lib/brand-editor/css-injection.ts:349-354` vs `_org/[slug]/+layout.svelte:376` |

Dependency chain: `ja9zp` blocks `7afgp`; `g49b4` blocks `mdg94`.

---

## 4. Investigation queue (iter-019+)

Each bullet is a candidate agent task for a future loop fire. Pick two per iteration to match the 2-concurrent-agent limit.

1. **Light/dark sync between brand editor toggle + org sidebar toggle** (user-reported, highest remaining)
   - Find every writer of `data-theme`, `color-scheme`, `prefers-color-scheme` override. Identify the source of truth. Prove divergence.
   - Expected: editor has a local draft theme state; sidebar mutates a cookie or user preference. Saving doesn't reconcile.

2. **Cross-org brand injection on subdomains**
   - Map how `hooks.server.ts` reroute + `_org/[slug]/+layout.server.ts` resolves per-subdomain branding.
   - Are there parent/child orgs with inherited branding? If not currently, what would it take to add?
   - Does SSR-emitted `--brand-*` match CSR after hydration?

3. **Token coverage audit** — cross-reference `apps/web/src/lib/styles/tokens/*.css` + `lib/theme/tokens/org-brand.css` against editor controls
   - Agent A (iter-018) produced a three-way diff; formalize it as a JSON file at `docs/brand-editor-investigation/token-registry.json` with columns: `defined, editable, persisted, consumed`.
   - Use that JSON to generate a dashboard and keep it in sync.

4. **Hero layout visibility flags audit**
   - `hero-hide-*` tokenOverrides map to `data-hero-hide-*` attributes. Confirm every visibility toggle has a matching DOM attribute consumer in `_org/[slug]/+layout.svelte`.

5. **Preset → tokenOverrides round-trip**
   - When a user applies a preset from `brand-editor/presets.ts`, does it populate every relevant tokenOverride key? Or only a subset, leaving non-preset keys at their old values (sticky overrides)?

6. **darkOverrides chain**
   - `darkModeOverrides` is a JSON string of `Partial<ThemeColors>`. Trace how it's consumed — does the CSS `:root[data-theme='dark']` or `@media (prefers-color-scheme: dark)` read it?

---

## 5. Reference files

| Area | Path | Lines |
|---|---|---|
| Editor store | `apps/web/src/lib/brand-editor/brand-editor-store.svelte.ts` | whole file |
| Save action | `apps/web/src/lib/components/brand-editor/BrandEditorMount.svelte` | 40-77 |
| Remote command | `apps/web/src/lib/remote/branding.remote.ts` | 158-271 |
| Remote invalidate | `apps/web/src/lib/server/cache.ts` | 8-17 |
| Service | `packages/platform-settings/src/services/branding-settings-service.ts` | whole file |
| Schema | `packages/database/src/schema/settings.ts` | branding_settings section |
| Worker route | `workers/organization-api/src/routes/settings.ts` | 97-203, 258 |
| Public info route | `workers/organization-api/src/routes/organizations.ts` | 341-400 |
| Layout server load | `apps/web/src/routes/_org/[slug]/+layout.server.ts` | whole file |
| Layout render + inject | `apps/web/src/routes/_org/[slug]/+layout.svelte` | 55-56, 90-96, 376-382 |
| Live CSS injection | `apps/web/src/lib/brand-editor/css-injection.ts` | 349-354 |
| Brand CSS consumer | `apps/web/src/lib/theme/tokens/org-brand.css` | 94-144 |
| System typography fallback | `apps/web/src/lib/styles/tokens/typography.css` | 4-5 |

---

## 6. Iteration log

| # | Date | Agents | Beads created | Key finding |
|---|---|---|---|---|
| 018 | 2026-04-23 | A (token three-way diff, sonnet), B (font persistence trace, sonnet) | ja9zp, 7afgp, g49b4, mdg94, fopbo, ag8l8 | Fonts ARE saved to DB — bug is waitUntil race on slug-keyed CACHE_KV invalidation, compounded by missing client-side invalidate('cache:org-versions') |
