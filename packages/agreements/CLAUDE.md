# @codex/agreements

Revenue-share agreement state machine and share math for creator↔organization relationships. Operates on the `creator_organization_agreements` / `agreement_proposals` schema and feeds the payout pipeline.

**Behaviour lives in the payments spec:** [docs/payments/agreements.md](../../docs/payments/agreements.md) — share units, negotiation, the review date, ending an agreement, and how a share applies to each kind of sale. It marks every place the code does not match yet with its bead.

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
  environment, // an EnvName; throws at construction otherwise (it builds the email links)
  mailer?,     // AgreementLifecycleMailer; omit to skip notifications
  waitUntil?,  // threads ExecutionContext.waitUntil so mail dispatch never blocks the response
});
```

## Invariants

- Owner lookups filter `organizationMemberships.status = 'active'` — a removed owner keeps `role='owner'` with `status='inactive'` and must never resolve as a party
- Share math is integer-only (basis points); `sumActiveCreatorShares` + org share must satisfy the invariant in `agreement-math.ts`
- Pending proposals have NO agreement row yet — proposal reads and agreement reads are separate paths by design
- A share is basis points of the **post-platform** pool. Read it from the accepted proposal (`proposed_creator_share_percent`); never read the legacy `organization_fee_percentage` (`10000 − share`) in new code
- Every agreement email link comes from `buildAgreementEmailLink` (`agreement-links.ts`): the owner goes to their org Studio's revenue-share page, the creator to the `creators` subdomain's negotiations. It is built from the env name, never from `WEB_APP_URL` (the apex has no Studio) or a request host (staging's `parseHost` reports the production apex)
- The term is a **review date**, not an expiry — either side may terminate at any time, and an agreement keeps paying after its review date until it is ended

## Strict Rules

- All queries scope by creatorId/organizationId — see root [CLAUDE.md](../../CLAUDE.md)
- Soft delete only; typed `ServiceError` subclasses; `handleError()` on public methods

## Reference Files

- `packages/agreements/src/services/agreement-service.ts`
- `packages/agreements/src/services/agreement-math.ts`
- `packages/agreements/src/types.ts`
