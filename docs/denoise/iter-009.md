# iter-009 — Simplification × packages

> **Cell**: `simplification × packages` (first run; opens the simplification epic — Codex-mqyql)
> **Date**: 2026-04-25
> **HEAD before audit**: `fa75804e` (iter-008 commit)
> **Phase status**: Phase B implemented for `--scope=packages` × `--phase=simplification`.
> **R7 promotion fired pre-cycle**: R13 (`workers:waituntil-no-catch`) — already in SKILL.md §1 per substitution block. No new promotions queued by this cycle.

---

## Cycle scope

- **`SINCE_REF`**: 14 days ago (effective: every iter-008+ commit; cell is first-run, so all packages churn since 2026-04-11 are in scope).
- **`IN_SCOPE_FILES`**: ~89 source files under `packages/*/src/**` (non-test, non-migrations) — covers all 22 packages.
- **`FALLOW_JSON`**: `/tmp/denoise-iter-009-fallow.json` — 207 total issues. 5 unused exports + 14 unused types + 30+ unused class members in `packages/`. Cross-checked against `/fallow-audit` False-Positive Taxonomy:
  - All 30+ class-member hits = FP #3 (service-registry dispatch via `ctx.services.*`).
  - 5 unused exports in `binary-upload-procedure.ts` + `multipart-procedure.ts` = FP #2 (export-star barrel chain) — `multipartProcedure` and `binaryUploadProcedure` ARE consumed by 4 worker files.
  - 14 unused types = FP #11 (self-use type exports — keep declarations, drop the `export` keyword); routed to `/fallow-audit`, NOT a denoise finding.
- **`TYPECHECK_BASELINE`**: `/tmp/denoise-iter-009-typecheck-baseline.log` — pre-existing TS errors recorded; this cycle's proof tests introduce no new errors.
- **JSCPD**: 508 total clone clusters (13.37 % file-level dup), 342 in TypeScript. After filtering out `dist/` build-artifact pairs (the dist↔src re-emit) and `package.json` clones, 60+ TS source clones remain. Top 50 reviewed; 6 emerged as actionable simplification findings.

---

## Fabrication check

**Total cited symbols across `references/03-simplification.md` + `references/07-domain-packages.md` = 38** (anti-pattern fingerprints + recipe-cited symbols). Verified live in current code:

- Reference 07 §1 (`BaseService`, `extends BaseService`, `handleError`, `assertNotFound`): all live (10+ services use `extends BaseService`).
- Reference 07 §2 (`scopedNotDeleted`, `withCreatorScope`): live (`packages/content/src/services/media-service.ts:18-19` + several other consumers).
- Reference 07 §3 (`@codex/service-errors` typed error subclasses): live.
- Reference 07 §5 (`ctx.services.*`, `service-registry.ts`): live (path exists; consumed by 4+ workers).
- Reference 07 §6 (`@codex/foo/src/internal` deep-import smell): no current matches in code (positive — clean).
- Reference 03 §1–§5 cite **strawman names** (`FooFactory`, `FooStrategy`, `FooHook`, `User.userName`) intentionally — these are illustrative tutorial examples. Distinct from doc-rot: a fabrication check on illustrative names would be over-strict. Not flagged.

**Result: 38/38 cited live symbols verify. 0 stale citations. 0 doc-rot findings this cycle.**

---

## Findings

| ID | Severity | Fingerprint | File:Line | Proof form |
|---|---|---|---|---|
| F1 | Major | `simplification:duplicate-utility-helper` | `packages/worker-utils/src/middleware.ts:658` + `packages/worker-utils/src/procedure/helpers.ts:36` | Catalogue row 12 — clone-count assertion |
| F2 | Major | `simplification:dup-procedure-context-builder` | `packages/worker-utils/src/procedure/procedure.ts:149-168` + `packages/worker-utils/src/procedure/upload-shared.ts:74-103` | Catalogue row 1 + row 12 — parity-via-clone-count |
| F3 | Major | `simplification:dup-paginated-list-shape` | `packages/content/src/services/{content,media}-service.ts` + `packages/notifications/src/services/template-service.ts` (×3 list methods) | Catalogue row 12 — clone-count assertion |
| F4 | Major | `simplification:dup-image-pipeline` | `packages/image-processing/src/service.ts:130-545` (3 pipelines) | Catalogue row 12 — clone-count assertion |
| F5 | Minor | `simplification:dup-utility-helper:bump-with-logger` | `packages/content/src/services/content-invalidation.ts:425` + `packages/subscription/src/services/subscription-invalidation.ts:116-140` | Catalogue row 12 — clone-count assertion |
| F6 | Minor | `simplification:dup-fetch-with-without-scope` | `packages/transcoding/src/services/transcoding-service.ts:671` + `packages/transcoding/src/services/transcoding-service.ts:737` | Catalogue row 12 — clone-count assertion |

**6 findings — 0 blocker, 4 major, 2 minor. 0 testability-bugs (rate 0%).**

---

### F1 — `simplification:duplicate-utility-helper` (major)

**Sites**:
- `packages/worker-utils/src/middleware.ts:658` — private `function generateRequestId()`
- `packages/worker-utils/src/middleware.ts:669` — private `function getClientIP(c)`
- `packages/worker-utils/src/procedure/helpers.ts:36` — `export function generateRequestId()` (canonical)
- `packages/worker-utils/src/procedure/helpers.ts:49` — `export function getClientIP(c)` (canonical)

Both pairs are byte-identical. The middleware-internal copies pre-date the procedure refactor; nobody outside `@codex/worker-utils` consumes either path directly (verified via `grep -rn 'generateRequestId\|getClientIP' workers/ apps/web/src` → 0 hits). Fix: `middleware.ts` imports from `./procedure/helpers` and deletes its private copies. Same package, same lifetime — no API drift.

**Proof**: `packages/worker-utils/src/__denoise_proofs__/iter-009/F1-dup-utility-helper-request-id.test.ts` — asserts each helper has exactly one declaration site, and that the surviving site is `procedure/helpers.ts`.

**MCP gate**: simplification × packages requires no MCPs (per SKILL.md §3, "Static; no MCPs required"). Proof test is the canonical evidence.

**Catalogue walk** (R2): row 12 (clone-count) chosen — strictest assertion for the duplication shape, and a parity test (row 1) is implicit because identical implementations cannot diverge after the dedup. No need for testability-bug fallback.

**Recurrence**: New fingerprint `simplification:duplicate-utility-helper`. hits=1 in this cycle (F1, F5 share the family — see notes below).

---

### F2 — `simplification:dup-procedure-context-builder` (major)

**Sites**:
- `packages/worker-utils/src/procedure/procedure.ts:149-168` — inline 14-key `ProcedureContext` builder.
- `packages/worker-utils/src/procedure/upload-shared.ts:74-103` — `buildUploadBaseContext()` builds the SAME 14-key shape, used by `binaryUploadProcedure` and `multipartProcedure`.

Codex-j9xcl extracted `upload-shared.ts` to dedupe the binary/multipart pair (the docblock at line 12-15 says "to eliminate ~165 lines of scaffold duplication"), but `procedure()` itself was never re-pointed at the shared helper. Net: the 14-key context shape can drift between `procedure()` and the upload procedures. Concrete drift risk: `userAgent: c.req.header('User-Agent') || 'unknown'` is hard-coded in two places; a default change in one site silently splits behaviour.

Fix: refactor `procedure.ts:149-168` to call `buildUploadBaseContext()` (or co-rename the helper to `buildBaseProcedureContext()` if the "upload" prefix is now misleading; either way, single source of truth).

**Proof**: `packages/worker-utils/src/__denoise_proofs__/iter-009/F2-dup-procedure-context-builder.test.ts` — asserts the literal `userAgent: c.req.header('User-Agent')` substring appears in exactly one source file (the canonical helper).

**MCP gate**: static; no MCPs required.

**Catalogue walk** (R2): row 1 (parity) is the strongest form, but rolling a behaviour-equivalence harness for both context-builders requires mocking a Hono `Context` + `ServiceRegistry`. Row 12 (clone-count) gives equivalent guarantees with zero harness — chosen.

**Recurrence**: New fingerprint. hits=1.

---

### F3 — `simplification:dup-paginated-list-shape` (major)

**Sites** (≥6 instances of the same shape across 3 packages):
- `packages/content/src/services/content-service.ts` — `list()` (~700-770) and `listPublic()` (~800-870).
- `packages/content/src/services/media-service.ts` — `list()` (~405-455).
- `packages/notifications/src/services/template-service.ts` — `listGlobalTemplates()` (~75-110), `listOrgTemplates()` (~220-260), `listCreatorTemplates()` (~405-445).

Each site implements:

```ts
const { limit, offset } = withPagination({ page, limit });
const whereConditions = [/* ... */];
const [items, countResult] = await Promise.all([
  this.db.query.<table>.findMany({ where: and(...whereConditions), limit, offset, orderBy, with: {/* relations */} }),
  this.db.select({ total: count() }).from(<table>).where(and(...whereConditions)),
]);
const total = Number(countResult[0]?.total ?? 0);
return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
```

Differences are purely (a) the table reference and (b) the `with` relation set. Steps 1, 4, 5, 6 are identical.

JSCPD picked up 39-line and 34-line clusters between `content-service.ts ↔ media-service.ts` and within `template-service.ts` self-clones. Cycle_density ≥ 6 (≥3 packages, ≥6 callers).

Fix: extract `paginatedQuery({ db, table, where, with?, orderBy?, page, limit })` to either `@codex/database` or `@codex/worker-utils` (returns `PaginatedResult`-shaped output).

**Proof**: `packages/content/src/__denoise_proofs__/iter-009/F3-dup-paginated-list-shape.test.ts` — asserts the literal `.select({ <key>: count() }).from(...)` shape appears in at most one file (the helper) post-fix.

**MCP gate**: static.

**Catalogue walk**: row 12 chosen. Row 1 (parity) is APPLICABLE post-fix (assert helper output matches inline body for a corpus). Row 2 (consumer-count) NOT applicable — helper is new, consumers don't exist yet.

**Recurrence**: New fingerprint. hits=1, **cycle_density=6** — note this matches the threshold profile that drove R12's endemic single-cycle 5-hit promotion. **Watch for endemic-density promotion** if another simplification cycle touches list code; or consider a 2-hit early promotion if a fix-PR doesn't land before iter-010.

---

### F4 — `simplification:dup-image-pipeline` (major)

**Site**: `packages/image-processing/src/service.ts` — three nearly-identical raster pipelines:
- `processContentThumbnail()` (~100-232)
- `processUserAvatar()` (~238-345)
- `processOrgLogo()` raster path (~380-545)

Each pipeline runs:
1. `validateImageFile(file)` → `buffer`
2. `processImageVariants(buffer)` → `{ sm, md, lg }`
3. `keys = { sm, md, lg }` via `getXxxKey(...)`
4. `Promise.allSettled([put(sm,…), put(md,…), put(lg,…)])` with the **identical** options literal `{ contentType: 'image/webp', cacheControl: 'public, max-age=31536000, immutable' }` repeated **9 times** (3 pipelines × 3 variants).
5. On any rejected → `Promise.allSettled([delete(sm), delete(md), delete(lg)])` + `throw new ValidationError(...)`.
6. DB-update wrapped in `try/catch` that itself runs an `allSettled` cleanup and records orphans via `OrphanedFileService`.

The catch-and-cleanup branch (lines 193-225, 308-340, 484-525) is a 30-line clone repeated 3 times.

This is the strongest "rule of three" signal in the cycle's set — three vindicating consumers exist; the abstraction is missing. JSCPD reports 3 clusters between 17L–31L between these regions.

Fix: extract `uploadImageVariants({ keys, variants, options })` and `withDbUpdateOrphanCleanup({ keys, imageType, entityId, entityType }, dbUpdateFn)`. After extraction, each pipeline shrinks to ~20 lines (validate + variant-key calc + helper call + helper call).

**Proof**: `packages/image-processing/src/__denoise_proofs__/iter-009/F4-dup-image-pipeline.test.ts` — two assertions:
1. `cacheControl: 'public, max-age=31536000, immutable'` literal appears at most once in `service.ts` (currently 9).
2. `'R2 cleanup failed after DB error'` warn-tag appears at most once (currently 3).

**MCP gate**: static.

**Catalogue walk**: row 12 (clone-count) chosen — gives the cleanest pre/post assertion. Row 1 (parity) APPLICABLE post-fix: capture mock R2 put-sequences across all three pipelines, assert put-options match the canonical helper.

**Recurrence**: New fingerprint. hits=1.

---

### F5 — `simplification:dup-utility-helper:bump-with-logger` (minor)

**Sites**:
- `packages/content/src/services/content-invalidation.ts:425` — `bumpWithLogger(cache, waitUntil, key, ctx, logger?)` helper. Docblock literally states "Mirrors the shape used by `subscription-invalidation.ts` so the two sibling helpers behave identically".
- `packages/subscription/src/services/subscription-invalidation.ts:116-140` — inlines the SAME shape twice (library bump + subscription bump). Does NOT import from `content-invalidation.ts` (would be a layer-leak between sibling service packages — correct rejection — but the pattern should live in foundation).

The author already noticed the duplication at write-time and documented the intent for parity. The natural foundation home is `@codex/cache` (`VersionedCache.invalidateAndForget(key, waitUntil, logger?, ctx?)` or a free function).

Fix: move `bumpWithLogger` to `@codex/cache`; both invalidation modules import it.

**Proof**: `packages/subscription/src/__denoise_proofs__/iter-009/F5-dup-bump-with-logger.test.ts` — asserts the inline `cache.invalidate(key).catch(...)` pattern appears in at most one source file (the foundation helper) across `content/` + `subscription/`.

**MCP gate**: static.

**Catalogue walk**: row 12 chosen. Row 2 (consumer-count) APPLICABLE post-fix to verify exactly two consumers depend on the helper. Row 3 (type-equality of `WaitUntilFn` / `InvalidationLogger`) NOT applicable — already filed under R11 / iter-004 `Codex-lqvw4.1`; **NOT re-filed**.

**Recurrence**: Same family as F1 (fingerprint stem `simplification:duplicate-utility-helper`); recurrence ledger should track `simplification:duplicate-utility-helper` at hits=1 for this cycle (sub-fingerprints `:request-id` and `:bump-with-logger` are sibling rows). Severity scaled to minor because the fix is mechanical and the duplicated shape is annotated.

---

### F6 — `simplification:dup-fetch-with-without-scope` (minor)

**Sites**:
- `packages/transcoding/src/services/transcoding-service.ts:671` — `getMediaForTranscoding(mediaId, creatorId)` — user-facing, scoped by `creatorId`.
- `packages/transcoding/src/services/transcoding-service.ts:737` — `getMediaForTranscodingInternal(mediaId)` — HMAC worker-to-worker, no creator scope.

Both share the same 22-column projection on `mediaItems` (`id`, `creatorId`, `mediaType`, `status`, `r2Key`, `transcodingAttempts`, `runpodJobId`, `transcodingError`, `transcodingPriority`, `transcodingProgress`, `transcodingStep`, `hlsMasterPlaylistKey`, `hlsPreviewKey`, `thumbnailKey`, `waveformKey`, `waveformImageKey`, `durationSeconds`, `width`, `height`, `readyVariants`). If a new column is added, one site can drift from the other and the worker-to-worker path silently returns stale data.

JSCPD reports a 27-line clone between the two methods.

Fix: extract a private `fetchMediaForTranscoding(predicate: SQL): Promise<TranscodingMediaItem | undefined>` that owns the column projection. The two callers wrap it with their respective WHERE predicate and downstream error handling (`MediaOwnershipError` second-query stays in the public method).

**Proof**: `packages/transcoding/src/__denoise_proofs__/iter-009/F6-dup-fetch-with-without-scope.test.ts` — asserts `transcodingAttempts: true,` (a distinctive line from the projection) appears exactly once in `transcoding-service.ts`. Currently 2.

**MCP gate**: static.

**Catalogue walk**: row 12 chosen. Row 1 (parity) APPLICABLE post-fix (assert both methods return identical row shapes for matching DB state). Severity minor because the column drift risk is recoverable, both sites are within one file (one author, immediate review).

**Recurrence**: New fingerprint `simplification:dup-fetch-with-without-scope`. hits=1.

---

## Findings considered and rejected

These were spotted during the audit pass but did not warrant a finding:

| Candidate | Verdict |
|---|---|
| `binaryUploadProcedure` / `multipartProcedure` exports flagged by fallow as unused | **FP #2 (export-star + barrel)**. 4 worker route files import them. Live. |
| `MappedStripeSubscription`, `TierServiceConfig`, `TierPriceChangeMailer` types flagged by fallow as unused | **FP #11 (self-use type exports)**. Used inside their own files as parameter/return types. Action: drop `export`, keep declaration. **Routed to `/fallow-audit`**, not denoise. |
| `WaitUntilFn` / `InvalidationLogger` declared in 2+ packages | **Already filed** under R11 / iter-004 `Codex-lqvw4.1` (`types:type-duplicate-cross-package`). Out of phase scope; not re-filed. |
| `transcoding-service.ts` handleWebhook success/failure update blocks (lines 390-413 vs 434-457) | Two distinct outcomes (READY vs FAILED) with different `set()` payloads + different `obs.info`/`obs.error`. JSCPD's 24L match is a coincidental shape — extracting a helper would obscure the success-vs-failure dichotomy. Reject. |
| `content-management-service.ts` publishContent vs unpublishContent (lines 175-215 vs 223-301) | Real duplication (transaction + verify + status update + cache.invalidate), but extracting a `transitionStatus(contentId, fromStatus, toStatus, ...)` helper would only shave ~30 lines while obscuring the status invariants. Net reduction marginal. Filed mentally as a future watch — not flagged this cycle. |
| Schema-row clones in `packages/database/src/schema/*` | False positives — Drizzle column shapes (`uuid('id').primaryKey().defaultRandom()`, `timestamp('createdAt').notNull().defaultNow()`) are inherently repetitive across tables; deduping them would fight the ORM's declarative model. |
| Test-utils E2E fixture self-clones | Out of scope — `packages/test-utils/src/e2e/**` is fixture wiring; structural repetition reflects fixture-per-scenario design. |
| All `unused_class_members` flagged by fallow on service classes | **FP #3 (service-registry dispatch)**. Verified via `grep ctx.services` in workers — every flagged method is reachable. Routed to `/fallow-audit` config hardening. |

---

## Testability-bug rate (R8 watch)

**0 / 6 = 0 %.** Within budget. R8 not triggered.

This is the lowest test-bug rate the cycle could produce — every finding mapped cleanly onto Catalogue row 12 (clone-count assertion) or row 1 (parity) per the simplification-phase convention.

---

## Recurrence ledger updates

| Fingerprint | This cycle | Cumulative hits | Status |
|---|---|---|---|
| `simplification:duplicate-utility-helper` | F1, F5 (sub-fingerprints `:request-id`, `:bump-with-logger`) | 1 (parent) / 2 (sub-rows) | NEW |
| `simplification:dup-procedure-context-builder` | F2 | 1 | NEW |
| `simplification:dup-paginated-list-shape` | F3 | 1 (cycle_density=6) | NEW; **cycle_density watch** |
| `simplification:dup-image-pipeline` | F4 | 1 | NEW |
| `simplification:dup-fetch-with-without-scope` | F6 | 1 | NEW |

Notes for the recurrence-promotion mechanism:

- `simplification:dup-paginated-list-shape` (F3) has cycle_density=6 in a single cycle — equivalent to the profile that triggered R12's "endemic single-cycle 5-hit" promotion in iter-007. **Recommend: 2-hit early promotion path watch** for the next simplification cycle if any new list-method paginated shape is added.
- `simplification:duplicate-utility-helper` is a parent fingerprint that may absorb future sub-rows. Watch for hits=3 across iter-010+.
- No 3rd-hit recurrences this cycle (the `types:as-cast-without-guard` and `types:as-unknown-as` watches at hits=2 are types-phase fingerprints — out of scope for simplification).

---

## Master.md update (proposed; the dispatching skill applies it)

- **Table A**: row `simplification × packages` → `last_run = iter-009 (2026-04-25)`, `open_findings += 6`, `last_checked = 2026-04-25`, `next_due = "skipped (no churn since iter-009)"`.
- **Table B**: 5 new fingerprint rows (F1–F4 + F6; F5 shares parent with F1).
- **Table C**: append `iter-009 | 6 | 0 | 0% | within budget`.
- **R7 promotion section**: no new promotions queued.
- **Audit history**: append iter-009 row.
- **Stop-criterion countdown**: `simplification × packages` 0/3 (this cycle produced findings; counter starts).

---

## Next-cycle prep

- **Suggested next cell**: `simplification × workers` (continuity — workers already had a major waitUntil sweep in iter-008; the `procedure()`/`upload-shared` sites this cycle flagged are reused by every worker and the workers cycle would bring the consumers under the same eye). Alternatives: `simplification × apps/web` (no prior touch; heavy churn surface; could pair with the existing /design-system loop). Tie-break: `simplification × workers` keeps cycle scope manageable and continues the F1+F2 worker-utils thread.
- **Promotion watches**:
  - `simplification:dup-paginated-list-shape` cycle_density=6 → endemic-density 2-hit early promotion candidate.
  - `simplification:duplicate-utility-helper` parent → standard 3-hit watch.
- **Carry-forward types-phase watches** (still active):
  - `types:as-unknown-as`, `types:as-cast-without-guard` at hits=2 — one more cycle hit triggers R7 standard 3-hit promotion.
  - `types:redundant-cast-after-narrow` (cycle_density=6 in iter-006) — endemic shape, watch for 2nd hit.
- **Doc-rot fixes carry-forward** (Codex-ttavz.3-6, .10-11) — when these land, re-run cycle-0 fabrication checks on affected cells.
- **Add new rows to ref 03 §7 + ref 07 §7 anti-pattern tables** for the 5 new fingerprints filed this cycle.
- **Iter-009 fix entanglement**:
  - F1 + F2 both touch `packages/worker-utils/src/{middleware,procedure/{procedure,helpers,upload-shared}}.ts` — the two fixes consolidate into one PR (or one PR with two commits) to avoid double-touching.
  - F5 (move `bumpWithLogger` to `@codex/cache`) edits 3 packages: `cache`, `content`, `subscription`. One PR.
  - F3 (paginated helper) edits 3 packages: `content`, `notifications`, `database` (or `worker-utils`). One PR.
  - F4 + F6 are file-local; no cross-package entanglement.

---

## Output contract — final summary

```
Audit complete: docs/denoise/iter-009.md written.
6 findings (0B/4M/2m), 0 testability-bugs (0%), 6 proof tests in
packages/{worker-utils,content,image-processing,subscription,transcoding}/src/__denoise_proofs__/iter-009/.
Fabrication check: 38/38 rows live (0 stale).
```
