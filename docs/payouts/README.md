# Payouts

How creators and orgs get paid on the Codex platform.

| Doc | Scope |
|---|---|
| [payout-pipeline.md](./payout-pipeline.md) | End-to-end flow — invoice → split → transfers → pending payouts → primary drain (webhook) → safety-net drain (cron). Currency enforcement, idempotency keys, observability surface, emergency SQL. |
| [fee-configuration.md](./fee-configuration.md) | The **rates** side — 3-tier DB-configurable fee model (platform → org → creator-override), version-cache invalidation, audit logging, `/api/admin/fees/*` endpoints. |
| [../agreements/README.md](../agreements/README.md) | The **per-creator share** side — revenue-share agreements model, owner-creator negotiation lifecycle, share validation math, payout-pipeline integration. |

## Quick map

- **"How much does each party get?"** → [fee-configuration.md](./fee-configuration.md) (platform-level rates) + [../agreements/README.md](../agreements/README.md) (per-creator splits)
- **"When does the money actually move?"** → [payout-pipeline.md](./payout-pipeline.md)
- **"Why is a creator stuck on a pending balance?"** → [payout-pipeline.md → Emergency SQL inspection](./payout-pipeline.md#emergency-sql-inspection)
- **"How do I add a new transfer call site?"** → [payout-pipeline.md → Currency invariant](./payout-pipeline.md#currency-invariant-codex-yv18n)
- **"Why did a co-creator get £0 on a subscription invoice?"** → [Multi-Creator Revenue-Share Agreements](#multi-creator-revenue-share-agreements-2026-05-17) (below)

## Multi-Creator Revenue-Share Agreements (2026-05-17)

The payout pipeline now supports per-creator revenue splits via the agreements
model. See [../agreements/README.md](../agreements/README.md) for the full system —
data model, state machine, math, locked decisions, API surface, and UX flows.

### Where splits apply

- **Subscription invoices** use `revenue_type='subscription'` agreements,
  queried at invoice fire time per `handleInvoicePaymentSucceeded` in
  `@codex/subscription`. The post-platform pool is divided per active
  creator share; the org keeps the residual.
- **Content-purchase webhooks** use `revenue_type='content_purchase'`
  agreements, scoped to the uploader (`content.creatorId`) per the
  locked Q1 decision — each creator's content earns under THEIR
  agreement, never a pooled bucket.
- **Absence of agreement** falls through to the legacy "org keeps all
  post-platform" behaviour (backwards-compatible — pre-WP-1 rows still
  resolve via the synthesised proposal row inserted by migration 0072).

### The bug this fixed

Before 2026-05-17, the payout pipeline checked `creator_organization_agreements`
but no UI created rows in that table. Co-creators on an org's team
received £0 on subscription invoices. The agreement-management surface
in WP-7 (owner) + WP-8 (creator) closes that gap.

Regression guard: the `WP-4: original bug repro — co-creator with active
subscription agreement gets their cut` test in
`packages/subscription/src/services/__tests__/subscription-service.test.ts`
is the canonical proof. With `gross=1000`, `platform=10%` (100),
`post-platform=900`, a 30%-share co-creator receives
`floor(900 × 3000 / 10000) = 270` pence; the org keeps the 70%
residual = 630 pence via `${chargeId}_org_fee`.

### Unit semantic crossover

The agreements model uses **post-platform basis points** for creator
shares — see the `agreement-math.ts` ADR header reproduced in
[../agreements/README.md → Unit Semantics](../agreements/README.md#unit-semantics-load-bearing).
The payout pipeline's `calculateRevenueSplit()` in `@codex/subscription`
treats the platform fee as a fraction of gross and then divides the
post-platform pool per agreement — the units match.

## Owning epic

Payouts audit — **Codex-b1hgr** (closed 2026-05-13). 8 PRs landed across the
two domains; see the audit history table at the end of
[payout-pipeline.md](./payout-pipeline.md#audit-history-codex-b1hgr-closed-2026-05-13).

Revenue-share agreements epic — **Codex-nk4km** (Phase 1 + Phase 2 in
flight 2026-05-17). 11 WPs landing the data model, service layer,
worker routes, payout-pipeline integration, owner + creator UI, FocusRail
prompts, end-to-end Playwright tests, and the documentation in
[../agreements/README.md](../agreements/README.md).
