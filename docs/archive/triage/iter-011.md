# iter-011 — rung 3 — Codex-x0pa (E2E subscription verification)

> Walk-only cycle. Forced rung-3 by parent (`--rung=3`). Default picker landed on
> Codex-x0pa (P0, top of rung-3 by `(priority DESC, age DESC)`); pre-flight gate
> passed (status=open, owner=current user, description not edited since
> 2026-04-05 filing). No collision: working tree contains zero `iter-011*`
> artifacts and no uncommitted hunks in master.md / recurrence.json — RT3
> protocol does not fire.

**Date**: 2026-04-29
**Mode**: walk-only (rung-3 never auto-resolves per R3)
**Bead**: Codex-x0pa — "Final verification: end-to-end Playwright test of full subscription flow"
**Rung**: 3 (Multi-file / Reasoned)
**Outcome**: needsUser. 4 routing options framed. No bead state change beyond label attach.

---

## Bead summary

> **Codex-x0pa** (P0 task, owner brucemckayone@gmail.com, filed 2026-04-05) — Complete E2E
> Playwright MCP test of 10 sequential subscription flows:
>
> 1. Org owner connects Stripe
> 2. Creates 3 tiers
> 3. Assigns tier to content
> 4. Customer views pricing page
> 5. Subscribes to tier
> 6. Accesses tier-gated content
> 7. Sees subscription in library with badge
> 8. Uses **Free for me** toggle
> 9. Manages subscription in account page
> 10. Cancels subscription
>
> "All 10 steps must pass. VERIFY: Every step visually confirmed via Playwright
> screenshots." Single-blocker dependency Codex-eejz (code-review pass) is **closed**
> 2026-04-08, so the bead is dependency-free.

## Why this bead over the other rung-3 candidates

| Candidate | Reason picked / skipped |
|---|---|
| **Codex-x0pa (P0)** | **Picked.** Default picker rule: lowest non-empty rung (3), then `(priority DESC, age DESC)` → P0 wins. Pre-flight gate passes (status=open, owner=current user, no `triage:in-progress-other-agent` label, dependency Codex-eejz is closed). No structural skip applies. |
| Codex-6axi0 (P1) | Excluded per snapshot — blocked by Codex-zp30d. |
| Codex-i49f (P1) | Skipped — also browser-MCP-gated and dependency-tied per iter-009a notes. |
| Codex-u498 (P1) | Skipped — same shape as x0pa (Chrome DevTools + 21 manual steps). |
| Codex-70xgd (P3, needs-design) | Skipped — already labelled `triage:needs-design` after iter-010a; awaiting user routing. |

iter-009a previously skipped x0pa as "rung-4 in disguise" because no sub-agent in that
cycle had the browser MCP. iter-011 retains the rung-3 classification from the iter-010
snapshot — the bead has 10 enumerable flows with concrete UI surfaces, so framing
approach options is mechanical even from a read-only sub-agent. The actual *execution*
of any chosen option will need playwright MCP in the executing session.

## Pre-flight gate — bead claims vs codebase reality

Cross-checked each of the 10 flow steps against the existing codebase + e2e suite +
seed fixtures. Results below — they materially shape the available options.

### Flows with PRODUCTION CODE in place

| Step | Surface | Locator |
|---|---|---|
| 1. Connect Stripe | Studio monetisation page, Connect Stripe card + onboarding return-flow | `apps/web/src/routes/_org/[slug]/studio/monetisation/+page.svelte:325` |
| 2. Create 3 tiers | Same monetisation page, tier CRUD UI | `apps/web/src/routes/_org/[slug]/studio/monetisation/+page.svelte` (tier section) |
| 3. Assign tier to content | Studio content editor → tier selector | grep `tier` in `apps/web/src/routes/_org/[slug]/studio/content/` |
| 4. View pricing page | Org pricing page (per-tier cards) | `apps/web/src/routes/_org/[slug]/(space)/pricing/+page.svelte` |
| 5. Subscribe to tier | Pricing CTA → Stripe Checkout | same page → `subscription.remote.ts createCheckout` |
| 6. Access tier-gated content | Content detail page tier-gate check | `apps/web/src/routes/_org/[slug]/(space)/c/[slug]/+page.server.ts` (via @codex/access) |
| 7. Library badge | Library card subscription badge | `apps/web/src/routes/(platform)/library/` |
| 9. Manage subscription | Account subscriptions page | `apps/web/src/routes/(platform)/account/subscriptions/` |
| 10. Cancel subscription | Same account page (per `account-subscription-cancel.spec.ts`) | `apps/web/e2e/account-subscription-cancel.spec.ts` already covers |

### Flow step that DOES NOT EXIST in code

**Step 8 — "Free for me" toggle**: zero matches across `apps/`, `packages/`, `workers/` for
the strings `Free for me`, `free-for-me`, `freeForMe`, `FreeForMe`, `allowFree`, `freeAccess`.
The bead description is the **only place in the codebase** that mentions this concept
(verified via `bd list --desc-contains` + repo-wide grep). This is either:
- (a) A planned feature that was never implemented (likely — bead filed 2026-04-05; the
  audio-player and commerce-audit epics shipped 2026-04-10/14 without it; subscription
  cache audit 2026-04-22 also doesn't reference it), or
- (b) A creator-side affordance that lives under a different name (e.g., the
  `@codex/admin` `customer-management-service` `tierGated` semantics — but that's an
  admin override, not a customer-facing toggle), or
- (c) Stale specification from a pre-implementation product brief.

The bead's "all 10 steps must pass" framing implies (a)/(c). Either way, **the verification
test as filed cannot pass** without first either implementing the toggle or removing/renaming step 8.

### Flow steps with EXISTING e2e SPEC COVERAGE

`apps/web/e2e/` has substantial subscription coverage already:

| Spec | Lines | Covers |
|---|---|---|
| `account-subscription-cancel.spec.ts` | 291 | Step 10 — cancel + optimistic CANCELLING flip + persistence |
| `subscription-cross-device.spec.ts` | 186 | Cross-device cancel state propagation (visibility-change → invalidate) |
| `pricing-reactivate.spec.ts` | 254 | CANCELLING badge + reactivate flow on org pricing page (gated by Codex-z1wuz blocker → `test.skip`) |
| `subscription-paused-resumed.spec.ts` | 201 | Paused → resumed roundtrip (gated by Codex-z1wuz → `test.skip`) |
| `streaming-revocation.spec.ts` | 314 | Revocation propagation to streaming URL minting (step 6 gate) |
| `progress-save-access-gate.spec.ts` | 273 | Access gate on progress save (step 6) |
| `studio/content.spec.ts` | 234 | Studio content CRUD (step 3 surface) |
| `studio/settings.spec.ts` | 268 | Studio settings (step 1 surface — Stripe Connect lives elsewhere) |

What is **NOT** covered in any existing spec (per grep across the e2e tree):
- **Step 1**: org-owner connects Stripe (Connect onboarding redirect + sync return)
- **Step 2**: creating 3 tiers via studio UI (tier creation form)
- **Step 3**: assigning a tier to content via the studio content editor
- **Step 4–5**: viewing the org pricing page + subscribe button → Stripe Checkout completion
- **Step 7**: library badge confirmation post-subscribe
- **Step 8**: (does not exist)

### Seed fixture state

`packages/database/scripts/seed/commerce.ts` already creates `viewer@test.com` with an
ACTIVE Standard subscription on studio-alpha. The existing specs use this fixture
because re-running the full register → onboard → tier-create → subscribe flow in every
test is slow + flaky. **A "full" 10-step E2E that fakes nothing would deliberately bypass
that fixture and exercise the real path end-to-end, which is the bead's stated goal
("real session through the normal login flow", per the inherited spec convention).**

### Codex-z1wuz blocker

Two of the most-relevant existing specs (`pricing-reactivate.spec.ts`,
`subscription-paused-resumed.spec.ts`) are **currently `test.skip`** waiting for
**Codex-z1wuz** — the synthetic `stripeSubscriptionId` in the seed fixture 404s when
real Stripe API calls are made. Until z1wuz lands, ANY x0pa test that hits the real
Stripe API after step 5 is going to fail at step 9 (cancel = Stripe API call).

I did NOT verify Codex-z1wuz's current status this cycle (no time budget — this is
walk-only). **The user should treat z1wuz as a likely upstream blocker for the apply
phase regardless of which option is chosen.**

## Surface map — files × packages

| Layer | Surface | File count |
|---|---|---|
| Frontend routes | `apps/web/src/routes/_org/[slug]/studio/monetisation/`, `(space)/pricing/`, `(space)/c/[slug]/`, `(platform)/account/subscriptions/`, `(platform)/library/` | ~12 page/server files |
| Remote functions | `apps/web/src/lib/remote/subscription.remote.ts`, `tier.remote.ts`, `content.remote.ts` | ~3 files |
| Backend services | `packages/subscription/`, `packages/access/`, `packages/content/` (tier assignment), `packages/admin/` (customer override) | ~4 packages |
| Workers | `workers/ecom-api/` (checkout, webhooks), `workers/content-api/` (streaming gate) | 2 workers |
| Test fixtures | `packages/database/scripts/seed/commerce.ts`, `apps/web/e2e/fixtures/`, `apps/web/e2e/helpers/` | ~3 files |
| Existing E2E specs | `apps/web/e2e/*.spec.ts` (8 subscription-relevant), `studio/*.spec.ts` (3 relevant) | ~11 specs |
| New E2E spec target | `apps/web/e2e/subscription-full-flow.spec.ts` (does not yet exist) | 1 file |

**Cross-package impact**: any changes to seed fixtures land in `@codex/database` and
ripple to every test consumer. The new spec itself is single-file in `apps/web/e2e/`.

## Prior-art search

```
git log -S 'free-for-me' --all  → 0 matches
git log -S 'Free for me' --all  → 0 matches
git log -S 'freeForMe' --all    → 0 matches
git log --oneline -S 'Connect Stripe'  → 5 commits (subscription scaffolding; no
                                          full-flow E2E spec landed)
git log --oneline -S 'Codex-x0pa' --all → 0 commits cite the bead
```

**No fully-staled-by-sibling outcome** (per `signal:bead-fully-stale-already-resolved-by-sibling`,
hits=1 → close-as-duplicate option N/A here).

The closest prior art is the cluster of single-flow specs landed during the
subscription-cache-audit epic (PR 1: `account-subscription-cancel.spec.ts`,
`subscription-cross-device.spec.ts`; PR 2: `pricing-reactivate.spec.ts`,
`subscription-paused-resumed.spec.ts`, `streaming-revocation.spec.ts`). They demonstrate
the **per-flow spec convention** the team has actually adopted — none of them attempt a
single 10-step monolith. This is signal that Option B (split into per-flow specs) is
the team's *de facto* current strategy.

## Approach options enumerated

Each option has a ≤2-sentence tradeoff and a concrete next-action. Step 8 ("Free for me")
is the load-bearing constraint — every option has to address whether it's deferred,
removed, or implemented.

### Option A — One PR: single monolithic spec (NOT RECOMMENDED — diverges from team convention)

**Scope**: write `apps/web/e2e/subscription-full-flow.spec.ts` with all 10 steps in one
sequenced test. Step 8 is `test.skip(true, 'Free for me toggle does not exist; bead spec
stale')`. Spec does NOT use the seeded fixture — exercises register → onboard → tier
create → assign → subscribe → cancel from scratch.

**Tradeoff**: matches the bead's literal "all 10 steps in one E2E" framing but goes
against the team's per-flow convention; one flaky step causes the whole spec to fail;
~2-day implementation including z1wuz unblock investigation.

**Apply produces**: 1 new spec file, ~600–1000 LOC, requires playwright MCP session.
Likely blocked by z1wuz and step-8 stale spec.

### Option B — Split into per-flow specs (RECOMMENDED — aligns with team convention)

**Scope**: file 4 child beads via `bd create` covering the genuinely-uncovered flows,
close x0pa as the umbrella once children land:
- **Codex-x0pa.1** — `studio-stripe-connect.spec.ts` (step 1 — Connect onboarding redirect + return-flow sync)
- **Codex-x0pa.2** — `studio-tier-management.spec.ts` (steps 2 + 3 — tier CRUD + assign-to-content)
- **Codex-x0pa.3** — `subscription-purchase-flow.spec.ts` (steps 4 + 5 + 6 + 7 — pricing → checkout → gated content → library badge)
- **Codex-x0pa.4** — Resolve "Free for me" toggle: file as `bd create` for product
  decision (implement / rename / drop step 8). Until decided, no e2e exists.

Step 9 + 10 are already covered by `account-subscription-cancel.spec.ts` — no new spec needed.

**Tradeoff**: matches team convention; each child PR mergeable independently; step 8
ambiguity surfaces as its own bead instead of blocking the whole thing. Cost: more
bead-management overhead; user has to make the step-8 product call.

**Apply produces**: 4 new beads filed; x0pa relabelled `triage:routing:split`; future
cycles drain x0pa.1/x0pa.2/x0pa.3 (rung-2 each). x0pa itself stays open as the umbrella
until all 4 close.

### Option C — Spawn `/backend-dev` (or `/pipeline-prep`) for the whole thing

**Scope**: route x0pa to `/backend-dev` (the owning skill for `apps/web/e2e/` per its
description: "the SvelteKit server layer … `apps/web/src/routes/**/+*.server.ts`, or
`apps/web/src/lib/remote/`"). `/backend-dev` runs the apply phase end-to-end with
playwright MCP, decides A vs B internally, and resolves z1wuz + step-8 as part of the
work.

**Tradeoff**: zero cost in this session; defers strategy choice to the executing skill;
the user retains a single greenlight gate at `/backend-dev` invocation. Cost: x0pa
remains P0 open until next `/backend-dev` session.

**Apply produces**: bead labelled `triage:routing:backend-dev`. User invokes
`/backend-dev` next session. No new specs this cycle.

### Option D — Defer

**Scope**: leave bead at rung-3, no labels added beyond the iter-011 attribution.
Re-considered next cycle.

**Tradeoff**: zero work; the P0 priority signals this is a release-blocker so deferring
indefinitely is a real cost. Useful only if z1wuz blocker is itself indefinitely-deferred
or if the user wants to revisit the step-8 product question elsewhere first.

**Apply produces**: nothing. x0pa stays open at rung-3.

## Question payload (returned to parent)

```json
{
  "question": "Codex-x0pa (P0) is a 10-step E2E subscription verification. Step 8 ('Free for me' toggle) does not exist in code (zero grep hits). Steps 9-10 already covered by existing specs. Pricing/cancel/paused specs are test.skip behind Codex-z1wuz (synthetic stripeSubscriptionId blocker). How to proceed?",
  "header": "Rung-3 routing — x0pa subscription E2E",
  "options": [
    { "label": "Split into per-flow specs (Recommended)", "next": "split-4" },
    { "label": "One monolithic spec", "next": "one-pr" },
    { "label": "Spawn /backend-dev", "next": "spawn-backend-dev" },
    { "label": "Defer", "next": "defer" }
  ]
}
```

## Files affected (preview — no edits this cycle)

Walk-only cycle. Three artifact files updated:
- `docs/triage/iter-011.md` (this file, NEW)
- `docs/triage/master.md` (cycle-history row appended; ladder snapshot UNCHANGED — bead remains rung-3 open)
- `docs/triage/recurrence.json` (1 fingerprint bumped, 1 new fingerprint surfaced)

Zero source-file edits.

## Recurrence ledger

This bead surfaces TWO fingerprint signals worth tracking:

1. **`signal:bead-cites-nonexistent-feature`** (NEW, hits=1). Distinct from
   `signal:bead-description-self-contradicts-codebase` (the cited symbol exists but the
   doc claim is stale) and `signal:bead-description-partially-stale` (some sub-items
   shipped). Here, an entire sub-item ("Free for me toggle") refers to a feature with
   ZERO repo-wide footprint — likely a stale spec from a pre-implementation product
   brief. Recipe candidate: cycle agent should `grep -ri '<distinctive sub-item phrase>'
   apps/ packages/ workers/` for each sub-item BEFORE framing options; if a sub-item
   returns 0 matches, surface it as an explicit "missing-feature" sub-question rather
   than absorbing it into the generic "split vs one-PR" axis.

2. **`signal:bead-description-partially-stale`** (existing, currently hits=1 with same-bead
   doubled verdict_history). This bead has the same shape — sub-items 9 and 10 are already
   covered by existing specs (PR 1 of subscription-cache-audit), making them stale
   in the same sense as Codex-d3g6 sub-item (1). **Bumping to hits=2 (iter-009a Codex-d3g6,
   iter-011 Codex-x0pa)** moves the fingerprint one step from the 3-distinct-bead
   promotion threshold.

## Constraints honoured

- Read-only on production code: confirmed (only the 3 artifact files written this cycle).
- No nested agents spawned.
- No `AskUserQuestion` called from this sub-agent (R9): confirmed.
- Iter-010-apply ladder snapshot ownership: not touched (cycle-history row appended only;
  rung-3 count remains 21 because x0pa stays rung-3 open).
- RT3 collision check: working tree contains no `iter-011*` artifacts and no uncommitted
  hunks in master.md/recurrence.json — no collision detected, suffix protocol does not fire.
- No `git push`.
