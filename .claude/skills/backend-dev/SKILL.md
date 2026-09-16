---
name: backend-dev
description: >
  Backend development for the Codex platform — Cloudflare Workers, service layer,
  security, Stripe integration, file uploads, observability, testing, and the SvelteKit
  server layer. Use when implementing new API endpoints, services, webhooks, worker-to-worker
  calls, file uploads, Stripe flows, or anything touching `workers/`, `packages/*/src/services/`,
  `apps/web/src/lib/server/`, `apps/web/src/routes/**/+*.server.ts`, or `apps/web/src/lib/remote/`.
allowed-tools: Read, Grep, Glob, Bash
---

# Backend Development — Codex Platform

This skill is the master reference for implementing backend features on the Codex
platform. It encodes the established patterns so they do not have to be re-explained
on every task.

The skill is **modular**: this entry point routes to the right reference document
based on what you are doing. Open only the references you need.

---

## 0. When This Skill Applies

Open this skill when any of these are true:

- Adding a new API endpoint on any worker
- Adding a new method to a service package
- Wiring a new webhook handler (Stripe, RunPod, Resend)
- Adding worker-to-worker HMAC-signed calls
- Adding a file upload endpoint (multipart, presigned URL, or binary)
- Adding a new Zod schema or validation helper
- Consuming new backend data from the SvelteKit server layer

If you are doing caching logic specifically, open the `caching` skill directly.
If you are working on TanStack DB collections, open the `tanstack-db` skill directly.

---

## 1. Hard Rules (Non-Negotiable)

These rules are enforced across every layer. Each has a dedicated reference if you
need the detail, but internalise these first:

| Rule | Why | Reference |
|------|-----|-----------|
| Every DB query is scoped by `creatorId` or `orgId` | Data exposure risk | `03-database-patterns.md` |
| Every endpoint uses `procedure()` with `policy.auth` | Missing auth = public data leak | `01-procedure-patterns.md` |
| All input validated with Zod via `input.body/params/query` | Unvalidated input reaches handlers | `05-validation-patterns.md` |
| Throw typed `ServiceError` subclasses, never raw errors | Error envelope integrity | `02-service-layer.md` |
| Use `ctx.services.*` from registry, never `new Service()` in routes | Lifecycle + cleanup | `02-service-layer.md` |
| `waitUntil()` all fire-and-forget work (cache bumps, emails) | Blocking the response wastes time | `01-procedure-patterns.md` |
| `dbWs` for transactions, `dbHttp` for reads | HTTP can't hold a transaction | `03-database-patterns.md` |
| Soft delete only (`deletedAt`), never hard delete | Data integrity + recovery | `03-database-patterns.md` |
| `scopedNotDeleted(table, creatorId)` on every read | Combines both rules above | `03-database-patterns.md` |
| Currency is GBP (pence), never USD | Single-currency platform | `06-stripe-integration.md` |
| No `console.log` — use `this.obs.*` via `BaseService` | Structured logs, PII redaction | `08-observability-patterns.md` |
| Never log PII (passwords, tokens, emails, full names) | Compliance | `08-observability-patterns.md` |
| Worker-to-worker calls use HMAC-SHA256 (`policy: { auth: 'worker' }`) | Authenticated inter-service | `04-security-patterns.md` |
| Never hand-write migration SQL — use `pnpm db:generate` | Drizzle owns the snapshot | `03-database-patterns.md` |
| Webhooks verify signature on RAW body (not parsed JSON) | Signature depends on exact bytes | `06-stripe-integration.md` |

---

## 2. The Master Workflow

Every backend feature follows the same 11-phase flow. The references deepen each phase.

```
Phase 1: Classify
  - What kind of change?
    - new endpoint / new service method / new webhook /
      worker-to-worker call / SvelteKit consumption
  - Which layers? (validation / service / route / client)
  - External services? (Stripe / R2 / RunPod / Resend)

Phase 2: Load References
  - See decision tree in section 3

Phase 3: Schema First
  - Define Zod schema in packages/validation/src/[domain].ts
  - Reuse primitives (priceCentsSchema, slugSchema, uuidSchema, paginationQuerySchema)
  - Reference: 05-validation-patterns.md

Phase 4: Service Layer
  - Extend BaseService (config: { db, environment })
  - Use obs via this.obs (auto-initialised by BaseService)
  - Transactions via this.db.transaction() — requires dbWs
  - Scope ALL reads with scopedNotDeleted() or withCreatorScope()
  - Throw typed ServiceError subclasses; wrap unknowns with this.handleError()
  - Reference: 02-service-layer.md

Phase 5: Security
  - Pick auth policy: required / optional / worker / platform_owner / roles / requireOrgMembership
  - Pick rate limit: auth (5/15min) / strict (20/min) / api (100/min) / streaming / web / webhook
  - For inter-worker: workerFetch on caller, policy.auth='worker' on receiver
  - Reference: 04-security-patterns.md

Phase 6: Route Handler
  - Use procedure() for JSON; multipartProcedure for FormData;
    binaryUploadProcedure for raw binary
  - Input validation slots: input.body / input.params / input.query
  - Return plain data — procedure() wraps it ({ data: T } or { items, pagination })
  - successStatus: 201 for creates; null return for 204
  - Reference: 01-procedure-patterns.md

Phase 7: Cache Strategy (if applicable)
  - LOAD the caching skill for decisions
  - Quick rule: write-through for known-writer critical-path data;
    cache-aside for high read/write ratio; TTL-only for aggregate derived data

Phase 8: Client Consumption (if applicable)
  - Server load: await critical for SEO, stream secondary with .catch()
  - Remote function: query() (cached reads) / form() (progressive enhancement) / command() (client-only)
  - For user-scoped data: consider localStorage collection
  - Reference: 10-sveltekit-server.md
  - For collections: LOAD the tanstack-db skill

Phase 9: Observability
  - Log via this.obs.info/warn/error with structured fields
  - Include correlation IDs (organizationId, userId, contentId); never PII
  - Reference: 08-observability-patterns.md

Phase 10: Test
  - Service unit test in src/services/__tests__/ with createUniqueSlug for unique fields
  - Worker integration test using env + SELF from 'cloudflare:test'
  - Mock externals (Stripe, R2, Resend); never mock the DB or services
  - Reference: 09-testing-patterns.md

Phase 11: Verify End-to-End
  - pnpm typecheck
  - pnpm check (Biome)
  - pnpm test --project @codex/<package>
  - Run the feature locally; confirm logs, cache behavior, response shape
```

---

## 3. Reference Router (Decision Tree)

Load references based on the task. Most features need 3–5 references, not all 10.

```
What are you doing?
│
├─ New CRUD endpoint (JSON)
│    → 01, 02, 03, 04, 05 (+ 09 for tests)
│
├─ File upload endpoint (logo, avatar, thumbnail, video)
│    → 07 (decision tree for 3 patterns)
│    → 01 (multipartProcedure/binaryUploadProcedure)
│    → 02 (service method for processing)
│
├─ Webhook handler (Stripe, RunPod)
│    → 06 covers Stripe signature verification + per-endpoint secret routing + handler shape
│    → 06 §7 "Permanent vs transient errors" + `isTransientError()` helper —
│      most webhook review findings cluster here
│    → 02 (per-request DB client lifecycle + `WebhookHandlerResult` return shape)
│    → Only load 04 if adding a NEW HMAC flow not covered by the Stripe webhook middleware
│    → RunPod specifically:
│        • `workers/media-api/src/middleware/verify-runpod-signature.ts` — reference impl (mirror of Stripe verifier)
│        • §6 Webhooks checklist applies identically (raw body, .catch on waitUntil, transient/permanent)
│        • Payload → Zod via `runpodWebhookSchema` (in `@codex/validation`)
│        • Pair with a cron recovery path (e.g. `recoverStuckTranscoding`) — the webhook may never fire
│
├─ Worker-to-worker internal call
│    → 04 (HMAC signing, workerFetch)
│    → 02 (service method usually wraps the call)
│
├─ New service method only (no new route)
│    → 02 (+ 05 if new input schema) (+ 09 for tests)
│
├─ Auth worker / BetterAuth / session cookies
│    → 04 is primary — session two-tier flow, KV TTL/invalidation, cookie handling, rate limit presets
│    → workers/auth/CLAUDE.md for BetterAuth-specific mounts
│    → Skip 01, 02 — BetterAuth bypasses procedure()
│
├─ SvelteKit server load / remote function consuming an API
│    → 10 (+ caching skill if cacheable)
│
├─ TanStack DB collection
│    → LOAD tanstack-db skill directly
│
├─ Caching layer (any cache — KV, HTTP, localStorage)
│    → LOAD caching skill directly
│
├─ Write tests only
│    → 09
│
├─ Payment / subscription / Connect / Stripe anything
│    → 06 (covers platform-specific usage)
│    → For generic Stripe best practices, LOAD stripe-best-practices skill
```

---

## 4. Reference Index

| # | File | Scope |
|---|------|-------|
| 01 | [procedure-patterns.md](references/01-procedure-patterns.md) | `procedure()`, multipart, binary, response envelope, policies, the 8-step pipeline |
| 02 | [service-layer.md](references/02-service-layer.md) | `BaseService`, service registry, transactions, scoped queries, error handling |
| 03 | [database-patterns.md](references/03-database-patterns.md) | `dbHttp` vs `dbWs`, scoping, soft delete, pagination, unique constraints, migrations |
| 04 | [security-patterns.md](references/04-security-patterns.md) | Auth policies, rate limits, worker HMAC, session validation, security headers |
| 05 | [validation-patterns.md](references/05-validation-patterns.md) | Zod schemas, shared primitives, sanitization, magic bytes |
| 06 | [stripe-integration.md](references/06-stripe-integration.md) | Checkout, subscriptions, Connect, webhooks, idempotency, revenue splits |
| 07 | [file-upload-patterns.md](references/07-file-upload-patterns.md) | Decision tree for multipart / binary / presigned URL; R2; image processing |
| 08 | [observability-patterns.md](references/08-observability-patterns.md) | `ObservabilityClient`, structured logging, PII redaction |
| 09 | [testing-patterns.md](references/09-testing-patterns.md) | Service tests, worker tests, E2E, factories, Neon branch strategy |
| 10 | [sveltekit-server.md](references/10-sveltekit-server.md) | Server loads, streaming, cache headers, `api.ts`, remote functions, hooks |
| 11 | [workers-runtime.md](references/11-workers-runtime.md) | Cloudflare Workers runtime characteristics — `waitUntil`, KV consistency, body caching, CPU/memory/subrequest limits |

## 5. External Skills to Cross-Load

- **`caching`** — full 5-layer caching decision framework (HTTP, KV, SvelteKit dedup, localStorage, version manifest)
- **`tanstack-db`** — client-side collections, live queries, mutations, hydration
- **`stripe-best-practices`** — generic Stripe SDK best practices (not Codex-specific)
- **`plan`** — architecture overview and 50-item implementation checklist

## 6. Review Checklist

Use this when reviewing a diff rather than implementing. It's deliberately short —
fuller context lives in the references. Run top-to-bottom against each changed file.

### Routes (`workers/*/src/routes/*.ts`)

- [ ] Every endpoint uses `procedure()` (or documented exception: webhook, BetterAuth, dev-cdn)
- [ ] `policy.auth` is set appropriately (`'required'` by default; `'none'`/`'optional'` only for public data)
- [ ] Rate limit preset set on any auth endpoint (`'auth'`), payment endpoint (`'strict'`), or webhook (`'webhook'`)
- [ ] `successStatus: 201` on POST-create; `204` on DELETE returning `null`
- [ ] List handlers return `new PaginatedResult(items, pagination)` — not a plain object
- [ ] Handler returns plain data (no manual `c.json(...)` or `{ data: ... }` wrapping)
- [ ] No `try/catch` swallowing errors — let them propagate to `mapErrorToResponse`
- [ ] Inter-worker URLs use `getServiceUrl(service, env)` — never a per-target `*_API_URL` env var
- [ ] Dev-only routes (e.g. `binaryUploadProcedure` fallbacks) guarded by `env.ENVIRONMENT !== 'production'` or not mounted in prod
- [ ] Idempotent completion endpoints return 200 with `{ ..., alreadyDone: true }` on already-advanced states — not 409

### Services (`packages/*/src/services/*.ts`)

- [ ] Extends `BaseService`; constructor calls `super(config)`
- [ ] Instantiated via `ctx.services.*` registry, never `new Service(...)` in routes
- [ ] Every DB query uses `scopedNotDeleted(table, ownerId)` or `orgScopedNotDeleted`
- [ ] Typed `ServiceError` subclass thrown (never raw strings or `new Error`)
- [ ] `this.handleError(err, context)` on catches of unknown errors (no silent swallows)
- [ ] Multi-row writes inside `db.transaction(async (tx) => ...)` using `tx`, not `this.db`
- [ ] Service methods accept already-validated input types — no re-running `schema.parse()` inside
- [ ] `this.obs.info/warn/error` on business events, never `console.log`

### Webhooks (`workers/*/src/handlers/*.ts`)

- [ ] Signature verified on raw body (`c.req.text()` before any JSON parse)
- [ ] Different secrets per path (`/booking`, `/payment`, `/subscription`, `/connect`)
- [ ] Metadata validated with Zod schema on receipt, not trusted as-is
- [ ] `createPerRequestDbClient` + `c.executionCtx.waitUntil(cleanup())` — never `await cleanup()`
- [ ] Cache invalidation via `waitUntil(cache.invalidate(...).catch(() => {}))` — MUST have `.catch()`
- [ ] Every `waitUntil(...)` call has `.catch(() => {})` — grep the file, not just the obvious sites
- [ ] Errors classified via `isTransientError()` helper; permanent errors return 200 `{ received: true }`
- [ ] Returns `{ received: true }` (200) for permanent errors; 500 only for transient
- [ ] Stripe/RunPod metadata validated with a Zod schema — never read raw `metadata.foo` directly
- [ ] Handler reads identity (userId, orgId) from the service's `WebhookHandlerResult`, NEVER from `event.data.object.metadata` — service layer is the single point of metadata validation; dual reads are a dual source of truth bug
- [ ] Stripe transfer errors classified via `err instanceof Stripe.errors.StripeConnectionError / StripeRateLimitError / StripeAPIError(5xx)` → re-throw (transient); all other Stripe errors → `pendingPayouts` (permanent)
- [ ] Service instantiation inside the handler mirrors the registry config — no duplicated env-var plumbing (e.g. `RUNPOD_DIRECT_URL` overrides honored equally)
- [ ] Every async flow has a cron/alarm recovery path for the case where the webhook never fires

### Validation (`packages/validation/src/**`)

- [ ] Schema defined in `@codex/validation`, not inline in route handler
- [ ] Uses shared primitives (`uuidSchema`, `urlSchema`, `priceCentsSchema`) — no ad-hoc regex
- [ ] SVG inputs go through `sanitizeSvgContent()`
- [ ] User URLs use `urlSchema` (not `z.string().url()`)
- [ ] Max lengths set on all free-text fields

### Observability & PII

- [ ] No `console.log` / `console.error`
- [ ] Log fields contain IDs only (userId, contentId, etc.) — no emails, tokens, or PII
- [ ] `this.obs.error` reserved for real failures (not 404/403 normal flow)
- [ ] `requestId` correlation propagated on worker-to-worker calls (`X-Request-Id` header)

### Auth worker / BetterAuth / session cookies

(BetterAuth is a documented `procedure()` exception — different rules apply.)

- [ ] Rate-limit path allowlist matches the framework's actual routes — not assumed naming. Grep the framework config or exercise the routes to confirm.
- [ ] Rate-limit preset `'auth'` (5 req / 15 min) applied to every login / register / reset / verify endpoint.
- [ ] Middleware wrappers don't double-`next()` — either `return innerMw(c, next)` OR `return next()`, never both.
- [ ] Session KV TTL capped at revocation-propagation SLA (e.g. `Math.min(300, ttl)`) — not session-lifetime.
- [ ] Sign-out path deletes `session:${token}` from `AUTH_SESSION_KV` — not just the DB row.
- [ ] Test/dev endpoints (fast-register, seed) hard-code minimum role OR require escalation secret — never trust body-provided `role`.
- [ ] Env guard (`ENVIRONMENT !== 'production'`) on every test/dev endpoint, at module init AND per-request.
- [ ] Cookie attributes: HttpOnly, Secure (prod), SameSite, correct `.domain` for cross-subdomain sharing.
- [ ] Cookie value never URL-encoded — breaks JWT base64.
- [ ] When proxying a third-party handler's `Response`, rebuild with `headers.forEach(append)` so multi-valued `Set-Cookie` entries survive.
- [ ] Auth endpoints log `userId` + IP + outcome only — never email, token, password, session ID.

### SvelteKit server layer (`apps/web/src/routes/**/+page.server.ts`, `apps/web/src/lib/server/*`)

- [ ] If the server load branches on `locals.user` (or returns auth-derived data in the payload), the anonymous branch uses `CACHE_HEADERS.DYNAMIC_PUBLIC_REVALIDATE` — NOT `DYNAMIC_PUBLIC`. Plain `DYNAMIC_PUBLIC` pins one variant in the browser cache for 5 min and post-sign-in requests serve stale. (Reference: 10-sveltekit-server.md §4.)
- [ ] Page-level SvelteKit load fetch errors are `.catch()`-ed when streamed — unhandled rejections crash the server.
- [ ] Any `libraryCollection.update(key, cb)` / `progressCollection.update(key, cb)` callback MUTATES the draft (e.g. `(draft) => { draft.x = y }` or `Object.assign(draft, item)`) — never `() => newItem` (silent no-op; TanStack DB discards return values).

### Stripe checkout flows (any `createCheckoutSession`-style method)

- [ ] `customer_email` is passed to `stripe.checkout.sessions.create` when the user's email is known — looked up via `db.select({ email: users.email }).from(users).where(eq(users.id, userId))` and spread conditionally `...(user?.email && { customer_email: user.email })`. Missing this creates duplicate Stripe Customer records per user.
- [ ] Default `success_url` points at a verify-before-handoff page (e.g. `/checkout/success`, `/subscription/success`) that polls a verify endpoint until the webhook-written DB row exists — NOT the final destination. Stripe always redirects before `checkout.session.completed` fires.
- [ ] Verify endpoint enforces session ownership via `session.metadata?.codex_user_id === userId` (or the equivalent metadata key) and throws `ForbiddenError` on mismatch.
- [ ] Verify service returns `{ sessionStatus, purchase?/subscription? }` where the nested row's *absence* is a transient "keep polling" state, not an error.
- [ ] "Already acquired" checks that span the Stripe redirect window (library dedup, upsell filters, access grant queries) check `status IN ('completed', 'pending')` — not `status = 'completed'` alone.

### Database & Migrations

- [ ] Soft delete only (`{ deletedAt: new Date() }`), no `db.delete(...)`
- [ ] Pagination via `withPagination({ page, limit })` helper
- [ ] Unique violations caught → `ConflictError` with correlation context
- [ ] If new migration: generated via `pnpm db:generate` (no hand-written SQL)
- [ ] If using transactions: service receives `dbWs`, not `dbHttp`
- [ ] Writes on soft-deletable tables filter `isNull(deletedAt)` in the WHERE — not just reads. Otherwise updates can mutate deleted rows.
- [ ] State-dependent updates put the state check in the WHERE clause and use `.returning()` length to detect no-op (race-free alternative to SELECT-then-UPDATE)

---

## 7. Iterative Review — How This Skill Stays Sharp

This skill is designed to improve through use. The mechanism is simple: periodically
pick a real flow in the codebase, review it using this skill, and let the review
tell you what the skill is missing.

### The cycle

```
Pick a target (a service, a route group, a webhook flow)
  ↓
Review it with SKILL.md + the 2–4 references the decision tree suggests
  ↓
Classify findings — note that Category A findings often ALSO produce skill edits:
  A. Real bugs in the code     → beads task (don't fix yet — just capture)
     AND — if the bug teaches a general rule backend devs should follow,
     also add an anti-pattern row / checklist item / §6 bullet. Dual-output.
     Ask for each A: "does this reveal a general rule, or is it purely local?"
     If general → skill edit too. If purely local (typo, one-off config) → beads only.
  B. Patterns the code uses that the skill doesn't document
                                → add to the relevant reference (good example)
  C. Patterns the code violates that the skill doesn't warn against
                                → add to anti-patterns table
  D. References that felt wrong (too long / too short / wrong routing)
                                → fix SKILL.md decision tree or reference
  ↓
Apply skill edits immediately (they compound)
Create beads tasks with enough context that a future fix session has everything
```

### What makes a good target

- A **self-contained flow** (e.g. purchase completion, subscription renewal,
  media upload end-to-end) — not a single file in isolation
- Exercises **multiple references** — single-reference targets don't stress-test
  the routing and cross-linking
- Real production code that users actually hit — not experimental branches

### Rotation

Work through the domain surface systematically to avoid blind spots. A reasonable
queue:

1. Purchase flow (done — iteration 0)
2. Subscription webhook + revenue transfers
3. Media upload + transcoding trigger
4. Auth / session validation
5. Organization service + membership
6. Identity service (profile, avatar)
7. Access service (streaming URLs, progress)
8. Admin analytics + management
9. Notifications + email templates
10. Platform settings facade
11. SvelteKit server API client
12. Remote functions layer

Each iteration advances the queue. When the queue loops back, the earlier targets
have likely changed — review them against current state.

### What to capture in beads tasks

For each code finding:
- **Title** — one line, actionable ("Fix await cleanup() in checkout webhook")
- **Description** — file:line, what's wrong, what the skill rule says, how to fix
- **Priority** — 1 (critical — data/security), 2 (important — pattern violation), 3 (minor — style/staleness)
- **Label** — `backend-dev-review` so all review-originated issues can be filtered

For each skill improvement, edit the reference directly — no task needed. The
commit log IS the history.

### Review checklist from §6 is the tool

Run §6's checklist against the target code. It's deliberately mechanical — a
human reviewer would internalise these rules, but the checklist makes them
explicit for consistency across many reviews.

### Manual invocation beats cron for this skill

Don't schedule the review cycle on a recurring cron — the loop is cheap to run
but each iteration produces ~10 findings that need human eyes to triage.
Unattended loops pile up work faster than it can be verified.

**Recommended pattern:**

1. Start a session with a specific target in mind: `pick a review target from
   §7 queue and run one iteration`
2. Spawn the review sub-agent, process its findings, file beads + edit skill
3. Stop. Review next target in a future session.

**If you really want recurrence**, use a manual slash command
(`/backend-review <target>`) that does a single iteration — not a cron that
fires unattended. See `review-log.md` in this dir for iteration history.

### Stop criteria

The loop stops when ONE of:

- All 12 queue targets have at least one review iteration
- An iteration produces zero skill edits (Categories B, C, D all empty) —
  signal that the skill has reached fidelity against the code
- The P1 bug count holds at zero across two consecutive iterations on new
  targets

If none of these trigger, the loop is either discovering new material or
the skill still has gaps — continue.

### Spot-check agent findings before filing

Sub-agents occasionally hallucinate line numbers or misread code. Before
filing any beads task with priority P1 or P2, grep / read the cited file
yourself to confirm the bug is real. P3 findings can be filed with looser
scrutiny but noted as "unverified" in the task description.

This is cheap insurance against bad beads flooding the queue.

### Verification loop-closing (open gap)

Current loop: target → review → beads + skill edit. Not yet validated in
the forward direction — i.e. someone implements a new feature using ONLY
the skill's guidance, then a review of their code should find minimal
issues. Until that forward test runs, we know the skill is good for
reviewing, not proven good for implementing. Open question.

---

## 8. Review Log

Iterations completed to date. Update on each run.

| Iter | Date | Target | Findings | Skill edits |
|------|------|--------|----------|-------------|
| 0 | 2026-04-18 | Purchase flow (purchase-service, checkout route, checkout webhook) | 7 tasks | §6 review checklist, re-parse anti-pattern, webhook cleanup pattern (ref 06) |
| 1 | 2026-04-18 | Subscription webhook + revenue transfers | 12 tasks | 3 good patterns (WebhookHandlerResult, unique-first idempotency, split invariants) + 5 anti-patterns |
| 2 | 2026-04-18 | Media upload + transcoding trigger | 10 tasks | Media container magic bytes, dev-route gating, atomic state-guarded update, dispatch separation, 5 new anti-patterns |
| 3 | 2026-04-18 | Auth / session validation | 9 tasks (incl. 2 P1 critical) | Auth-worker §6 block, KV TTL cap rule, sign-out invalidation, cookie handling subsection, body-ordering contract, 4 new anti-patterns |
| F1 | 2026-04-18 | **Forward-validation** — implemented fixes for all 4 P1 tasks (Codex-4nax, xj29, wqb5, hk2k). Auth rate-limiter (paths + wrapper), 4 webhook `await cleanup()` → `waitUntil(cleanup())`, missing `.catch()` on 2 waitUntil sites. Typechecks clean. Post-fix audit found a second missed `.catch()` site the skill's "grep the file, not obvious sites" rule would have caught — rule paid off. | Skill worked in forward direction: §6 checklists led directly to correct fixes without re-teaching |
| F2 | 2026-04-24 | **Forward-validation** — post-purchase / post-subscription UX bugs surfaced in live testing, fixed across 6 commits (f65cf5e7, c24ef625, 1b6f14a0, 866162aa, f7938648, 771e4303). Findings the skill didn't document at the time: (1) HTTP `DYNAMIC_PUBLIC` on auth-varying pages pins anonymous HTML in the browser cache for 5 min — post-sign-in requests serve stale; new `DYNAMIC_PUBLIC_REVALIDATE` preset. (2) Stripe `success_url` redirecting straight to `/library` beats the webhook every time; verify-before-handoff pages are required. (3) `customer_email` was missing on `PurchaseService.createCheckoutSession` (subscription path had it with a BUG-022 comment — drift). (4) "Already acquired" dedup on `status='completed'` only leaves a pending-window race. (5) `libraryCollection.update(key, () => item)` is a silent no-op in TanStack DB — callback must mutate the draft. | §4 HTTP headers table (4 presets now), §4 auth-conditional decision rule, §6 new "SvelteKit server layer" + "Stripe checkout flows" checklist blocks, reference 06 new "Always forward customer_email" / "Redirect target: success page" / "Pending-status dedup" sections, reference 10 `DYNAMIC_PUBLIC_REVALIDATE` documentation + decision rule, caching skill §2 Step 5 rewrite + 4 new anti-pattern rows + 3 new debugging bullets |

Unreviewed queue (in priority order):
5. Organization service + membership
6. Identity service
7. Access service (streaming URLs, progress)
8. Admin analytics
9. Notifications
10. Platform settings facade
11. SvelteKit server API client
12. Remote functions

## 9. How References Stay Accurate

### Anchoring convention

Citations prefer **file path + symbol name** over file:line pairs — line numbers
drift as code changes, symbol names survive refactors. Examples:

- PREFER: "`packages/worker-utils/src/procedure/procedure.ts` — `procedure()` function body, steps 1-8"
- AVOID: "`packages/worker-utils/src/procedure/procedure.ts:109-201`"

File:line is acceptable when pointing to a specific bug location in a beads
task (where the task is going to be actioned soon and line numbers are still
valid). Inside skill references, prefer symbols.

### When references disagree with code

The **code is authoritative** — update the reference, not the code. If you find a
rule in a reference that the current code violates AND you think the rule is
still correct, it's a code bug — file a beads task (or verify via §7 iterative
review before filing).

### Re-verification

Each reference ends with a **"When to Re-Verify"** footer listing specific source
files whose changes would invalidate the doc. Read that list before relying on
a reference after significant refactors.

### Lint

Run `bash .claude/skills/backend-dev/lint-skill.sh` after any edit. Catches:

- Broken cross-references between SKILL.md and references
- Missing frontmatter
- Duplicate anti-pattern rows
- Missing "When to Re-Verify" footers
- Stale source-file paths (file no longer exists at cited path)
- Size regressions (ref too short or too long)

Run before committing skill edits.
