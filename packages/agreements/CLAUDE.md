# @codex/agreements

Revenue-share agreement state machine and share math for creator↔organization relationships. Operates on the `creator_organization_agreements` / `agreement_proposals` schema and feeds the payout pipeline.

## Key Exports

- **`AgreementService`** — proposal lifecycle (propose → counter → accept/decline/withdraw → terminate) and active-agreement reads
- **`validateProposedShare`** / **`sumActiveCreatorShares`** — share validation math (integer basis points, both bounds checked)
- **`creatorShareFromLegacyOrgFee`** / **`legacyOrgFeeFromCreatorShare`** — conversion between the legacy org-fee percent model and creator-share
- **`formatRevenueTypeLabel`** — revenue-type labels for emails/reports

## Usage

Construction is normally via the worker service registry (`ctx.services.agreements`). For tests:

```ts
const service = new AgreementService({
  db,          // dbWs for the transactional accept/terminate paths
  environment,
  webAppUrl,   // MANDATORY — throws at construction if unset (email deep-links)
  mailer?,     // AgreementLifecycleMailer; omit to skip notifications
  waitUntil?,  // threads ExecutionContext.waitUntil so mail dispatch never blocks the response
});
```

## Invariants

- Owner lookups filter `organizationMemberships.status = 'active'` — a removed owner keeps `role='owner'` with `status='inactive'` and must never resolve as a party
- Share math is integer-only (basis points); `sumActiveCreatorShares` + org share must satisfy the invariant in `agreement-math.ts`
- Pending proposals have NO agreement row yet — proposal reads and agreement reads are separate paths by design

## Strict Rules

- All queries scope by creatorId/organizationId — see root [CLAUDE.md](../../CLAUDE.md)
- Soft delete only; typed `ServiceError` subclasses; `handleError()` on public methods

## Reference Files

- `packages/agreements/src/services/agreement-service.ts`
- `packages/agreements/src/services/agreement-math.ts`
- `packages/agreements/src/types.ts`
