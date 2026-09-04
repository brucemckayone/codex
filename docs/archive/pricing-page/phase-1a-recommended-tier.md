# Phase 1A: `isRecommended` Flag on Subscription Tiers

**Version**: 1.1 (post-review)
**Date**: 2026-04-15
**Status**: Implementation-ready
**Depends on**: Nothing (independent)
**Blocks**: Phase 2 (Pricing Page Frontend), Phase 3A (Studio Toggle)

---

## 1. Overview

Add a creator-selectable `isRecommended` boolean flag to subscription tiers. This allows org owners to designate one tier as "recommended" — the pricing page will highlight it with a brand-primary glow border and "Most Popular" badge.

### Business Rule

Only one tier per org can be `isRecommended = true` at any time. The constraint is enforced at the service layer (not DB), matching the existing pattern for `sortOrder` uniqueness.

### Fallback

If no tier is marked recommended, the pricing page frontend auto-selects the middle tier by `sortOrder` (classic pricing psychology — centre option gets highest conversion).

---

## 2. Database Schema

### File: `packages/database/src/schema/subscriptions.ts`

Add `isRecommended` after the existing `isActive` field (line 47):

```ts
isActive: boolean('is_active').notNull().default(true),
isRecommended: boolean('is_recommended').notNull().default(false),
```

### Why no unique index?

The uniqueness constraint ("only one recommended per org") is **conditional** — it only applies among active, non-deleted tiers. Postgres partial unique indexes could express this, but the codebase pattern (see `sortOrder` enforcement) handles these constraints at the service layer. This keeps the DB schema simple and the logic testable.

### Soft-delete cleanup

When a tier is soft-deleted via `deleteTier()`, clear `isRecommended` alongside `isActive`:

```ts
.set({ deletedAt: new Date(), isActive: false, isRecommended: false })
```

This prevents stale recommended flags on deleted tiers from confusing `ensureSingleRecommended` queries.

### Migration

Run from monorepo root:

```bash
cd packages/database && pnpm db:generate
# Review generated migration (should be 0052_*.sql)
pnpm db:migrate
```

Expected SQL:

```sql
ALTER TABLE "subscription_tiers" ADD COLUMN "is_recommended" boolean DEFAULT false NOT NULL;
```

---

## 3. Validation Schemas

### File: `packages/validation/src/schemas/subscription.ts`

Add `isRecommended` to `baseTierSchema` (line 46–67):

```ts
const baseTierSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Tier name is required')
    .max(100, 'Tier name must be 100 characters or less'),
  description: z
    .string()
    .trim()
    .max(500, 'Description must be 500 characters or less')
    .optional(),
  priceMonthly: z
    .number()
    .int('Price must be a whole number (pence)')
    .min(100, 'Minimum price is £1.00 (100 pence)')
    .max(10000000, 'Maximum price is £100,000'),
  priceAnnual: z
    .number()
    .int('Price must be a whole number (pence)')
    .min(100, 'Minimum price is £1.00 (100 pence)')
    .max(10000000, 'Maximum price is £100,000'),
  isRecommended: z.boolean().optional(),  // <-- NEW
});
```

This automatically flows into `CreateTierInput` and `UpdateTierInput` (inferred types from `createTierSchema` and `updateTierSchema`).

---

## 4. Service Layer

### File: `packages/subscription/src/services/tier-service.ts`

### 4.1 New private method: `ensureSingleRecommended`

Add after the constructor (line 54):

```ts
/**
 * Ensure only one tier per org is recommended.
 * Clears isRecommended on all other active tiers for the org.
 * Called INSIDE a transaction with the insert/update to prevent race conditions.
 */
private async ensureSingleRecommended(
  tx: Parameters<Parameters<typeof import('@codex/database').dbWs.transaction>[0]>[0],
  orgId: string,
  excludeTierId?: string
): Promise<void> {
  const conditions = [
    eq(subscriptionTiers.organizationId, orgId),
    eq(subscriptionTiers.isRecommended, true),
    isNull(subscriptionTiers.deletedAt),
  ];

  if (excludeTierId) {
    conditions.push(sql`${subscriptionTiers.id} != ${excludeTierId}`);
  }

  await tx
    .update(subscriptionTiers)
    .set({ isRecommended: false, updatedAt: new Date() })
    .where(and(...conditions));
}

// NOTE: Both `ensureSingleRecommended` clear + the subsequent insert/update
// MUST run inside a single `dbWs.transaction()` to prevent the race condition
// where the old flag is cleared but the new one hasn't been set yet.
// See `reorderTiers()` (line 463) for the established transaction pattern.
```

### 4.2 Update `createTier` (line 63)

Wrap the recommended flag handling + DB insert in a transaction (following the pattern from `reorderTiers` at line 463):

```ts
// If setting as recommended, use a transaction to atomically clear + insert
if (input.isRecommended) {
  await (this.db as typeof import('@codex/database').dbWs).transaction(async (tx) => {
    await this.ensureSingleRecommended(tx, orgId);
    // ... DB insert inside tx ...
  });
} else {
  // ... DB insert without transaction (no recommended flag to coordinate) ...
}
```

Add `isRecommended` to the `.values()` object (line 128–139):

```ts
.values({
  organizationId: orgId,
  name: input.name,
  description: input.description ?? null,
  sortOrder: nextSortOrder,
  priceMonthly: input.priceMonthly,
  priceAnnual: input.priceAnnual,
  stripeProductId: product.id,
  stripePriceMonthlyId: monthlyPrice.id,
  stripePriceAnnualId: annualPrice.id,
  isActive: true,
  isRecommended: input.isRecommended ?? false,  // <-- NEW
})
```

### 4.3 Update `updateTier` (line 200)

Same transaction pattern for updates — wrap recommended flag handling + DB update:

```ts
// If setting as recommended, use a transaction to atomically clear + update
if (input.isRecommended === true) {
  await (this.db as typeof import('@codex/database').dbWs).transaction(async (tx) => {
    await this.ensureSingleRecommended(tx, orgId, tierId);
    // ... DB update inside tx ...
  });
} else {
  // ... DB update without transaction ...
}
```

Add `isRecommended` to the conditional spread in `.set()` (line 295–308):

```ts
.set({
  ...(input.name !== undefined && { name: input.name }),
  ...(input.description !== undefined && {
    description: input.description ?? null,
  }),
  ...(input.priceMonthly !== undefined && {
    priceMonthly: input.priceMonthly,
  }),
  ...(input.priceAnnual !== undefined && {
    priceAnnual: input.priceAnnual,
  }),
  ...(input.isRecommended !== undefined && {       // <-- NEW
    isRecommended: input.isRecommended,
  }),
  stripePriceMonthlyId: newMonthlyPriceId,
  stripePriceAnnualId: newAnnualPriceId,
  updatedAt: new Date(),
})
```

### 4.4 No changes to `listTiers`

The `listTiers` method already selects all columns via `.*` query, so `isRecommended` is included automatically in the response.

---

## 5. API Routes

### No changes required

The existing tier CRUD routes in `workers/organization-api/src/routes/tiers.ts` use `procedure()` which validates input against the Zod schemas. Since we added `isRecommended` to `baseTierSchema`, it flows through automatically:

- `POST /subscriptions/tiers` — `createTierSchema` now includes `isRecommended`
- `PATCH /subscriptions/tiers/:id` — `updateTierSchema` now includes `isRecommended`
- `GET /subscriptions/tiers` — response already includes all columns (public, no auth required)

---

## 6. Frontend Remote Functions

### File: `apps/web/src/lib/remote/subscription.remote.ts`

Add `isRecommended` to the create and update command input schemas.

Find the `createTier` command schema and add:

```ts
isRecommended: z.boolean().optional(),
```

Find the `updateTier` command schema and add:

```ts
isRecommended: z.boolean().optional(),
```

### Frontend Type

`SubscriptionTier` is re-exported from `@codex/database/schema` in `apps/web/src/lib/types.ts`. It uses Drizzle's `$inferSelect` type, so it automatically picks up the new `isRecommended` column. **No manual type changes needed.**

---

## 7. Edge Cases

| Scenario | Behaviour |
|----------|-----------|
| Create tier with `isRecommended: true` when another is already recommended | Old one cleared, new one set |
| Update tier to `isRecommended: false` | Just clears the flag, no other tiers affected |
| Delete (soft) a recommended tier | `isRecommended` stays `true` but tier is hidden (filtered by `deletedAt IS NULL`). Frontend fallback auto-selects middle tier |
| Only 1 tier exists, set as recommended | Works fine — single tier gets highlight |
| No tier is recommended | Frontend fallback: middle tier by `sortOrder` |
| DB update fails after `ensureSingleRecommended` ran | Transaction rollback restores the old recommended flag automatically. No race condition — both operations are atomic. |

---

## 8. Verification

1. Create an org with 3 tiers via Studio monetisation page
2. Mark tier 2 as recommended → verify only tier 2 has `isRecommended: true`
3. Mark tier 3 as recommended → verify tier 2 is cleared, tier 3 is set
4. Update tier 3 with `isRecommended: false` → verify no tier is recommended
5. Verify `GET /subscriptions/tiers` response includes `isRecommended` field
6. Verify pricing page shows "Most Popular" badge on recommended tier
7. Verify pricing page auto-selects middle tier when none is recommended
