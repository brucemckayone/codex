# 01 — Complexity Ladder

The 5-rung ladder is the heart of the classifier. Every open bead lands on exactly one rung. Picking the wrong rung is the most common failure mode, so this file is the definitive reference — the cycle agent reads it on every invocation.

## Rung definitions

### Rung 0 — Trivial

A fix that touches 1 line in 1 file, has no semantic ambiguity, and would be embarrassing to ask a human about. The question "could a careful regex do this?" returns yes.

**Examples**
- Typo in a string literal (the canonical case: `forgot` → `forget`).
- Comment grammar fix.
- Removing a leftover `console.log` or `debugger;` not behind a feature flag.
- Removing an unused import where the import has no side effects.
- Renaming a variable in one function where the name is misleading.

**Signals**
- Bead description fits in 2–4 lines.
- Cites exactly one `file:line`.
- Description verbs are: "rename", "fix typo", "remove `<thing>`", "delete unused".
- Touched file is not in the high-impact list (see §High-impact paths).
- No ambiguity in what the new value should be.

**Cycle action**: Auto-fix, snapshot or string-equality proof test, ask user before commit (R4).

### Rung 1 — Mechanical

A fix that follows a fixed recipe. The judgement was already made elsewhere (a denoise rule, a lint rule, a documented pattern); the resolver just applies the recipe. A careful junior engineer with 30 minutes does this without asking questions.

**Examples**
- `as unknown as X` removal where the codebase already has a Zod parser at the boundary (the cast is dead).
- Unused export deletion (`fallow dead-code` confirmed; consumers = 0).
- Simple dedupe: two functions with byte-identical bodies in the same package → keep one, delete the other, update the lone import.
- Lint-rule violation fix where the rule's autofix would do the right thing but isn't enabled.
- Adding a missing `triage:rung-N` label to a bead that the classifier just classified.
- Replacing `process.env.X` with `env.X` from a typed env object that already exists.
- Adding a missing `await` on a fire-and-forget that already has its `waitUntil` wrapper.

**Signals**
- Bead matches a known denoise fingerprint (`denoise:types:as-cast-without-guard`, `denoise:simplification:duplicate-utility-helper`, etc.).
- Cites 1–2 file:line locators.
- Description references an existing pattern in the codebase ("just like X in Y").
- Touches files in `packages/<svc>/src/`, `workers/<w>/src/`, or `apps/web/src/lib/utils/` — not schema, not security, not config.
- A proof shape from §Proof shapes exists and fits the fix.

**Cycle action**: Auto-fix via `triage-resolve-mechanical` agent, proof test via the matched shape, commit on green.

### Rung 2 — Scoped

A fix that is single-file or near-single-file but requires judgement: which approach is right, what edge case to handle, what test asserts the right invariant. A human should look at the diff before it lands.

**Examples**
- Adding a new validation case to an existing Zod schema.
- Tightening a service method's input type from `string` to a discriminated union.
- A bug fix where the description is clear but the fix has 2 plausible shapes (handle at boundary vs deep in service).
- A test stub (`test.todo` or empty `it`) that needs a real assertion.
- Migration of a single component from `$page` to `page` from `$app/state`.

**Signals**
- Bead description is 5–15 lines and includes "should" / "needs to" language indicating intent.
- Cites 1–3 file:line locators in the same package.
- Touches business logic, not just plumbing.
- May have a `denoise:simplification` or `denoise:types` label but the pattern requires reading surrounding code.

**Cycle action**: Resolver produces a candidate diff in read-only mode, returns to the parent. Parent surfaces diff via `AskUserQuestion(apply/skip/reroute)`. On `apply`, the parent re-dispatches the cycle agent with `--apply --bead=X` for a second pass that commits.

### Rung 3 — Multi-file / Reasoned

A fix that touches 3+ files, crosses package boundaries, or requires choosing between architecturally distinct approaches. The bead is well-defined but the *how* is open.

**Examples**
- Refactor: a service method needs to move from package A to package B because the dependency direction is wrong.
- A bug that manifests in apps/web but the fix has to land in `@codex/security` and propagate.
- "Add a new endpoint" with no existing pattern to copy.
- "Make X work like Y" where Y is non-trivial and there are 2+ valid interpretations.
- A bead description with no `file:line` and >3 lines of body (R8 escalation).

**Signals**
- 3+ file references, OR cross-package impact, OR ambiguous spec (multiple valid implementations).
- Bead may already carry a `triage:routing:backend-dev` label from an earlier cycle's recurrence ledger.
- Description starts with "We need to…" rather than "Replace X with Y".

**Cycle action**: Stop. Return `{needsUser: true, rung: 3, options: [...]}` with options like:
- "One PR, recommended approach (a)"
- "Split into N sub-beads via `bd create`"
- "Defer / spawn `/backend-dev`"
- "Defer / spawn `/design-system`"

Parent invokes `AskUserQuestion`. On user choice, parent routes (no auto-resolve at rung 3 ever — R3).

### Rung 4 — Design-needed

A fix that requires a design decision a human has to own: schema shape, UX choice, security/auth boundary, multi-system contract, epic-level work.

**Examples**
- "Add a new enum value to `MembershipRole`" → schema migration + downstream type fan-out + UX implications.
- Any epic encountered as the picked item (R7).
- "Choose between WebSocket and SSE for real-time updates."
- "Decide pricing tier semantics for org subscriptions."
- Anything touching `packages/security/`, `packages/database/schema/`, `*-secrets*`, or `.env*`.
- A bead labelled `ds-review:*` with severity `blocker` or `major`.

**Signals**
- `issue_type=epic`.
- Touches a high-impact path (see below).
- Bead body explicitly asks "what should this look like?" or "which option is better?".
- Recurrence ledger has `route:design-system:<x>` or `route:backend-dev:<x>` flagged for this fingerprint.

**Cycle action**: Stop. Return `{needsUser: true, rung: 4, options: [...]}` with options like:
- "Spawn `/backend-dev` for implementation guidance"
- "Spawn `/design-system` for visual/component guidance"
- "Split epic into N children via `bd create`"
- "Defer — leave the bead in queue, next cycle skips"

## Classifier ordering (first match wins)

The classifier walks each bead through these rules in order:

1. **Promoted routing rule** (`references/02-routing-rules.md`) — if a recurrence pattern matched this bead's fingerprint, use the rule's verdict.
2. **Hard rule R7** — `issue_type=epic` → check unblocked children. If children exist at lower rungs, tag epic as `delegate-to-child` with `lowestChildRung`. Otherwise rung 4.
3. **Hard rule R8** — no `file:line` AND body < 3 lines → rung 3.
4. **High-impact path detection** — any cited path is in the high-impact list → rung 4.
5. **Denoise fingerprint match** — `denoise:types:as-cast-without-guard`, `denoise:simplification:duplicate-utility-helper`, etc. → rung 1 (each fingerprint maps to a default rung documented below).
6. **Single-line, single-file, no ambiguity** → rung 0.
7. **1–2 cited paths, fits a known proof shape** → rung 1.
8. **1–3 cited paths in same package, requires judgement** → rung 2.
9. **3+ files OR cross-package** → rung 3.
10. **Anything else** → rung 3 with `low-confidence` flag (cycle agent decides whether to escalate).

## High-impact paths (auto-rung-4)

These paths trigger rung 4 regardless of fix size:

```
packages/security/                       # auth, scoping, HMAC
packages/database/schema/                # any schema migration
*-secrets*                               # secret handling
.env*                                    # env config
packages/database/src/migrations/        # generated migration SQL
apps/web/src/hooks*                      # SvelteKit hooks (SSR-critical)
workers/*/wrangler.toml                  # worker config
.github/workflows/                       # CI config
```

Add to this list as the recurrence ledger surfaces new high-impact patterns.

## Denoise fingerprint → default rung

When a bead carries one of these labels, classifier assigns the indicated rung unless an override applies (cited paths in high-impact list, multi-file, etc.):

| Fingerprint | Default rung | Notes |
|---|---|---|
| `denoise:types:as-cast-without-guard` | 1 | R15 promoted; recipe is "remove cast or replace with Zod parse at boundary" |
| `denoise:types:as-unknown-as` | 1 | R16 queued (iter-031); recipe is "reach for safer narrow" |
| `denoise:types:type-duplicate-cross-package` | 2 | R11 promoted but each instance needs judgement on which package owns the type |
| `denoise:simplification:duplicate-utility-helper` | 1 | R14 promoted; mechanical dedupe |
| `denoise:simplification:dup-content-item-shape` | 2 | Watch pattern; needs review of which fields the shared shape keeps |
| `denoise:performance:sequential-await-independent-queries` | 1 | R12 promoted; mechanical `Promise.all` rewrite |
| `denoise:workers:waituntil-no-catch` | 1 | R13 promoted; mechanical `.catch(() => {})` add |
| `denoise:security:auth-endpoint-no-ratelimit` | 2 | R9 promoted but each endpoint needs review of which rate-limit profile fits |
| `denoise:security:missing-csp` | 4 | R10 promoted but CSP changes are user-facing and need design review |
| `denoise:security:missing-hsts` | 4 | Companion to CSP; same logic |

This table is owned by the recurrence ledger — when a new fingerprint promotes, add it here.

## Proof shapes (mirrors `/denoise` 12-row catalogue)

The resolver agent receives a `PROOF_SHAPE` argument and writes a test of that shape. Shapes:

| Shape | When | Example |
|---|---|---|
| `string-equality` | Rung 0 typo / value fix | `expect(result).toBe("forget")` |
| `snapshot` | Rung 0–1 output drift | `expect(rendered).toMatchSnapshot()` |
| `consumer-count` | Rung 1 unused export removal | `expect(consumersOf("X").length).toBe(0)` (custom helper) |
| `type-equality` | Rung 1 type narrowing | `expectTypeOf<X>().toEqualTypeOf<Y>()` |
| `lint-rule` | Rung 1 lint-violation fix | Add ESLint rule, assert it fires on pre-fix code, silent on post-fix |
| `route-map` | Rung 1 route consolidation | `expect(JSON.stringify(app.routes)).toMatchSnapshot()` |
| `behaviour-parity` | Rung 1 dedupe of byte-identical functions | Run both with N inputs, assert identical outputs |

For shapes that don't fit, the bead is misclassified — the resolver returns `{ok: false, reason: "no-proof-shape"}` and the cycle agent reclassifies to rung 2.

## Edge cases

- **Bead has multiple cited paths spanning rungs**: e.g., one rung-1-shaped path and one rung-3-shaped path. → Rung 3. The largest blast radius wins.
- **Bead description says "trivial"**: ignore the word. Classify on objective signals.
- **Bead is a follow-up to a closed bead**: walk the dependency chain. If the parent was rung 4, this is rung 3 by inheritance.
- **Bead has both `denoise:*` and `ds-review:*` labels**: the more conservative wins (rung 4 if either rules say rung 4).
