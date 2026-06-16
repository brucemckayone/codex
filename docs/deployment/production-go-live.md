# Production Go-Live Runbook — Codex Platform

> First-ever production deployment to **`revelations.studio`**.
> Tracked by beads epic **Codex-730tq**. Plan: `~/.claude/plans/time-to-prep-this-reflective-walrus.md`.
> **Launch bar:** infrastructure-up with **Stripe in TEST mode** (no real money). The live-key flip is a separate later checklist (Appendix C).

---

## 0. Mental model — read first

- **The deploy pipeline is already proven on dev.** `deploy-dev.yml` deploys all 8 API workers + web to `dev.revelations.studio` on every push to `dev`, green in ~4 min. The Cloudflare account, the `revelations.studio` zone, wrangler auth, R2 IaC, and DNS scripts all work. Production reuses the same machinery with `--env production`.
- **`main` is ~981 commits behind `dev`.** The team develops on `dev` and periodically **promotes `dev → main`** (last: `f8d12bca …#243`). `deploy-production.yml` triggers off `main`. **Therefore the real "ship to prod" action is a `promote dev → main` (Step 9).** Until then, production has never deployed (every historical `Production Deployment` run shows `skipped`).
- **Two kinds of work below:**
  - 🟦 **In-repo** — done in the `chore/prod-go-live-prep` PR (KV isolation, dead-B2 removal, doc/comment fixes). One item (KV IDs) is blocked on you running Step 1.
  - 🟩 **External** — you execute these (accounts, secrets, DNS, dashboards). Commands provided.

---

## 1. In-repo blocker status (PR `chore/prod-go-live-prep`)

| WP | Item | State |
|---|---|---|
| A2 | Remove dead B2 required-env from media-api (would 500 prod on first request) | ✅ done in PR |
| A5 | Verify all `env.production` R2 bindings = `codex-*-production` | ✅ verified, no change needed |
| A6 | Remove stale `SESSION_SECRET` note in `apps/web/wrangler.jsonc` | ✅ done in PR |
| A3 | Production deploy trigger | ✅ verified correct (no code change) — needs GitHub Environment + secrets (Step 8) |
| A4 | auth-worker staging KV bindings | ⏸ deferred (only blocks a *staging* deploy, not prod) |
| **A1** | **Production KV namespace isolation** | ⛔ **BLOCKED on Step 1** — see below |

### ⛔ A1 — the one in-repo edit gated on you

Today, `env.production` for `RATE_LIMIT_KV` (`cea71…`) and `AUTH_SESSION_KV` (`82d04…`) reuses the **same physical namespace IDs as the live dev environment**. If prod goes live as-is, a dev login/logout churns prod sessions and rate-limit counters collide. **This must be fixed before launch.** The fix needs 3 new prod-only namespace IDs from Step 1, then a mechanical edit across the 8 API workers + web app (the implementer wires these once you paste the IDs back).

---

## 2. Step-by-step

### Step 1 — Cloudflare KV (create 3 prod-only namespaces) 🟦+🟩

From repo root, authenticated wrangler:

```bash
npx wrangler kv namespace create "RATE_LIMIT_KV_PRODUCTION"
npx wrangler kv namespace create "AUTH_SESSION_KV_PRODUCTION"
npx wrangler kv namespace create "CACHE_KV_PRODUCTION"
```

Each prints an `id`. **Paste all 3 IDs back to the implementer** to complete WP-A1. They will be written into the `env.production.kv_namespaces[].id` of:
- `RATE_LIMIT_KV` + `AUTH_SESSION_KV` → all 8 API workers (`auth, content-api, organization-api, ecom-api, admin-api, identity-api, notifications-api, media-api`)
- `CACHE_KV` → `content-api, ecom-api, organization-api, admin-api, identity-api` **and** `apps/web/wrangler.jsonc`

> ⚠️ A wrong/duplicated KV ID is a silent session-bleed. The implementer will diff each `env.production` block against these 3 IDs before merge.

### Step 2 — Cloudflare R2 buckets + custom domains 🟩

The bucket topology lives in `.github/config/r2-infrastructure.json` (4 types × envs: `assets`, `media`, `platform`, `resources`). Provision + attach `cdn-*.revelations.studio` custom domains + cache rules:

```bash
# Requires CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_ZONE_ID in env
./.github/scripts/manage-r2-infrastructure.sh apply production
./.github/scripts/manage-r2-infrastructure.sh verify production
```

Confirms `codex-media-production` + `codex-assets-production` exist (the buckets every R2-using worker binds — verified in WP-A5).

### Step 3 — DNS records 🟩

```bash
./.github/scripts/manage-production-dns.sh create
./.github/scripts/manage-production-dns.sh verify
```

Creates records for: the 8 worker subdomains (`auth.`, `content-api.`, …`.revelations.studio`), apex `revelations.studio`, `www`/`codex`/`creators`, the R2 `cdn-*` CNAMEs, and the **wildcard `*.revelations.studio`** that org subdomains depend on.

> Worker custom domains are also created by wrangler itself (`custom_domain`/`routes` in each `wrangler.jsonc`) on first `--env production` deploy. The DNS script handles apex + wildcard + CDN.

### Step 4 — Neon production DB 🟩 (branch already provisioned ✓)

- Confirm the production-branch `DATABASE_URL` is the **direct** (non-pooler) connection string. Migrations run DDL, and **the Neon pooler drops connections mid-DDL** ([[neon-pgbouncer-ddl-breaks]]). The deploy workflow runs `pnpm --filter @codex/database db:migrate` against `secrets.DATABASE_URL` — set that secret to the direct URL.
- Workers at runtime can use the pooled URL via `DB_METHOD=PRODUCTION`; only the migrate step needs direct.

### Step 5 — Stripe (TEST mode for launch) 🟩

In the Stripe **test** dashboard:
1. Register 6 webhook endpoints (all → `https://ecom-api.revelations.studio`):
   - `/webhooks/stripe/payment`
   - `/webhooks/stripe/subscription`
   - `/webhooks/stripe/connect`  ← enable **"Listen to Connect events"** (`connect: true`) — see closed bead Codex-3jht
   - `/webhooks/stripe/customer`
   - `/webhooks/stripe/booking`
   - `/webhooks/stripe/dispute`
2. Capture each endpoint's `whsec_…` signing secret → the 6 `STRIPE_WEBHOOK_SECRET_*` secrets.
3. Ensure **Connect** is enabled (test) for creator payouts/transfers.
4. Create/confirm the **locked Customer Portal** config ([[stripe-portal-lockdown]]: subscription cancel/pause/update disabled) → `STRIPE_PORTAL_CONFIGURATION_ID`.
5. Use the **test** secret key for `STRIPE_SECRET_KEY` (`sk_test_…`).

### Step 6 — RunPod 🟩 (endpoint already provisioned ✓)

- Capture `RUNPOD_API_KEY`, `RUNPOD_ENDPOINT_ID`, `RUNPOD_WEBHOOK_SECRET`.
- Set the RunPod webhook to `https://media-api.revelations.studio/api/transcoding/webhook`.
- **No B2 / Backblaze** — removed from scope (storage is R2; the container holds its own creds in RunPod's secret manager).

### Step 7 — Resend 🟩 (domain already verified ✓)

- Confirm the production from-address domain is verified in Resend (SPF/DKIM DNS records present).
- Capture `RESEND_API_KEY`.

### Step 8 — GitHub `production` Environment + secrets 🟩

1. **Settings → Environments → New environment → `production`.** Add **required reviewers** (this is the manual-approval gate `deploy-production.yml` relies on).
2. Populate the **secrets matrix** (Appendix A) as **Environment secrets**. `upload-worker-secrets.sh production <worker>` (run by the workflow) reads these and bulk-pushes per worker via wrangler.
3. For this launch, all Stripe values are **test-mode** keys.

### Step 9 — Promote `dev → main` 🟩  ⚠️ the real ship

This moves ~981 commits of integrated work onto `main`. Do this **after** the `chore/prod-go-live-prep` PR is merged into `dev` (so A1's KV fix is included) and `dev` CI is green.

```bash
# however the team conventionally promotes — e.g. a PR dev → main, or:
git checkout main && git merge --ff-only dev   # if fast-forwardable
git push origin main
```

Confirm `PR and Push CI (Neon ephemeral DB)` runs green on the `main` push.

### Step 10 — Deploy to production 🟩

First go-live via manual dispatch (bypasses the workflow_run gate):

```bash
gh workflow run deploy-production.yml
```

Then **approve** the run in the `production` Environment. The workflow: DNS verify → build → **migrate (direct URL)** → deploy 8 workers (`upload-worker-secrets.sh` per worker) → deploy web → 30s settle → smoke-test 9 services (all must return 2xx). After this, future `dev → main` promotions auto-deploy.

### Step 11 — Verify "actually working" 🟦 (Playwright MCP + Stripe test cards)

The smoke gate proves *reachability*; this proves *function*:
1. **Register** a user → session cookie set on `revelations.studio`.
2. **Create an org** → `{slug}.revelations.studio` resolves (validates wildcard DNS + reroute). ⚠️ see Risk Codex-0lml6 below.
3. **Upload media** → transcode runs (RunPod → webhook → status `ready`) → **publish**.
4. **Browse** public content; generate an HLS streaming URL → playback works.
5. **Purchase** with a Stripe **test** card → webhook → access grant → stream gated content.
6. Confirm crons fire clean: ecom-api payout sweep (`*/15`), media-api stuck-transcode recovery (`0 * * *`).
7. **KV isolation check:** log out on `dev.revelations.studio`; confirm the prod session on `revelations.studio` is **unaffected** (validates WP-A1).

---

## Appendix A — Production secrets matrix (GitHub `production` Environment)

| Scope | Secrets |
|---|---|
| Platform / shared | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_DNS_API_TOKEN`, `DATABASE_URL` (prod, **direct**), `WORKER_SHARED_SECRET`, `BETTER_AUTH_SECRET`, `SESSION_SECRET` (auth), `TURBO_TOKEN` |
| ecom-api (**TEST** keys) | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET_{PAYMENT,SUBSCRIPTION,CONNECT,CUSTOMER,BOOKING,DISPUTE}`, `STRIPE_PORTAL_CONFIGURATION_ID` |
| content-api | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` |
| media-api | `RUNPOD_API_KEY`, `RUNPOD_ENDPOINT_ID`, `RUNPOD_WEBHOOK_SECRET` *(no B2)* |
| notifications-api | `RESEND_API_KEY` |

> **Secret hygiene:** never paste secrets into chat, PRs, or `.dev.vars` committed files. Inject only via GitHub Environment secrets or `wrangler secret put`. Rotate any secret that has touched an insecure channel.

## Appendix B — Known risks / open items

- **Codex-0lml6 (OPEN, P1):** "Org subdomain SSR/route 500 + 404 regression on dev." Production depends on the same wildcard-subdomain reroute. **Verify this is resolved on dev before Step 9**, or org landing pages may 500 in prod.
- **WP-A4 (deferred):** auth-worker `env.staging` has no KV bindings. Only bites if you deploy *staging*; not required for this prod launch.
- **Rollback:** workers are versioned in Cloudflare — `wrangler rollback --env production` per worker if a smoke check fails. DB migrations are forward-only; avoid destructive migrations in the go-live promotion.

## Appendix C — Later: flip Stripe to LIVE mode (separate change)

1. Swap `STRIPE_SECRET_KEY` → `sk_live_…`.
2. Re-register all 6 webhook endpoints in the **live** dashboard; capture live `whsec_…` → update the 6 secrets.
3. Enable **Connect** in live; complete platform Connect onboarding/KYC.
4. Recreate the locked **Customer Portal** config in live → update `STRIPE_PORTAL_CONFIGURATION_ID`.
5. Confirm your terms/tax/dispute handling are launch-ready before accepting real payments.
