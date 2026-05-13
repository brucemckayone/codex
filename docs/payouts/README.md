# Payouts

How creators and orgs get paid on the Codex platform.

| Doc | Scope |
|---|---|
| [payout-pipeline.md](./payout-pipeline.md) | End-to-end flow — invoice → split → transfers → pending payouts → primary drain (webhook) → safety-net drain (cron). Currency enforcement, idempotency keys, observability surface, emergency SQL. |
| [fee-configuration.md](./fee-configuration.md) | The **rates** side — 3-tier DB-configurable fee model (platform → org → creator-override), version-cache invalidation, audit logging, `/api/admin/fees/*` endpoints. |

## Quick map

- **"How much does each party get?"** → [fee-configuration.md](./fee-configuration.md)
- **"When does the money actually move?"** → [payout-pipeline.md](./payout-pipeline.md)
- **"Why is a creator stuck on a pending balance?"** → [payout-pipeline.md → Emergency SQL inspection](./payout-pipeline.md#emergency-sql-inspection)
- **"How do I add a new transfer call site?"** → [payout-pipeline.md → Currency invariant](./payout-pipeline.md#currency-invariant-codex-yv18n)

## Owning epic

Payouts audit — **Codex-b1hgr** (closed 2026-05-13). 8 PRs landed across the
two domains; see the audit history table at the end of
[payout-pipeline.md](./payout-pipeline.md#audit-history-codex-b1hgr-closed-2026-05-13).
