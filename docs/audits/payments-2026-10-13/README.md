# Payments investigation — 2026-10-13

Working material from a full investigation of every payment, money and access surface
(one-off purchases, subscriptions, Stripe Connect, payouts, fees, revenue-share agreements,
entitlements/access, web/admin UI, config, tests). This is **evidence, not the canonical docs** —
the canonical rewrite is the next task and belongs in `docs/payments/` (plan below).

## Files

| File | What it is | Trust level |
|---|---|---|
| `bug-ledger.md` | Every bug found — stable IDs (SEC/PAY/SUB/AGR/WEB/CFG/TEST/X), severity, evidence, effect — plus policy questions and owner checks | Status column per row: **V** lead traced in code · **D** verified against Stripe docs · **A** agent-traced only · **S** suspected |
| `verified-findings.md` | Architecture facts the lead verified first-hand + the first doc-drift list | Verified |
| `report-purchases.md` | Full deep-dive: one-off content/course purchases, refunds, disputes, fee math, entitlements | Agent report (key claims re-verified — see ledger) |
| `report-subscriptions.md` | Full deep-dive: tiers, subscription lifecycle, course subs, Connect, payouts pipeline, webhooks | Agent report (key claims re-verified) |
| `report-surfaces.md` | Full deep-dive: agreements, every web/admin money journey, config inventory, test coverage | Agent report (key claims re-verified) |
| `payment-docs-scored.txt` | Inventory of 345 markdown files mentioning payment terms, ranked by term density (`hits lines path`) | Raw data for the docs cleanup |

## Headline

- **Charge model:** separate charges & transfers ("Codex-h69cg Option B"). Platform is merchant of record; every slice is a `transfers.create(source_transaction=chargeId)`. Several docs wrongly say "destination charges".
- **Critical bugs:** SEC-01 (`/connect/dashboard` IDOR), PAY-01 (transient webhook failures acked 200), SUB-03 (tier price change re-bills every subscriber, interval-blind), CFG-08/08b (production webhook delivery broken — being repaired).
- **Systemic:** webhook/cron code hand-builds services without `FeeConfigService`, so the `fee_config_*` tables have no effect on one-off sales or org-subscription invoices.

## Owner decisions (2026-10-13) — binding for the fix PR

All recorded in the bug ledger and in Claude memory `project_payments_decisions_2026_10_13.md`.

- **Rule:** agree intended behaviour BEFORE fixing.
- **SEC-01:** payout (Express) dashboard only for the person who owns that Connect account; retire org-level `/connect/*?organizationId=` routes (keep `/connect/me/*` + one read-only org status endpoint).
- **SUB-03:** existing subscribers move to a changed tier price at their NEXT RENEWAL (no immediate charge, no proration); email at time of change, applies at first renewal ≥30 days later; Studio is the ONLY place prices are set (Stripe Dashboard price edits are logged as drift, not applied).
- **Ownership (fixes SUB-22 + SEC-03):** exactly ONE owner per org = its creator, DB-enforced; only the owner can transfer ownership; owner must transfer before leaving; org money always routes to the current owner (remove the `primary_connect_account_user_id` pin); new owner without payouts → org money held pending until set up; money earned before a transfer stays with the old owner; platform owner assigns a new owner if transfer is impossible; no migration concerns (pre-launch data is deletable). Ownership-transfer UI needs an HTML mockup + data design FIRST.
- **PR shape:** ALL of these fixes in ONE PR.
- **Stripe:** production runs on the "Codex sandbox" (`acct_1SMY6J7wyGmo4sh6`, test mode) on purpose — the site is not live. Local dev shares the same sandbox and should receive the same events. No new sandbox.

## Stripe production repair — COMPLETE (2026-10-13)

Webhook signing secrets in GitHub env `production` (set 2026-07-14) did not match the sandbox endpoints (prod returned 401 on every delivery). Every endpoint was recreated with a fresh secret, the correct scope and the events its handler processes.

| Endpoint | State |
|---|---|
| connect `we_1UQ71a7wyGmo4sh6qjaGNKFW` | DONE — `connect: true` (account.updated, account.application.deauthorized); old `we_1SO1f47…` disabled. Not yet exercised by a real `account.updated` (first real onboarding proves it) |
| subscription `we_1UQ75i7wyGmo4sh6e12nck3K` | DONE — 11 events; VERIFIED by a real Stripe delivery (200, 14:54:57Z); old `we_1SO1ee7…` disabled |
| booking `we_1UQ7HY7wyGmo4sh6BYwlrb80` | DONE — `checkout.session.completed` (payment mode; the subscription handler skips it, `checkout.ts:94`); VERIFIED by a self-signed event (200 + "Webhook signature verified", 15:09Z); old `we_1SO1fj7…` disabled |
| payment `we_1UQ7HZ7wyGmo4sh6x477bv6C` | DONE — `charge.refunded`; VERIFIED (self-signed, 200); a wrong-secret control returned 401; old `we_1SO1eQ7…` disabled |
| dispute `we_1UQ7Ha7wyGmo4sh6CuTHPE8O` | DONE — `charge.dispute.created/updated/closed`, `radar.early_fraud_warning.created`; VERIFIED (self-signed, 200); old `we_1SO1fz7…` disabled |
| customer `we_1SO1fH7wyGmo4sh612lL8e29` | DISABLED — log-only stub with no handler (`index.ts` `createWebhookHandler('Customer')`); a Stripe-deleted customer already self-heals at checkout (`resolve-customer.ts`, `resource_missing` → clear + retry). Remove the route + `STRIPE_WEBHOOK_SECRET_CUSTOMER` in the fix PR |

Self-signed verification: `scratchpad/sigcheck.mjs` signs `"<t>.<body>"` with HMAC-SHA256 keyed by the endpoint secret (Stripe's scheme) and posts an inert payload (booking: `mode: "setup"` → "Skipping non-payment checkout session"; payment/dispute: unknown type → "Unhandled payment webhook event"). It proves worker-secret = Stripe-secret without creating any Stripe objects.

Procedure per endpoint (owner-approved; secrets may pass through the chat — test mode):
1. Stripe MCP `PostWebhookEndpoints` (response contains `secret`).
2. `printf '%s' '<whsec>' | gh secret set <NAME> --env production` (secrets live ONLY in GitHub env `production`, none at repo level).
3. `cd workers/ecom-api && printf '%s' '<whsec>' | npx wrangler secret put <NAME> --env production` (target worker `ecom-api-production`; the worker only otherwise gets secrets at deploy time).
4. Disable the old endpoint (`PostWebhookEndpointsWebhookEndpoint` `disabled: true`).
5. Verify: run `npx wrangler tail ecom-api-production --format json` in the background, trigger a harmless event (metadata-only update), expect 200 "Webhook signature verified". (macOS has no `timeout`; stop the tail with TaskStop.)

Harmless test residue: `metadata.codex_webhook_check` added to product `prod_VQxdy6xND9Mkm4` and customer `cus_VQxMJ5zoFoPpps`.

Other Stripe findings: default Billing Portal config `bpc_1T92kO7wyGmo4sh6wT8InTS2` has **subscription_cancel ENABLED** (violates the portal-lockdown rule; code passes no `configuration`). Owner check #4 ANSWERED: yes — Express connected accounts can change their payout bank account in the Express Dashboard by default; the owner wants creators able to do this, so the SEC-01 fix must keep a self-scoped login link.

## Canonical docs plan — APPROVED 2026-10-13

Owner (verbatim): "Approve deleting the old payment docs. We should fix the defects before we describe the current behavior. We should describe the behavior we desire. It should be filed as beats [beads]." → the new docs are a SPEC of desired behaviour, not a description of today's code.

New home `docs/payments/`: `README.md` (system map, charge model, why), `purchases.md`, `subscriptions.md`, `fees-and-splits.md`, `agreements.md`, `connect-and-payouts.md`, `access.md`, `operations.md` (webhooks, Stripe Dashboard checklist, environment → Stripe account table, local dev), `known-defects.md` (or links to beads).

DELETED 2026-10-13 on branch docs/Codex-2hxff.26-payments-spec after reading each (anything still true moved into docs/payments/): `docs/payouts/*`, `docs/agreements/README.md`, `docs/stripe-connect-subscription-reference.md`, `docs/subscription-cache-audit/*`. Owner's call (repo-wide): the 23 `GEMINI.md` files frozen 2026-01-20, payment material under `docs/archive/`.

Slim to rules + pointer: package CLAUDE.md files (purchase, subscription, agreements, admin, database), `workers/ecom-api/CLAUDE.md`, root `CLAUDE.md` navigation + admin-analytics claim; skill docs `.claude/skills/backend-dev/references/06-stripe-integration.md` and `.claude/skills/codex-review/agents/commerce-stripe.md`; ~15 stale code comments (listed across the reports' drift sections). Docs describe DESIRED behaviour (owner decision, superseding the earlier recommendation).
