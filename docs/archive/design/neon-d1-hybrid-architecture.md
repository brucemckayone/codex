> **SUPERSEDED 2026-08-30 — and two of its numbers are wrong.**
> The conclusion here (a per-tenant/forked-schema D1 design) was replaced twice; the answer is **no D1 at all**.
> See `docs/design/data-architecture/index.html`.
>
> **Do not re-use figures from this file without checking them.** Verified against `origin/dev` on 2026-08-30:
> - *`INTERVAL`/`NOW()` rewrites* — this file's figure propagated into the successor document as **168**. The real count is **59** across every `.ts` and `.sql` file. A ~3× overstatement, and it sat inside a *rejection* argument, where inflating a cost makes a conclusion look better supported than it is.
> - *Join graph* — this file says 79 joins / 9 instances; the successor's masthead said "100-instance", which appears in neither. The verifiable figures are **92 foreign-key references across 42 `relations()` blocks**.
> - Figures that DID check out: **49 tables**, ~**187** raw `sql``` templates (stated 188 — a scope boundary), **27** `organizationId:` declarations (consistent with the stated 28 tenant-scoped tables).
>
> Retained only for its dialect-surface analysis and join-graph *method*, not its counts.

# Hybrid Data Architecture: Neon (ledger) + D1 (tenant plane) + Durable Objects (coordination)

**Status**: Investigation / design proposal — no code changes made
**Date**: 2026-08-29
**Author**: investigation for @brucemckay
**Scope**: 49 tables, 775 source files, 347 test files, 9 workers

---

## 0. Executive summary

**Recommendation: one shared D1 database with row-level `organization_id` scoping — not one D1 per org, and not one Durable Object per org.** Neon keeps the money and identity ledger. The boundary between the two stores is crossed by **projections, never by joins**. Durable Objects are used for three narrow coordination jobs, not as a primary store.

Three verified platform facts drive this, and each one kills an obvious-looking alternative:

| Fact (verified 2026-08-29) | Kills |
|---|---|
| D1 bindings are **static** — no runtime binding by name; ~5,000 bindings max per Worker script | "One D1 per org" |
| DOs bill **wall-clock duration** while active ($12.50/M GB-s); Cloudflare's own example puts *100* DOs active 8h/day at $137/mo | "One DO per org as primary store" |
| D1 has **no interactive transactions** — `batch()` needs all statements up front | Naive lift-and-shift of `packages/content` |

The good news is that the codebase is unusually well-shaped for this: `BaseService` takes `config.db` from a **single injection point** (`packages/worker-utils/src/procedure/service-registry.ts`), admin analytics is **already org-scoped**, money is **already stored as integer cents** (zero `numeric`/`decimal` columns), and `entitlements` already exists as an access read-model — which turns out to be the exact seam the split needs.

**Headline cost/benefit**: the reads that would move to D1 are the bot-amplified public ones (org landing, content detail, catalogue). Those are the same reads driving the KV blowout epic (`Codex-kgrdp`) and the Neon compute quota exhaustion. Moving them lets Neon's compute idle down, which is what actually reduces the bill.

---

## 1. Reframing the cost problem

**Neon bills compute-hours, not queries.** Your own CI failure is the proof: `396,646 / 396,000` seconds — over quota by 0.16%, with every PR red at `Create Neon branch` (`Codex-n8oqd`).

This matters because it changes the optimisation target:

- ❌ *Wrong target*: "reduce the number of Neon queries."
- ✅ *Right target*: "reduce the number of **paths** that keep a Neon compute awake."

A Neon endpoint serving 10 queries/second and one serving 200 queries/second cost far more similarly than you'd expect, because both keep the compute active. The saving comes from removing whole categories of traffic so autoscaling can settle at a lower CU, and so the endpoint can actually autosuspend during quiet periods.

Which traffic? Your own audit already found it:

- The org wildcard subdomain means **any unknown host is treated as a tenant slug** (`feedback_wildcard_subdomain_reserved_list_drift`). No edge allowlist is possible.
- Credential-scanner bots produce **~38k invocations/24h** (`project_kv_volume_blowout_2026_08_26`).
- Each unresolved host costs **3–4 subrequests + a Neon hit**, with **no negative cache**.
- The KV cache in front of it has a **proven 0% hit rate** (`Codex-e32xz`).

So a large fraction of Neon compute is spent on *unauthenticated, tenant-scoped, non-financial reads that are amplified by bots*. That is a near-perfect D1 workload: read-heavy, org-scoped, no interactive transactions, no money.

**Corollary — do Phase 0 first (§12).** The host-resolution fix needs no D1 at all and addresses a live P0.

---

## 2. Verified platform constraints

All figures fetched live on 2026-08-29 from `developers.cloudflare.com` (page "last updated" dates in brackets). **Do not trust cached doc summaries for these — several were stale.**

### D1 [limits page: Apr 21 2026]

| Limit | Value (Workers Paid) |
|---|---|
| Databases per account | 50,000 — raisable "to millions" by request |
| **Max database size** | **10 GB** |
| Max storage per account | 1 TB (raisable) |
| Queries per Worker invocation | 1,000 |
| Simultaneous D1 connections per invocation | **6** |
| Max columns per table | 100 |
| Max rows per table | unlimited (bounded by 10 GB) |
| Max string / BLOB / row size | 2 MB |
| **Max bound parameters per query** | **100** |
| Max SQL statement length | 100 KB |
| Max `LIKE`/`GLOB` pattern | 50 bytes |
| Max bindings per Worker script | **~5,000** (~150 B each, 1 MB script metadata cap) |
| Max SQL query duration | 30 s (also caps a whole `batch()`) |
| Time Travel (PITR) | 30 days |

**Concurrency**: each D1 database is **single-threaded**, processing one query at a time. ~1,000 q/s at 1 ms average; ~10 q/s at 100 ms. Over-concurrency queues, then returns `overloaded`. Each D1 database *is* a Durable Object under the hood; each read replica is a separate DO with the same per-instance guidance.

**Read replication** [Aug 10 2026]: built in, **no extra storage or compute cost** — you pay the same `rows_read`/`rows_written`. The **Sessions API** (`withSession()`) attaches a bookmark per query to give **sequential consistency** across replicas: a read carrying bookmark N waits until the replica is at least as fresh as N. This is exactly what public tenant pages need.

**Pricing**: 25 B rows read/mo included, then $0.001/M · 50 M rows written/mo included, then $1.00/M · 5 GB storage included, then **$0.75/GB-mo**. No egress charges.

### Durable Objects (SQLite) [limits: Jun 1 2026; pricing: Aug 25 2026]

| Limit | Value (Workers Paid) |
|---|---|
| Number of objects | unlimited |
| **Max DO classes per account** | **500** |
| **Storage per Durable Object** | **10 GB** |
| Storage per account | unlimited |
| Soft throughput per object | **~1,000 req/s** |
| CPU per request | 30 s (configurable to 5 min) |
| Simultaneous outgoing connections | 6 |
| SQL limits (cols/params/row size) | identical to D1 |

**Real transactions**: yes. `ctx.storage.transaction()` exists, and more usefully *any series of writes with no intervening `await` is automatically atomic*, with the runtime blocking concurrent events during an awaited read. With the SQLite backend, `ctx.storage.sql.exec()` participates in the surrounding transaction.

**Pricing**: rows read/written match D1 exactly; **SQL storage is $0.20/GB-mo** (cheaper than D1's $0.75). But then:
- **Requests**: 1 M/mo included, then $0.15/M (each RPC method call = one billed request).
- **Duration**: 400,000 GB-s/mo included, then **$12.50/M GB-s**, billed on **wall-clock time while active or idle-but-not-hibernatable**.

That duration line is the trap. Cloudflare's Example 2 — 100 DOs active 8 h/day — is **$137.50/mo in duration alone**. Scale that to a per-org store across hundreds of active tenants and you have replaced a Neon compute bill with a DO duration bill that grows with tenant count. D1 has **no duration charge at all**.

### The binding asymmetry (the decisive constraint)

D1 bindings are declared statically in Wrangler config and **cannot be assigned at runtime**. The only workaround is to rewrite the Worker's bindings via the Workers REST API and redeploy — Cloudflare has acknowledged this with no ETA ([workerd discussion #3564](https://github.com/cloudflare/workerd/discussions/3564)). A 2026 case study hit exactly this wall at **421 tenant databases** ([sushidata](https://sushidata.com/blog/2026/05/19/outgrew-cloudflare-d1-everything-tried-building-solution/)).

Durable Objects **can** be addressed by name at runtime (`idFromName(orgSlug)`). That asymmetry is why per-tenant SQL on Cloudflare usually lands on DO-SQLite — and why, once DO duration billing is priced in, **shared-D1 with row-level scoping wins for a content graph**.

---

## 3. Recommended architecture

Two stores, three logical planes, and a projection layer between them.

```
┌───────────────────────────── NEON (Postgres) ─────────────────────────────┐
│ LEDGER PLANE — system of record                                            │
│ money · identity · Stripe state · agreements · audit                       │
│ interactive transactions · FOR UPDATE · exact retention · 30d PITR         │
└───────────────────────────────────────────────────────────────────────────┘
             │ projections (one-way, Neon → D1, never read back)
             ▼
┌────────────────────────── D1 (single shared DB) ──────────────────────────┐
│ ORG PLANE          every row carries organization_id                       │
│   content · media · courses · settings · categories · landing pages        │
│ USER PLANE         every row carries user_id                               │
│   playback · followers · enrollments · completions · preferences           │
│ PROJECTIONS        read-only mirrors of Neon truth                         │
│   org_directory · org_members · entitlements_read                          │
└───────────────────────────────────────────────────────────────────────────┘
             │
┌──────────────────── DURABLE OBJECTS (coordination only) ──────────────────┐
│ HostRouterDO · content counters · transcode job coordination               │
└───────────────────────────────────────────────────────────────────────────┘
```

### Why one shared D1 and not per-org

1. **Runtime addressing** — static bindings make per-org D1 unimplementable without redeploying the Worker per tenant.
2. **Cost shape** — D1 has no duration charge; per-org DOs do, and it scales with active tenants.
3. **Your security model survives untouched** — `orgScopedNotDeleted(table, orgId)` and `withOrgScope()` keep working *verbatim*. For a codebase whose first strict rule is "scope every query", that is worth more than isolation-by-database. Per-org databases would actually *weaken* review discipline by making the scope filter look optional.
4. **Cross-org reads keep working** — the library (`buildRelationshipQuery` in `packages/access/src/services/content-access/library.ts:709`) deliberately serves free + follower-gated content from *any* org the user follows. Under per-org databases that becomes an N-way fan-out — and with a 6-simultaneous-connection cap, a user following 50 orgs cannot be served at all.
5. **Read replication is free** and gives the public pages global low-latency reads.

### Table allocation (all 49 tables)

**NEON — ledger plane (28 tables)**

*Identity & auth (5)* — `users`, `sessions`, `accounts`, `verification`, `creator_onboarding`
> BetterAuth needs its Postgres adapter; sessions are already KV-cached so the read load is modest.

*Tenant directory (2)* — `organizations`, `organization_memberships`
> Source of truth. **Projected into D1** (see below) because 9 join-instances need them.

*Money & commerce (11)* — `purchases`, `content_access`, `entitlements`, `subscriptions`, `subscription_tiers`, `course_subscriptions`, `course_subscription_plans`, `stripe_connect_accounts`, `payouts`, `pending_payouts`, `refund_reviews`

*Fees & agreements (7)* — `platform_fee_config`, `fee_config_platform`, `fee_config_org`, `fee_config_org_creator`, `fee_config_audit_log`, `organization_platform_agreements`, `agreement_proposals`, `creator_organization_agreements`
> (8 listed; `platform_fee_config` and `fee_config_platform` are distinct tables.)

*Ops (2)* — `orphaned_image_files`, `email_audit_logs`
> `email_audit_logs` is an open decision — see §14.

**D1 — org plane (15 tables)**

`content`, `media_items`, `categories`, `content_categories`, `courses`, `course_stages`, `stage_practices`, `course_testimonials`, `course_tier_access`, `landing_pages`, `platform_settings`, `branding_settings`, `contact_settings`, `feature_settings`, `email_templates`

**D1 — user plane (5 tables)**

`video_playback`, `practice_completions`, `course_enrollments`, `organization_followers`, `notification_preferences`

**Excluded (1)**: `test_table`.

### Why `course_tier_access` is in D1

It looks financial but isn't: it records *policy* ("which tiers unlock this course"), authored in the studio. The *subscription* side of the check arrives via the entitlements projection. Policy is tenant data; entitlement is ledger data.

---

## 4. The join graph: what survives, what breaks

I extracted every `innerJoin`/`leftJoin` in `packages/` and `apps/web/src` (tests, dist and denoise proofs excluded): **41 distinct table pairs, ~100 join instances.** Under the allocation above:

**~79 join instances stay intra-store and need zero changes**, including the seven hottest:

| Joins | Pair | Store |
|---|---|---|
| 7× | `content ⋈ media_items` | D1 |
| 7× | `course_stages ⋈ stage_practices` | D1 |
| 7× | `content ⋈ video_playback` | D1 |
| 4× | `organization_memberships ⋈ users` | Neon |
| 4× | `subscription_tiers ⋈ subscriptions` | Neon |
| 3× | `courses ⋈ landing_pages` | D1 |
| 3× | `course_subscriptions ⋈ purchases` | Neon |
| 3× | `categories ⋈ content_categories` | D1 |
| 3× | `subscriptions ⋈ users` | Neon |
| 3× | `content ⋈ stage_practices` | D1 |

Putting the **user plane in the same D1 as the org plane** is what preserves `content ⋈ video_playback` (7×) and `content ⋈ practice_completions`. Splitting them would cost 12 rewrite sites for no present benefit.

**21 join instances break.** They fall into exactly two families, each with one clean fix:

### Family A — `⋈ organizations` / `⋈ organization_memberships` (9 instances)

`content ⋈ organizations` (3) · `courses ⋈ organizations` (2) · `content ⋈ organization_memberships` (1) · `organizations ⋈ stage_practices` (1) · `course_enrollments ⋈ organizations` (1) · `media_items ⋈ organization_memberships` (1)

**Fix: project both tables into D1 as read-only mirrors.** `organizations` is 10 columns; `organization_memberships` is 8. Both are low-churn, and the row count is bounded by your tenant count — thousands, not millions. Neon stays the source of truth; the D1 copies are never written by application code.

All 9 joins then resolve locally.

### Family B — `⋈ purchases` / `⋈ subscriptions` (12 instances)

`content ⋈ purchases` (5) · `media_items ⋈ purchases` (2) · `purchases ⋈ video_playback` (2) · `course_tier_access ⋈ subscriptions` (2) · `course_tier_access ⋈ subscription_tiers` (1)

These are the access-control and per-org analytics reads. **Fix: project `entitlements` into D1 as `entitlements_read`.**

You already have the right table. `entitlements` is 10 columns keyed on `(userId, organizationId, contentId, courseId)` — it *is* an access read-model. Today it lives beside `purchases`; the split makes it the designated boundary object.

After projection:
- `content ⋈ purchases` (access check) → `content ⋈ entitlements_read`, entirely in D1.
- `purchases ⋈ video_playback` (analytics: "what did buyers watch") → `entitlements_read ⋈ video_playback`, entirely in D1.
- `course_tier_access ⋈ subscriptions` → `course_tier_access ⋈ entitlements_read`.

Money never leaves Neon. Only the *derived fact* "this user may access this thing" crosses.

> **This is the single most important design decision in the document.** It converts a distributed-join problem into a projection problem, and you already have the table.

---

## 5. Projection consistency and fail-safe ordering

Three projections: `org_directory`, `org_members`, `entitlements_read`. Neon writes, D1 mirrors, application code never writes the mirror.

The dangerous window is a stale projection right after a purchase or refund. **Write ordering makes both directions fail safe:**

| Operation | Order | Worst case if step 2 fails |
|---|---|---|
| **Grant** (purchase, subscribe, follow) | Neon **first**, then D1 | User paid, briefly can't access → recovered by the Neon fallback read below. Never lost money. |
| **Revoke** (refund, cancel, ban) | D1 **first**, then Neon | Access removed slightly early, Neon still shows the grant → user locked out a moment sooner than strictly due. Safe. |

**Fallback read rule**: check `entitlements_read` in D1; **on a miss only, fall back to Neon.** This is correctness-preserving in the right direction — a D1 miss costs one Neon query, while a D1 *hit* is authoritative because the mirror only ever contains grants that Neon has already committed. There is no path that grants access D1 alone believes in.

**Do not** fall back on a D1 *hit* — that would double every access check and defeat the purpose.

**Verification requirement** (per `feedback_verify_before_close`): a reconciliation job comparing `entitlements` (Neon) against `entitlements_read` (D1) must run continuously from Phase 2, alerting on divergence. Do not treat the projection as correct because the code looks correct. Given `feedback_procedure_cleanup_races_background_db_writes`, projection writes must use `ctx.background()`, **not** `waitUntil()` — `procedure()` cleanup ends the pool and the write silently vanishes.

---

## 6. Schema translation: Postgres → SQLite

Measured across all 49 tables:

| PG type | Count | SQLite (Drizzle `sqlite-core`) | Risk |
|---|---|---|---|
| `timestamp` (125 `withTimezone`) | **138** | `integer(..., { mode: 'timestamp_ms' })` | **Medium** — pick one representation and never mix. Text ISO also works but `integer` indexes and range-scans better. Every `orderBy(desc(createdAt))` depends on this. |
| `varchar` | 109 | `text()` | None — SQLite ignores length |
| `text` | 107 | `text()` | None |
| `uuid` | **99** | `text()` | Low — store the same 36-char string. Costs ~20 B/row vs PG's 16 B binary. |
| `integer` | 62 | `integer()` | None |
| `boolean` | 22 | `integer(..., { mode: 'boolean' })` | Low |
| `jsonb` | 9 | `text(..., { mode: 'json' })` | **Medium** — see query rewrites |
| `bigint` | 2 | `integer()` | Low — SQLite INTEGER is 64-bit |
| `numeric` / `decimal` | **0** | — | **None. Money is already integer cents.** |
| `.array()` | 0 | — | None |
| `pgEnum` | 3 | `text({ enum: [...] })` | None |

**`numeric` being zero is a significant finding.** The standard objection to SQLite for a commerce platform is the absence of exact decimal arithmetic. You've already sidestepped it by storing cents as integers. It doesn't change the recommendation to keep money on Neon (transactions, audit, PITR), but it removes a hard blocker if that ever needs revisiting.

**Other mechanics:**
- `defaultRandom()` — **32 uses**. SQLite has no UUID generator. Generate in application code (`crypto.randomUUID()`) via Drizzle `$defaultFn`. Do this uniformly; a mixed approach will produce two id formats.
- **Soft deletes still work**, but soft-deleted rows count against the 10 GB. Your strict rule is *never* hard-delete. **These conflict for the D1 plane.** Resolution: keep soft-delete as the API contract, and add an archival sweep that copies rows soft-deleted >N days ago into a Neon archive table, then hard-deletes from D1. This preserves the audit trail where it belongs and keeps the tenant plane lean. **This needs an explicit decision (§14).**
- **100 bound parameters per query** — bulk inserts must be chunked. `createTestContentItems`, `db:seed:portals` and `seed-data.ts` will exceed it.
- **100 columns per table** — your maximum is `media_items` at 33. Comfortable.
- `users.id` is already `text` (BetterAuth), so `user_id` foreign keys translate with no change at all.

---

## 7. Query rewrite inventory

Measured across 775 source files (tests, dist, denoise proofs excluded). This is the real migration bill:

| Pattern | Occurrences | Files | Effort |
|---|---|---|---|
| `` sql`` `` raw template | **188** | 33 | Must audit every one individually |
| `INTERVAL` | **89** | 25 | → `unixepoch()` arithmetic / `datetime(...)` |
| `NOW()` | **79** | 42 | → `unixepoch()` (match your timestamp encoding) |
| `::type` casts | **70** | 10 | Mostly deletable; SQLite is dynamically typed |
| `onConflict*` | 48 | 20 | ✅ SQLite supports `ON CONFLICT DO UPDATE` — Drizzle API is the same |
| `COALESCE` | 45 | 8 | ✅ Supported |
| `FILTER (WHERE ...)` | 13 | 4 | ✅ SQLite ≥3.30 supports it — **verify on D1's build** |
| `ilike()` | 11 | 5 | → `like()` (SQLite `LIKE` is case-insensitive for ASCII). **Non-ASCII search silently changes behaviour** — needs a test |
| window functions (`OVER(`) | 2 | 2 | ✅ SQLite ≥3.25 |
| CTEs | 2 | 1 | ✅ Supported |
| `.for('update')` | 2 | 1 | **Delete** — no row locks needed; D1 is single-writer |
| `array_agg`/`json_agg` | 1 | 1 | → `json_group_array()` |

**The bulk of the work is `INTERVAL` + `NOW()` (168 occurrences across ~50 files)**, which is date arithmetic in analytics queries. This is mechanical but must not be done by find-and-replace: `NOW() - INTERVAL '30 days'` becomes different SQL depending on whether you chose integer-ms or text-ISO timestamps.

**jsonb operators** (`->>`, `@>`, `#>`) must become `json_extract(col, '$.path')`. Only 9 jsonb columns, so the surface is small — but `content.contentBodyJson` and `content.shaderConfig` are among them.

> ⚠️ Per `feedback_audit_grep_dist_contamination`: these counts are **`src/` only**. Re-running an audit that includes `dist/` will invent ghost violations from stale `.d.ts` files.

---

## 8. Transactions: the actual blocker, and its fix

**28 `db.transaction()` call sites** in the packages that would move: `content` (12), `access` (7), `organization` (6), plus `notifications` (1) and `database` internals.

I inspected `packages/content/src/services/content-service.ts:237`. The shape is:

```ts
await this.db.transaction(async (tx) => {
  if (validated.mediaItemId) {
    await this.validateMediaItem(tx, validated.mediaItemId, creatorId, ...); // ← a READ
  }
  const [newContent] = await tx.insert(content).values({ ... });             // ← then a WRITE
  ...
});
```

**Read → decide → write.** D1's `batch()` is a genuine SQLite transaction (sequential, non-concurrent, aborts and rolls back the whole sequence on any statement failure) — but you must supply every statement up front. It cannot express this.

**The fix is not a Durable Object.** Make the invariant atomic *with* the write by pushing the check into the statement:

```sql
INSERT INTO content (id, creator_id, media_item_id, ...)
SELECT ?, ?, ?, ...
WHERE EXISTS (
  SELECT 1 FROM media_items
  WHERE id = ? AND creator_id = ? AND deleted_at IS NULL
);
-- 0 rows affected  ⇒  the guard failed  ⇒  throw NotFoundError
```

Then `batch()` the guarded write with any dependent writes. Properties:

- **No TOCTOU window** — the check and the write are one statement.
- **Rollback preserved** — a failing statement aborts the batch.
- **Typed errors preserved** — inspect `meta.changes === 0` and throw the same `NotFoundError`/`ForbiddenError`. Your `procedure()` → `mapErrorToResponse()` contract is unchanged.

Apply the same shape to updates (`UPDATE ... WHERE id = ? AND organization_id = ?`, then assert `changes === 1`). This is *stricter* than the current code, because the scope filter becomes part of the atomic write rather than a preceding read.

**Reserve a Durable Object only where a guard genuinely cannot be expressed as one statement** — e.g. logic requiring a computed decision in TypeScript between read and write. Expect a small number; audit all 28 before assuming any need it.

**Note on the 30 s cap**: it applies to the entire `batch()`, not per statement.

---

## 9. Where Durable Objects genuinely earn their place

Three narrow jobs. None is a primary store.

### 9.1 `HostRouterDO` — ship this first, independent of everything else

Your highest-value, lowest-risk change, and it needs **no D1 migration at all**.

The problem (already documented in your own audit): the wildcard subdomain means every unknown host is a candidate tenant slug, so no edge allowlist is possible; **25 of your own hostnames self-DoS as org lookups**; each miss costs 3–4 subrequests plus Neon; and KV cannot safely hold negative entries (`feedback_negative_cache_in_quota_capped_store` — positive entries are bounded by your data, negative ones by the attacker).

A DO fixes precisely this:
- Holds the `host → org` map in SQLite, strongly consistent.
- Answers **negative** lookups authoritatively without touching Neon or KV — a bot hammering random hostnames hits one DO and stops.
- No KV quota exposure, so it cannot become the account-wide quota DoS that `Codex-kgrdp` describes.
- One object (or a handful, sharded by hostname hash) stays warm — that's a *bounded* duration cost, unlike per-org DOs.

This directly attacks the live KV P0 and reduces Neon compute before any schema work begins.

### 9.2 Content counter DOs

`content.viewCount` and `content.purchaseCount` are hot single-row updates. In a **single-threaded** D1 they serialise the entire database — the worst possible write pattern. Move them to a DO (per content item, or per org for a batched counter set) with periodic flush into D1. Without this, view counting alone can cap your D1 write throughput.

### 9.3 Transcode job coordination (optional)

`packages/transcoding` + RunPod webhooks already need retry and timeout handling. A DO per job gives alarms and durable state. Adjacent to this work — not a prerequisite.

**Class budget**: 500 DO classes per account. Three classes is nothing. The constraint that matters is *duration*, not class count.

---

## 10. Avoiding sharding (your explicit requirement)

You asked to design so that sharding is avoided while multi-org content queries stay available. That is achievable, and here is the arithmetic plus the tripwires.

### What actually threatens the 10 GB ceiling

Not content metadata. I checked:

**Risk 1 — `content.contentBody` is a plain `text` column holding article bodies inline** (`content.ts:249`), alongside `contentBodyJson` (jsonb). Unbounded per row.

| Articles | @ 50 KB body | D1 usage |
|---|---|---|
| 1,000 | 50 MB | negligible |
| 20,000 | 1 GB | 10% of ceiling |
| 100,000 | 5 GB | **50% — problem** |

**Mitigation** (cheap now, and it removes the ceiling as a concern for years): store article bodies in **R2** and keep a key in D1. You already have `R2Service`, `dev-cdn` for local, and the media pipeline. Content *metadata* rows are ~1.2 KB, giving roughly 4–8 M rows inside 10 GB with indexes.

**Risk 2 — `video_playback` row count.** It has `unique(userId, contentId)`, so it's one small (~150 B) row per user-per-item. Bounded, but multiplicative:

| Users | Items each | Rows | Approx. size |
|---|---|---|---|
| 10,000 | 100 | 1 M | ~150 MB |
| 100,000 | 100 | 10 M | ~1.5 GB |
| 1,000,000 | 100 | 100 M | **~15 GB — over ceiling** |

**Mitigation**: a retention policy — prune rows untouched for >12 months (the last position on something abandoned a year ago has no value), and keep `completed` items as a compact flag. Decide this *before* migrating the table, not after.

### The real ceiling is write throughput, not storage

Once bodies are in R2, storage stops being the binding constraint and **single-threaded write concurrency** becomes it. Your write profile is favourable: writes are studio-authoring (low volume, low concurrency), reads are public (high volume, scaled by free read replication). The counter DOs (§9.2) remove the one pathological write pattern.

**Tripwires to instrument from day one** — alert on these, not on GB:
1. D1 p50/p95 SQL duration (the throughput denominator).
2. `overloaded` error rate (queue saturation).
3. `rows_read` per request (an unindexed query is invisible until the bill arrives).
4. Database size as a % of 10 GB, and `content` + `video_playback` row counts specifically.

### Forward-compatible decisions that cost nothing now

These are what let you defer sharding without repainting yourself into a corner:

1. **Route every tenant-plane query through one accessor** — `getTenantDb(orgId)` — from the very first commit, even though it returns the same binding for every org. Sharding then becomes a change in *one function*. Without this, sharding is a 775-file refactor.
2. **Never write a tenant-plane query that omits `organization_id` or `user_id`.** Your existing `orgScopedNotDeleted()` already enforces this; keep it mandatory in review.
3. **Keep the org plane and user plane as separate table groups** (naming or prefix convention) even inside one database, so a future split has a clean seam.
4. **Accept and document one known future cost**: if you ever shard the org plane by `organization_id`, the 7 `content ⋈ video_playback` sites plus `content ⋈ practice_completions` become two-step application joins (fetch the user's playback rows, then fetch those content ids). That is a cheap, bounded rewrite at ~9 known sites — pay it at shard time, not now.

**When to shard**: when p95 SQL duration or `overloaded` rate degrades, **not** at a storage number. At that point the first move is *vertical* (move article bodies and cold playback out), and only then horizontal.

---

## 11. Testing infrastructure

You flagged this, and it deserves top billing — because **your test infrastructure is currently the most acute pain, and D1 improves it more than it improves production**.

### Current state (measured)

- 347 test files total; **51 touch a real database**.
- **5 separate Neon branch creations** across `testing.yml`, `e2e-api-fast.yml`, `e2e-debug.yml` — each spinning a compute.
- **Neon compute quota is exhausted**: 396,646 / 396,000 s. Every PR is red at `Create Neon branch` (`Codex-n8oqd`).
- Shared-Neon contention forces `turbo concurrency=1`, `e2e maxForks=2`.
- `.env.test` **is** the dev database — a root `pnpm test` wipes local orgs (`feedback_env_test_is_the_dev_database`).
- `cleanupDatabase` must respect FK order; `onDelete: restrict` breaks raw `DELETE` (`feedback_test_cleanup_fk_ordering`).

### What D1 changes

Verified from the Workers Vitest integration docs [Aug 20 2026]:

> **"Storage isolation is per test file. Each test file gets its own storage environment, and any writes to storage during a test file are not visible to other test files. By default, test files run concurrently."**

That is the exact inverse of every constraint above:

| Today (Neon) | With D1 (`@cloudflare/vitest-plugin`) |
|---|---|
| Shared DB → `concurrency=1` | Per-file isolation → **concurrent by default** |
| Neon branch per CI job | **No branch, no network, no quota** |
| `cleanupDatabase` + FK ordering | **Cleanup disappears** — discard the storage env |
| Compute-quota failures block all PRs | D1 local costs nothing |
| `.env.test` can wipe the dev DB | Local SQLite per test file — **cannot** reach shared state |

For the ~30–40 of your 51 DB-touching tests that cover the tenant plane, this converts them from "slow, serialised, quota-limited, occasionally destructive" to "fast, parallel, free, isolated." That is arguably a bigger near-term win than the production cost saving.

### What it costs — new test work that must ship *with* the migration

Be clear-eyed; this is not free:

1. **Two test dialects, two Vitest projects.** Split into `db:neon` (integration, needs a branch, keeps `concurrency=1`) and `db:d1` (pool-workers, local, fully parallel). The `turbo concurrency=1` constraint then applies only to the shrinking Neon half.

2. **Dialect-aware factories.** `packages/test-utils/src/factories.ts` (and `subscription-factories.ts`, `content-helpers.ts`, `purchase-helpers.ts`) currently build rows against `dbWs`. They need to accept an injected db handle rather than reaching for a module singleton. This is the same single-injection-point discipline as `BaseService` — do it once, in `test-utils`.

3. **Cross-store contract tests — the genuinely new surface.** A test like "purchase grants access" now spans Neon *and* D1. You need a projection-contract layer asserting, after every mutation, that `entitlements_read` in D1 matches `entitlements` in Neon. **This test category does not exist today and must be built with the migration, not after it** — it is the only thing standing between you and silent access-control drift.

4. **Two migration chains.** `drizzle.config.ts` becomes two configs (`dialect: 'postgresql'` and `dialect: 'sqlite'`, the latter with `driver: 'd1-http'`), and `packages/database/src/migrations` gains a sibling `migrations-d1`. Per `feedback_drizzle_migrations`, both stay generated — never hand-written.

5. **Deploy pipeline.** `wrangler d1 migrations apply` must be added to deploy. Per `feedback_seed_scripts_must_be_in_deploy`, deploy currently only runs `db:migrate` — a D1 migration step that exists only locally will silently skip in production.

6. **Local dev.** D1 via Miniflare with `--persist-to ../../.wrangler/state` so it shares state with the existing workers (`feedback_wrangler_persist_to_consistency`). The pattern already exists — `dev-cdn` uses Miniflare R2.

7. **Two behaviour traps that tests must pin:**
   - `ilike` → `like`: ASCII case-insensitivity is preserved, **non-ASCII is not**. Any search test with accented characters must be written *before* the change, or the regression is invisible.
   - Timestamp encoding: every `orderBy(desc(createdAt))` and every date-range filter depends on the integer-vs-text choice. Pin ordering assertions first.

8. **Verify `FILTER (WHERE ...)` on D1's actual SQLite build** (13 occurrences, 4 files) rather than trusting the version table.

> Per `feedback_arity_change_vacuates_negative_assertions`: changing factory signatures will make every `not.toHaveBeenCalledWith` on those mocks unfailable, and CI reports only the *positive* failure. Probe each `not.` assertion in the affected files during step 2.

---

## 12. Migration sequencing

Each phase is independently shippable and independently valuable. Phases 0–2 change no user-facing behaviour.

**Phase 0 — `HostRouterDO`. No D1.**
Fix host→org resolution and negative caching. Addresses a live P0 (`Codex-kgrdp`), reduces Neon compute and KV quota exposure immediately. *Ship this first regardless of whether the rest is approved.*

**Phase 1 — Foundations. Nothing user-facing.**
D1 database + `sqlite-core` schema for the 20 tenant tables + second Drizzle config and migration chain + `getTenantDb(orgId)` accessor + the split Vitest projects and dialect-aware factories. Success criterion: the D1 test project runs green and parallel with zero Neon branches.

**Phase 2 — Shadow projections. Reads still served by Neon.**
Project `organizations`, `organization_memberships`, `entitlements` into D1. Dual-read: serve from Neon, compare against D1, log divergence. Build the reconciliation job and the contract tests. **Do not proceed until divergence is provably zero over a sustained window** — per `feedback_idempotency_fix_validated_against_state_it_destroys`, run it twice and trust only the second run.

**Phase 3 — Cut public reads to D1. First real win.**
Org landing, content detail, catalogue. Highest bot amplification, zero financial risk, read-only. Enable read replication with the Sessions API. **Measure the Neon compute delta here** — this is the number that justifies the rest. Per `feedback_verify_before_close`, browser-verify every public page, and per `feedback_a_dns_listing_is_not_config_truth`, test the *mechanism* rather than reading a before/after graph across bursty bot traffic.

**Phase 4 — Studio writes to D1.**
Content/media/course/settings CRUD. Convert the 28 interactive transactions to guarded `batch()` (§8). Add the counter DOs (§9.2) before turning on view counting.

**Phase 5 — Engagement writes to D1.**
`video_playback`, followers, enrollments, completions. Decide the retention policy first (§10).

**Phase 6 — Reap the saving.**
Only now can Neon's compute be sized down or allowed to autosuspend. Re-measure; decide whether the CI branch strategy can also shrink.

---

## 13. What must not move

Stated explicitly so it doesn't get re-litigated later:

- **`purchases`, `payouts`, `pending_payouts`, `refund_reviews`, `subscriptions`, all `fee_config_*`, all agreement tables** — need interactive transactions, exact audit retention, 30-day PITR, and cross-tenant financial reporting.
- **`entitlements` (the source)** — D1 gets a projection; Neon keeps the truth.
- **`users`, `sessions`, `accounts`, `verification`** — BetterAuth's Postgres adapter; identity is global, not tenant-scoped. Sessions are already KV-cached.
- **`organizations`, `organization_memberships`** — the tenant *directory* must be global to resolve a slug before you know which tenant you're in. Projected, not moved.
- **`.for('update')` semantics** — the two existing row locks stay on Neon. There is no D1 equivalent, and the correct D1 answer is a different pattern, not a translation.

---

## 14. Decisions I need from you

1. **`email_audit_logs`** — audit trail (→ Neon, retention/compliance) or high-volume operational log (→ D1, or better: R2 / Workers Logs / Analytics Engine)? I've defaulted it to Neon. It's 10 columns and grows per email sent, so if volume is high, the third option is probably right.
2. **Soft-delete vs the 10 GB ceiling** — your strict rule is *never* hard-delete, but soft-deleted rows consume D1 storage. Do you accept "archive to Neon after N days, then hard-delete from D1" for the tenant plane? What is N?
3. **`video_playback` retention** — prune rows untouched for >12 months? This is the single biggest determinant of whether you ever need to shard.
4. **Article bodies to R2** — worth doing in Phase 1 (removes the storage ceiling as a concern for years), or deferred until a measured threshold?
5. **Timestamp encoding** — integer-ms (my recommendation: better indexing and range scans) or text-ISO (more readable in `wrangler d1 execute` output)? This is irreversible in practice across 138 columns.
6. **Scope of first cut** — Phase 0 alone is a contained fix with immediate value against a live P0. Do you want it landed and measured before committing to Phases 1–6?

---

## 15. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Projection drift → silent access-control bugs | **High** | Contract tests + continuous reconciliation from Phase 2; fail-safe write ordering (§5); Neon fallback on D1 miss |
| 188 raw `sql`` ` templates hide dialect assumptions | **High** | Individual audit, not find-and-replace; the 168 `INTERVAL`/`NOW()` uses depend on the timestamp decision |
| Single-threaded D1 write contention | Medium | Counter DOs; instrument p95 duration and `overloaded` rate, not GB |
| 10 GB ceiling reached sooner than modelled | Medium | Article bodies → R2; playback retention; tripwires from day one |
| Two dialects → schema divergence over time | Medium | Both chains generated by `drizzle-kit`, never hand-written; a CI check asserting the two schemas agree on shared columns |
| Migration stalls half-done, leaving two stores and no saving | **High** | Phases are independently shippable; Phase 0 delivers value alone; Phase 3 is the measurement gate before further investment |
| `ilike` → `like` silently changes non-ASCII search | Low | Pin behaviour with tests written *before* the change |
| Neon cost doesn't fall as much as hoped | Medium | Phase 3 measures the delta before Phases 4–6 are committed |

---

## Appendix: how these figures were derived

- **Schema**: parsed all 22 files in `packages/database/src/schema/` — 49 `pgTable` declarations, column types, FK references, `onDelete` behaviours.
- **Join graph**: statement-level extraction of `.from(X)` paired with `.innerJoin/.leftJoin/.rightJoin/.fullJoin(Y)` across 775 files in `packages/` and `apps/web/src`, excluding `__tests__`, `*.test.ts`, `__denoise_proofs__`, `dist/`. 41 distinct pairs, ~100 instances. Two pairs resolved to subquery aliases rather than tables and were excluded.
- **Dialect probes**: 16 regex probes over the same 775 files, counted by occurrence and by distinct file.
- **Transactions**: `grep` for `.transaction(` per package; `content-service.ts:237` read in full to establish the read-then-write shape.
- **Platform limits**: fetched live 2026-08-29 from `developers.cloudflare.com` (D1 limits, D1 pricing, D1 read replication, D1 Worker API, DO limits, DO pricing, DO SQL storage, Vitest integration isolation) plus the SaaS data-isolation guidance and workerd discussion #3564.
- **Not measured**: actual production row counts and table sizes. **All storage projections in §10 are modelled, not observed.** Before committing to Phase 1, run `pg_total_relation_size()` per table against production and replace the estimates.

### Sources

- [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) · [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) · [D1 read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/) · [D1 Worker API](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/) · [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) · [DO SQL storage](https://developers.cloudflare.com/durable-objects/api/sql-storage/)
- [Workers Vitest isolation and concurrency](https://developers.cloudflare.com/workers/testing/vitest-integration/isolation-and-concurrency/) · [Write your first test](https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/)
- [Cloudflare SaaS data isolation](https://developers.cloudflare.com/use-cases/saas/data-isolation/) · [workerd #3564: dynamic D1 bindings](https://github.com/cloudflare/workerd/discussions/3564) · [Outgrowing D1 at 421 tenant databases](https://sushidata.com/blog/2026/05/19/outgrew-cloudflare-d1-everything-tried-building-solution/)
