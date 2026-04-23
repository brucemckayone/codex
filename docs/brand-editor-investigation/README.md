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

## 3. Known bugs

### From iter-018 (save/reload pipeline)

| Bead | Priority | Title | Root file(s) |
|---|---|---|---|
| `Codex-ja9zp` | P1 | CACHE_KV slug invalidation race — stale font/color on reload | `workers/organization-api/src/routes/settings.ts:171-203` |
| `Codex-7afgp` | P1 | No client `invalidate('cache:org-versions')` after save — layout doesn't refresh | `apps/web/src/lib/remote/branding.remote.ts:261-267` |
| `Codex-g49b4` | P2 | 6 columns write-orphaned: `textColorHex`, `shadowScale`, `shadowColor`, `textScale`, `headingWeight`, `bodyWeight` | `apps/web/src/lib/components/brand-editor/BrandEditorMount.svelte:49-69` |
| `Codex-mdg94` | P2 | Audit fine-tune panels — confirm values route to `tokenOverrides` | `apps/web/src/lib/components/brand-editor/levels/BrandEditor*FineTune*.svelte` |
| `Codex-fopbo` | P3 | `BRAND_KV` vs `CACHE_KV` — document or consolidate | `workers/organization-api/src/routes/settings.ts:97-164` |
| `Codex-ag8l8` | P3 | Font CSS value format inconsistency (live preview vs SSR) | `apps/web/src/lib/brand-editor/css-injection.ts:349-354` vs `_org/[slug]/+layout.svelte:376` |

Dependency chain: `ja9zp` blocks `7afgp`; `g49b4` blocks `mdg94`.

### From iter-019 (theming + cross-org delivery)

| Bead | Priority | Title | Root file(s) |
|---|---|---|---|
| `Codex-9u8wg` | P1 | Brand editor theme preview writes global `<html data-theme>` — leaks into user preference | `apps/web/src/lib/brand-editor/brand-editor-store.svelte.ts:222-230` |
| `Codex-micw3` | P1 | `ThemeToggle` has no reactive subscription to external `data-theme` — icon goes stale | `apps/web/src/lib/components/ui/ThemeToggle/ThemeToggle.svelte:16-24` |
| `Codex-z91af` | P1 | `close()` restores captured `originalTheme` — clobbers in-session sidebar toggle | `apps/web/src/lib/brand-editor/brand-editor-store.svelte.ts:113-157` |
| `Codex-wcwpw` | P2 | `tokenOverrides` FOUC — shader preset + hero visibility flags absent on first paint | `apps/web/src/routes/_org/[slug]/+layout.svelte:116-132` |
| `Codex-zv85e` | P3 | Draft `11-theming.md` + `11-multi-tenancy.md` skill references after bugs land | — (docs) |

Dependency chain: `9u8wg` blocks `z91af` (close-restore becomes dead code after editor stops touching `<html>`); `zv85e` blocked by all four bugs (reference should reflect landed reality, not intent).

### From iter-020 (preset semantics + token registry)

| Bead | Priority | Title | Root file(s) |
|---|---|---|---|
| `Codex-oqv3r` | P1 | `applyPreset` wipes user fine-tunes — preset browsing destroys ~30 fine-tune keys silently | `apps/web/src/lib/brand-editor/brand-editor-store.svelte.ts:210-214` |
| `Codex-v4wao` | P3 | Add "partial Record update" anti-pattern to `/design-system` reference 10 | `references/10-brand-editor.md` |
| `Codex-ac2o8` | P3 | Minimal-style presets should set `shader-preset: 'none'` for explicit clearing | `apps/web/src/lib/brand-editor/presets.ts` |

Dependency chain: `v4wao` + `ac2o8` blocked by `oqv3r` (skill patch + preset data fix both only make sense under merge semantics).

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

| Bead | Priority | Title | Root file(s) |
|---|---|---|---|
| `Codex-lqvyy` | **P1** | **`darkModeOverrides` NEVER rendered for non-editor visitors** — half-shipped feature; dark colors invisible to regular users | `apps/web/src/routes/_org/[slug]/+layout.svelte` — missing `$derived` + `style:--brand-color-dark` bindings |

### From iter-023 (sibling hunt + lqvyy PR sketch)

| Bead | Priority | Title | Root file(s) |
|---|---|---|---|
| `Codex-688ax` | P3 | Skill: add cross-reference rule — every `--brand-*` read by `org-brand.css` must be bound by `+layout.svelte` | `references/01-tokens.md` + `references/10-brand-editor.md` |

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

## 4. Investigation queue (iter-022+)

Each bullet is a candidate agent task for a future loop fire. Pick two per iteration to match the 2-concurrent-agent limit.

Completed: ~~Light/dark sync~~ (iter-019); ~~Cross-org brand injection~~ (iter-019); ~~Token registry JSON~~ (iter-020); ~~Preset round-trip~~ (iter-020); ~~Hero visibility audit~~ (iter-021 — chain confirmed clean); ~~Zero-consumer token classification~~ (iter-021 — all 6 live).

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
