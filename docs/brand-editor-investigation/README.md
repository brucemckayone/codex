# Brand Editor Investigation

**Status**: investigation complete, implementation landed 2026-04-23. Cron `470ab382` stopped. 1 P0 + 9 P1 closed across 9 commits.
**Driver**: User report: "font families are not saved — only show while editing, revert on reload"; two light/dark toggles out of sync; some fields don't work
**Scope**: map the full brand pipeline, identify every gap between control → persistence → hydration → CSS consumer, fix the bugs

This doc is the **persistent context store** for the investigation. Each iteration of the /design-system loop read from here, added findings, and updated the bead list.

**→ For the implementation writeup, see [`implementation-summary.md`](./implementation-summary.md)** (per-bug writeups, commits, cross-cutting patterns, verification playbook, remaining P2/P3 work).

**Ancillary docs** produced during the investigation:
- [`token-registry.json`](./token-registry.json) — 168-token machine-readable registry (iter-020 Agent E)
- [`per-theme-tokens-design.md`](./per-theme-tokens-design.md) — 459-line design doc for `Codex-wwedk` (iter-022 Agent J)
- [`lqvyy-patch.md`](./lqvyy-patch.md) — PR-ready patch spec for `Codex-lqvyy` (iter-023 Agent L; applied in `af423e86`)
- [`06ygy-patch.md`](./06ygy-patch.md) — PR-ready patch spec for `Codex-06ygy` P0 (iter-025 Agent O; applied in `cbd7dbf8`)

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

## 3. Known bugs

**Status legend**: ✅ = CLOSED · 🟡 = open · see [`implementation-summary.md`](./implementation-summary.md) for closed-bug writeups.

### From iter-018 (save/reload pipeline)

| Status | Bead | Priority | Title | Commit |
|---|---|---|---|---|
| ✅ | `Codex-ja9zp` | P1 | CACHE_KV slug invalidation race — stale font/color on reload | `0a29dc7e` |
| ✅ | `Codex-7afgp` | P1 | No client `invalidate('cache:org-versions')` after save | `0a29dc7e` |
| 🟡 | `Codex-g49b4` | P2 | 6 columns write-orphaned: `textColorHex`, `shadowScale`, `shadowColor`, `textScale`, `headingWeight`, `bodyWeight` | — |
| 🟡 | `Codex-mdg94` | P2 | Audit fine-tune panels — confirm values route to `tokenOverrides` | — |
| 🟡 | `Codex-fopbo` | P3 | `BRAND_KV` vs `CACHE_KV` — document or consolidate | — |
| 🟡 | `Codex-ag8l8` | P3 | Font CSS value format inconsistency (live preview vs SSR) | — |

Dependency chain: ~~`ja9zp` blocks `7afgp`~~ (both closed); `g49b4` blocks `mdg94`.

### From iter-019 (theming + cross-org delivery)

| Status | Bead | Priority | Title | Commit |
|---|---|---|---|---|
| ✅ | `Codex-9u8wg` | P1 | Editor theme preview wrote global `<html data-theme>` — scoped to `.org-layout[data-editing-theme]` | `b5d43243` |
| ✅ | `Codex-micw3` | P1 | `ThemeToggle` had no reactive subscription — converted to rune store | `de1907ad` |
| ✅ | `Codex-z91af` | P1 | `close()` restored stale `originalTheme` — dead code after 9u8wg | `b5d43243` |
| 🟡 | `Codex-wcwpw` | P2 | `tokenOverrides` FOUC — shader + CSS-var injection runs post-hydration (scope refined per `peqvl`) | — |
| 🟡 | `Codex-zv85e` | P3 | Draft `11-theming.md` + `11-multi-tenancy.md` skill references | — |

Dependency chain: ~~`9u8wg` blocks `z91af`~~ (both closed); `zv85e` blocked by `wcwpw` (the last remaining theming bug).

### From iter-020 (preset semantics + token registry)

| Status | Bead | Priority | Title | Commit |
|---|---|---|---|---|
| ✅ | `Codex-oqv3r` | P1 | `applyPreset` wiped user fine-tunes — now merges with spread | `f69d5534` |
| 🟡 | `Codex-v4wao` | P3 | R15 "partial Record update" anti-pattern (ready to apply — `oqv3r` landed) | — |
| 🟡 | `Codex-ac2o8` | P3 | Minimal-style presets should set `shader-preset: 'none'` | — |

Dependency chain: ~~`v4wao` + `ac2o8` blocked by `oqv3r`~~ (unblocked — `oqv3r` landed).

**Artifact**: `docs/brand-editor-investigation/token-registry.json` (2016 lines, 168 tokens) — machine-readable registry produced by iter-020 Agent E (haiku). Query by category to find org-brandable tokens, fine-tune keys, zero-consumer tokens. **Note**: iter-021 verification found 6 tokens misclassified in this file — see `Codex-9225y`.

### From iter-021 (hero visibility + zero-consumer verification)

| Bead | Priority | Title | Root file(s) |
|---|---|---|---|
| `Codex-9225y` | P3 | Correct `token-registry.json` — 6 tokens misclassified as zero-consumer (all LIVE-DIRECT) | `docs/brand-editor-investigation/token-registry.json` |
| `Codex-peqvl` | P3 | Refine `Codex-wcwpw` scope — hero-hide-* is SSR-rendered, NOT part of FOUC | `apps/web/src/routes/_org/[slug]/+layout.svelte:72-89` |
| `Codex-rwci4` | P3 | `injectBrandVars` writes `--color-hero-hide-*` with no consumers (noise) | `apps/web/src/lib/brand-editor/css-injection.ts:466-473` |
| `Codex-wwedk` | P2 | **FEATURE**: Per-theme shader + full tokenOverrides (extend darkOverrides beyond just colors) | `apps/web/src/lib/brand-editor/brand-editor-store.svelte.ts` + schema + UX |

`Codex-wwedk` is a **user-directed feature request raised mid-iter-021**, not a bug. Blocked by `Codex-9u8wg` (editor scope-to-`[data-editing-theme]`) + `Codex-lqvyy` (base dark-render-path missing — see iter-022 below). Design doc written: `docs/brand-editor-investigation/per-theme-tokens-design.md` (iter-022 Agent J, recommends **Option B** — parallel `darkTokenOverrides` column).

### From iter-022 (darkOverrides render trace + wwedk design)

| Status | Bead | Priority | Title | Commit |
|---|---|---|---|---|
| ✅ | `Codex-lqvyy` | P1 | `darkModeOverrides` rendered for non-editor visitors (SSR `$derived` + `style:` bindings) | `af423e86` |

### From iter-023 (sibling hunt + lqvyy PR sketch)

| Bead | Priority | Title | Root file(s) |
|---|---|---|---|
| `Codex-688ax` | P3 | Skill: add cross-reference rule — every `--brand-*` read by `org-brand.css` must be bound by `+layout.svelte` | `references/01-tokens.md` + `references/10-brand-editor.md` |

### From iter-024 (preset coherence + upload flow audit)

| Status | Bead | Priority | Title | Commit |
|---|---|---|---|---|
| ✅ | `Codex-06ygy` | **P0** | **SECURITY: Logo upload bypasses SVG sanitization — stored XSS** (sanitize + cache-control split) | `cbd7dbf8` |
| ✅ | `Codex-ne00j` | P1 | Logo Remove button wired to `deleteLogo` server call | `de1907ad` |
| ✅ | `Codex-631mn` | P1 | Intro video self-heals on branding read | `5548e091` |
| 🟡 | `Codex-uw05n` | P2 | Logo upload cache fire-and-forget (same fix pattern as closed `ja9zp`) | — |
| 🟡 | `Codex-57d8a` | P2 | SidebarRail logo placeholder when `logoUrl` null | — |
| 🟡 | `Codex-mo3ib` | P3 | Orphaned intro video HLS segments never cleaned from R2 | — |
| 🟡 | `Codex-dnjrn` | P3 | Onyx preset coherence (Luxury with 1.01 hover + 0.7 iridescence) | — |

Dependency: ~~`uw05n` linked to `ja9zp`~~ — `ja9zp` landed, so `uw05n` now has a canonical pattern to follow (see implementation-summary.md).

### From iter-025 (06ygy patch spec + sibling upload audit)

| Bead | Priority | Title | Root file(s) |
|---|---|---|---|
| `Codex-7m2kd` | P3 | Promote R15 hard rule — SVG upload handlers MUST sanitize before R2 write | `references/02-css-architecture.md` §2 (hard rules table) |

**Artifact**: `docs/brand-editor-investigation/06ygy-patch.md` (469 lines) — PR-ready patch for the P0. Diff + unit tests + integration test + checklist. Also folds in a bonus P2 cache-control fix: SVG logos should have 1-hour cache (matches `ImageProcessingService`), not the current 1-year that prevents re-uploads propagating.

**Isolation confirmed**: Agent P audited ALL upload endpoints. Only logo upload accepts SVG. Content thumbnail, avatar, and media uploads use `SUPPORTED_IMAGE_MIME_TYPES` (PNG/JPEG/WEBP/GIF only — verified at `image.ts:20-25`). The P0 is a single-endpoint gap, not a systemic pattern.

**Pause counter**: 1/3 after iter-025 (1 P3 only — no new P1/P0 findings; the P0 from iter-024 is already tracked).

**Iter-023 sibling hunt proved `lqvyy` is isolated, not a pattern**: tokenOverrides FOUC is already tracked in `wcwpw`; `heroLayout`/intro-video/dark-logo are N/A (concept doesn't exist); player tokens are theme-agnostic by design. Zero new bug beads needed. See iter-023 audit for the full falsification.

**Artifact**: `docs/brand-editor-investigation/lqvyy-patch.md` (520 lines) — PR-ready patch spec for `lqvyy`. Unified diff, unit test scaffolding, Playwright e2e spec, pre-PR checklist, rollout plan. Can be applied in one pass when authorized.

**Convergence signal**: iter-023 produced zero new P1/P2 bugs — pause counter **1/3** (reset after iter-022's user-expansion finding).

**Bombshell finding**: Agent I traced `darkModeOverrides` end-to-end and found the render path terminates at the editor's `$effect`. Every org that's set dark colors is showing LIGHT primary colors to dark-mode visitors. The feature works in editor preview (via `injectBrandVars`) but fails silently for production visitors.

**Fix is ~30 lines**: add `$derived.by()` parse + 4 `style:--brand-*-dark` bindings on `.org-layout`, mirroring the existing `brandPrimary`/`brandSecondary`/etc. pattern. Because `$derived` runs in SSR, dark colors arrive with initial HTML — no FOUC.

**Artifact**: `docs/brand-editor-investigation/per-theme-tokens-design.md` (459 lines) — Agent J's design proposal for `wwedk`. Evaluates 3 schema options (unified widening / parallel column / dual-keyed suffix). Recommends **Option B** (parallel `darkTokenOverrides` column) for type safety + additive migration + clean future expansion.

**Convergence counter reset** (per user scope expansion + lqvyy finding): iter-022 produced 1 P1 + a major design artifact. Pause counter is back to 0/3.

Key finding (non-bug): **Hero visibility flags are fully CORRECT** end-to-end (5 keys, 5 SSR attrs, 5 CSS consumers, zero orphans). No bugs to file from that slice of the audit.

**Convergence signal** (pre-user-expansion): iter-021's original scope produced zero P1 findings — pause-condition count 1/3. The `wwedk` feature request **resets the convergence counter** — iter-022 is now committed to new investigation regardless of other slice findings.

---

## 4. Investigation queue (iter-024+)

Each bullet is a candidate agent task for a future loop fire. Pick two per iteration to match the 2-concurrent-agent limit.

Completed: ~~Light/dark sync~~ (iter-019); ~~Cross-org brand injection~~ (iter-019); ~~Token registry JSON~~ (iter-020); ~~Preset round-trip~~ (iter-020); ~~Hero visibility audit~~ (iter-021 — chain confirmed clean); ~~Zero-consumer token classification~~ (iter-021 — all 6 live); ~~darkOverrides render trace~~ (iter-022 — yielded lqvyy); ~~wwedk schema design~~ (iter-022 — design doc written); ~~Sibling bug hunt~~ (iter-023 — lqvyy proven isolated); ~~lqvyy PR sketch~~ (iter-023 — patch doc written).

### Scope decisions (2026-04-23)

**EXPLICITLY OUT OF SCOPE — do not investigate in future fires:**
- Custom font upload flow (beyond Google Fonts)
- User-level theme preferences (global model confirmed; no user overrides)
- Brand editor accessibility audit (prior iter-04/iter-09 findings sufficient)
- Mobile-specific brand render paths
- Email template theming
- Print styles (`@media print`) and org branding

User confirmed 2026-04-23 that none of these six unknowns warrant investigation. If a future agent proposes them, decline and cite this note.

**In-scope remaining** (standard queue only — no new terrain):

### PRIORITY: User-directed scope expansion (2026-04-23)

0. **Per-theme shader + full tokenOverrides design** ← `Codex-wwedk` (P2 feature)
   - Colors are per-theme via `darkOverrides`; shaders and all other tokenOverrides are single-valued across themes.
   - User requests: independently configurable shader per theme, plus ability to vary other fine-tune keys by theme.
   - Agent task: propose schema (option A/B/C outlined in bead), UX flow (which fine-tunes make sense per-theme vs shared), CSS consumption pattern (gate via `[data-theme='dark'] [data-org-brand]`), migration path.
   - Depends on `Codex-9u8wg` landing (editor preview scoped to `[data-editing-theme]` — needed infrastructure).
   - Use sonnet (schema + UX design, high synthesis).

### Standard queue

2. **darkOverrides chain (prerequisite for `wwedk`)**
   - `darkModeOverrides` is a JSON string of `Partial<ThemeColors>`. Trace how it's consumed at SSR layout level, not just editor preview.
   - Interaction with `z91af` fix — if we stop `<html data-theme>` mutation from editor, does dark-mode preview of custom override still work?
   - This trace is also now a prerequisite for `wwedk` (per-theme shader) — the schema/UX proposal needs to be informed by how dark colors actually flow end-to-end.

3. **Subscription to localStorage across tabs**
   - If user has the app open in two tabs on the same org and toggles theme in tab A, does tab B update? (Depends on if ThemeToggle gets a `storage` event listener after `micw3` fix.)

4. **Zero-consumer token audit** — from `token-registry.json`, iter-020 Agent E flagged 6 tokens with no `var()` consumers (`--color-brand-primary-hover`, `--color-interactive-hover`, etc.). Agent E believed these are used implicitly via OKLCH relative-color syntax. Verify by grepping the computed-color chain and either confirm they're live or remove them.

5. **Dark-mode editor preview under fix `9u8wg`**
   - Once `9u8wg` lands (editor scopes preview to `.org-layout[data-editing-theme]`), audit every place `[data-theme='dark']` is used and ensure parallel `[data-editing-theme='dark']` rules exist. Miss = dark preview silently does nothing.

6. **Preset category coherence audit**
   - The 27 presets are categorized as Professional/Creative/Bold/Minimal/Organic/Tech/Luxury/Playful/Atmospheric. Audit: do the `tokenOverrides` in each preset match their category intent? E.g., Minimal presets should not bundle aggressive shaders; Bold presets should have strong `heading-color` overrides. Surface presets whose values disagree with their label.

7. **Intro video + logo upload flows**
   - Iter-018/019/020 focused on tokens. There are two binary uploads in the brand editor (logo + intro video) that have their own pipelines. Map them as a follow-up (multipart upload → R2 → DB URL → render) for completeness.

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
| 019 | 2026-04-23 | C (light/dark sync, sonnet), D (cross-org brand injection, sonnet) | 9u8wg, micw3, z91af, wcwpw, zv85e | Light/dark sync is THREE stacked bugs (editor writes global `<html data-theme>`, ThemeToggle has no external subscription, close() clobbers sidebar toggle). Sub-orgs are FLAT — no hierarchy, no brand inheritance. New FOUC bug: shader/hero tokenOverrides arrive post-hydration. Both agents proposed new skill references (`11-theming.md` + `11-multi-tenancy.md`) — deferred until bugs land so refs reflect reality. |
| 020 | 2026-04-23 | E (token registry JSON, **haiku**), F (preset round-trip audit, sonnet) | oqv3r, v4wao, ac2o8 | P1 preset bug: `applyPreset` wholesale-replaces `state.pending.tokenOverrides`, silently wiping ~30 fine-tune keys every time a user browses presets. One-line fix (merge instead of replace). Produced `token-registry.json` — 168 tokens, machine-readable. Pattern-level anti-pattern surfaced: "partial Record update should merge, not replace" — candidate for skill reference 10. Haiku nailed the enumeration task for ~1/3 the token cost of sonnet. |
| 021 | 2026-04-23 | G (hero visibility audit, sonnet), H (zero-consumer classification, **haiku**) | 9225y, peqvl, rwci4 | **Zero P1 findings — first convergence iteration.** Hero visibility chain is CLEAN end-to-end (5 keys, zero orphans). Verification step caught haiku mis-classifying 2 "DEAD" tokens that are actually live in production (pricing + VideoPlayer). `wcwpw`'s scope narrowed — hero-hide is SSR-rendered via `$derived.by()`, not `$effect`; FOUC only applies to CSS-var injection path. Minor noise bug: `injectBrandVars` writes useless `--color-hero-hide-*` CSS vars. Loop is now self-correcting prior-iteration artifacts. |
| 022 | 2026-04-23 | I (darkOverrides render trace, sonnet), J (wwedk schema + UX design, sonnet) | lqvyy + design doc | **Bombshell P1**: `darkModeOverrides` is NEVER rendered for non-editor visitors — feature is half-shipped, every org with dark colors set is showing LIGHT palette to dark-mode users. Fix is ~30 lines (add `$derived` + `style:--brand-*-dark` bindings in `+layout.svelte`). Design doc for `wwedk` written (459 lines) — recommends parallel `darkTokenOverrides` column. User scope expansion + new P1 resets convergence counter to 0/3. Reference 10 was FINALLY opened by an agent and correctly predicted the bug via its §10 gotcha list. |
| 023 | 2026-04-23 | K (sibling bug hunt, sonnet), L (lqvyy patch spec, sonnet) | 688ax + patch doc | **Zero new bugs — `lqvyy` proven isolated.** Agent K's sibling hunt falsified the iceberg hypothesis: 7 candidates checked, none were new bugs (5 N/A by design, 2 already in `wcwpw`). Agent L produced 520-line PR-ready patch spec with diff, unit tests, Playwright e2e, checklist — ready to apply in one pass. Filed `Codex-688ax` as a skill-patch task (queued after lqvyy lands). Pause counter back to 1/3. |
| 024 | 2026-04-23 | M (preset coherence, **haiku**), N (upload flow mapping, sonnet) | 06ygy (P0) + ne00j + 631mn + uw05n + 57d8a + mo3ib + dnjrn | **MASSIVE iteration — first P0 of the loop**. Agent N mapped logo + intro video upload flows and found SVG sanitization completely absent in the logo upload path (explicit CLAUDE.md rule violation, stored XSS vector). Also found: dead Remove button (schema omits logoUrl), intro video invisible until cache flush, cache race (ja9zp-class), missing logo placeholder, orphaned R2 HLS segments. Agent M confirmed 26/27 presets coherent; 1 P3 mild mismatch (Onyx luxury). Pause counter RESET to 0/3 — investigation terrain not exhausted after all. |
| 025 | 2026-04-23 | O (06ygy patch spec, sonnet), P (sibling upload audit, **haiku**) | 7m2kd + patch doc | **06ygy isolation confirmed + PR-ready patch written**. Agent P checked all upload endpoints; only logo upload accepts SVG (by structural design — `SUPPORTED_IMAGE_MIME_TYPES` excludes SVG). Agent O produced 469-line patch spec including a bonus cache-control fix (SVG logos at fixed key should have 1h cache, not 1y, per `ImageProcessingService` pattern). Filed `Codex-7m2kd` to promote R15 hard rule post-fix. Pause counter: 1/3. |
| — | 2026-04-23 | **Implementation phase** (no agents — direct fixes) | 10 bugs closed | **Cron `470ab382` stopped.** 1 P0 + 9 P1s landed across 9 commits (`cbd7dbf8` → `5548e091`). Both user-reported bugs resolved (font persistence + light/dark sync). Test coverage added where risk warranted: 5 security tests for `06ygy`, 6 parser tests for `lqvyy`. Per-bug writeups + cross-cutting patterns at [`implementation-summary.md`](./implementation-summary.md). 18 beads remain open (all P2/P3 — features, tech debt, skill patches). |
