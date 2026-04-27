# Triage iter-003 — 2026-04-27

> Auto-loop iteration. Policy override: prefer rung 0/1 only; skip rung 2+ (defer to human).

## Cycle context

- **Brief flagged a likely misclassification** from iter-002: Codex-y6x9j was rung-4'd on a `.env` keyword false-positive but the actual fix is a single-site mechanical helper-extract.
- **Eligibility filter** (per §0 + cycle policy): identical to iter-002 minus Codex-fcdkk (closed) — eligible queue ≈ 27 beads, of which 0 were classified rung-1 in iter-002's snapshot. Codex-y6x9j is the candidate the brief asked us to re-examine.

## Step 1 — Classify (targeted re-classify)

**Codex-y6x9j re-read.** `bd show Codex-y6x9j --json`:
- Title: `simplify(organization-api/settings): invalidateBrandAndCache has another inline slug-resolve site`
- Description cites a single file:line (`workers/organization-api/src/routes/settings.ts:183-218`), describes a known recipe ("replace the inline block with a call to invalidateOrgSlugCache(...)"), references an existing R-rule (R14), and points at a helper that already exists in `@codex/worker-utils`.

**Cross-check 1**: `grep -rn "invalidateOrgSlugCache" packages/worker-utils/src/` → helper exists at `packages/worker-utils/src/cache-fanout.ts:43` with signature `({ db, cache, orgId, logger? })`.

**Cross-check 2**: open `workers/organization-api/src/routes/settings.ts:177-201`. The inline block is exactly:

```ts
if (ctx.env.CACHE_KV) {
  try {
    const db = createDbClient(ctx.env);
    const org = await db.query.organizations.findFirst({
      where: eq(schema.organizations.id, orgId),
      columns: { slug: true },
    });
    if (org?.slug) {
      const cache = new VersionedCache({ kv: ctx.env.CACHE_KV });
      await cache.invalidate(org.slug);
    }
  } catch {
    // Non-critical — slug cache expires via TTL if the await path fails.
  }
}
```

Helper signature semantically equivalent: same `findFirst`, same `cache.invalidate`, same try/catch swallow, accepts an optional `logger` (we pass `obs`). One call site. No surrounding code changes needed.

**Cross-check 3**: `workers/content-api/src/routes/content.ts:76` already uses `invalidateOrgSlugCache({ db, cache, orgId, logger: obs })` — identical shape.

**Verdict**: rung-1 mechanical helper-extract. iter-002's rung-4 was a false-positive on a `.env`-shape regex (the description text mentioned `cache.invalidate` and the bead body ran past 12 lines, two signals the iter-002 classifier conservatively used to suspect high-impact). Re-classified rung-1.

## Step 2 — Pick

**Codex-y6x9j** (P2, bug type, single file, fits proof shape `consumer-count` against existing iter-011 F2 proof).

## Step 3 — Pre-flight gate

`bd show Codex-y6x9j --json` re-read at top of cycle. Description unchanged. Status open. Owner `brucemckayone@gmail.com`. No drift.

## Step 4 — Resolve (rung 1)

Edit shape: import-add + 13-line block replacement in 1 file.

### Files edited

- `workers/organization-api/src/routes/settings.ts`:
  - Import line 44 widened to add `invalidateOrgSlugCache` from `@codex/worker-utils`.
  - Lines 187–201 (inline `try/findFirst/invalidate` block) replaced with:
    ```ts
    if (ctx.env.CACHE_KV) {
      const db = createDbClient(ctx.env);
      const cache = new VersionedCache({ kv: ctx.env.CACHE_KV });
      await invalidateOrgSlugCache({ db, cache, orgId, logger: obs });
    }
    ```
  - Inline comment widened to reference R14 (denoise iter-011 promoted rule).
- `workers/organization-api/src/__denoise_proofs__/iter-011/F2-dup-slug-resolve-invalidate.test.ts`:
  - SITES array extended to include `settings.ts` so the proof test now covers all 3 historical inline sites.
  - Header comment updated to reflect the third site.

`eq` and `schema` imports preserved (still used by `updateBrandCache`, lines 109/130).

### Diff stat

```
 .../F2-dup-slug-resolve-invalidate.test.ts         |  6 +++++-
 workers/organization-api/src/routes/settings.ts    | 24 +++++++++-------------
 2 files changed, 15 insertions(+), 15 deletions(-)
```

## Proof

Two-part proof:

1. **Static `consumer-count` shape (extended iter-011 F2 proof test)**:
   - SITES array: `content.ts`, `members.ts`, `settings.ts`.
   - Regex `/db\.query\.organizations\.findFirst\([\s\S]{0,200}?columns:\s*\{\s*slug:\s*true\s*\}/g`.
   - Pre-fix: 1 offender in `settings.ts:189-194`. Post-fix: 0 offenders across all 3 sites.
   - `pnpm exec vitest run src/__denoise_proofs__/iter-011/F2-dup-slug-resolve-invalidate.test.ts` → **1 test passed (1)**.
   - Note: `updateBrandCache` (lines 129-135) uses `columns: { slug: true, logoUrl: true }` — the regex requires `}` directly after `slug: true`, so this is correctly NOT matched.

2. **Behaviour parity (existing settings.test.ts)**:
   - `pnpm exec vitest run src/__tests__/settings.test.ts` → **24 tests passed (24)**. No behavioural drift in any branding/contact/features endpoint.

## Step 5 — MCP gate

Bead carries no denoise label, no security/perf signal. Per §3 cycle action matrix, simplification-shaped fixes get a static-only verification (covered by proof test + typecheck above). MCP not required.

## Step 6 — Bead labels

```
bd label add Codex-y6x9j triage          ✓
bd label add Codex-y6x9j triage:rung-1   ✓
bd label add Codex-y6x9j triage:iter-003 ✓
bd close   Codex-y6x9j                   ✓ → status: Closed
```

## Step 7 — Recurrence increments

Two new pattern entries + one increment in `docs/triage/recurrence.json`:

- `route:self:promoted-helper-missed-call-site` (hits=1, new) — fingerprint for "denoise R-rule promoted, original proof test only covered N-1 of N call sites, follow-up bead picks up the missed site". Watch for ≥3 hits → propose proof tests enumerate ALL sites at promotion time.
- `signal:misclassification-keyword-false-positive` (hits=1, new) — meta-signal that the iter-002 classifier mis-routed Codex-y6x9j to rung-4 on keyword match against `.env`/cache patterns. ≥3 hits → require classifier to sample-read the cited file:line before any keyword-driven rung-4 routing.
- `signal:auto-loop-skip-rung-2-plus` (hits 1 → 2) — the auto-loop produced a successful rung-1 cycle this iter only because the brief explicitly hinted at a misclassified bead. Without that hint the cycle would have exited `{ok: false}`. One iter from promotion threshold.

No promotion threshold reached this iter (need 3+ hits in 6-cycle window).

## Step 8 — Re-classification record

Codex-y6x9j: rung-4 (iter-002) → rung-1 (iter-003). Reason: keyword-driven false positive in iter-002 classifier; re-read of the cited file:line + helper signature confirmed pure mechanical fit.

## Outcome

`{ok: true, autoResolved: true, beadId: "Codex-y6x9j", rung: 1}` — committed locally as a single triage commit (no `git push`, R4).
