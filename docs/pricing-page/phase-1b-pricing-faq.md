# Phase 1B: `pricingFaq` JSONB on Branding Settings

**Version**: 1.1 (post-review)
**Date**: 2026-04-15
**Status**: Implementation-ready
**Depends on**: Nothing (independent)
**Blocks**: Phase 2 (Pricing Page Frontend), Phase 3B (Studio FAQ Editor)

---

## 1. Overview

Add a `pricingFaq` text column (JSON string) to the `branding_settings` table. This allows org owners to configure FAQ items for their pricing page via the Studio settings. The pricing page renders these as an Accordion, with hardcoded sensible defaults as fallback.

### Storage Pattern

Follows the exact same pattern as `tokenOverrides` and `darkModeOverrides` — a `text` column storing a JSON string, parsed at the application layer. This is the established convention in `branding_settings`.

---

## 2. Type Definition

### New type (add to `packages/validation/src/schemas/settings.ts`)

```ts
/**
 * A single FAQ item on the pricing page.
 * Stored as JSON array in branding_settings.pricing_faq.
 */
export interface PricingFaqItem {
  /** UUID for stable identity during edits */
  id: string;
  /** The question text (max 200 chars) */
  question: string;
  /** The answer text, plain text (max 2000 chars) */
  answer: string;
  /** Sort order (0-based index) */
  order: number;
}
```

---

## 3. Database Schema

### File: `packages/database/src/schema/settings.ts`

Add `pricingFaq` after the `heroLayout` field (line 90):

```ts
// Hero layout variant (brand editor "Header Layout" section)
heroLayout: varchar('hero_layout', { length: 20 }).default('default'),

// Pricing FAQ (JSON string: PricingFaqItem[])
pricingFaq: text('pricing_faq'),
```

### Migration

```bash
cd packages/database && pnpm db:generate
# Review generated migration (should be 0053_*.sql)
pnpm db:migrate
```

Expected SQL:

```sql
ALTER TABLE "branding_settings" ADD COLUMN "pricing_faq" text;
```

---

## 4. Validation Schemas

### File: `packages/validation/src/schemas/settings.ts`

Add FAQ validation schemas **before** `updateBrandingSchema` (around line 64):

```ts
// ============================================================================
// Pricing FAQ Schemas
// ============================================================================

/**
 * Single pricing FAQ item
 */
export const pricingFaqItemSchema = z.object({
  id: z.string().uuid('FAQ item must have a valid UUID'),
  question: z
    .string()
    .trim()
    .min(1, 'Question is required')
    .max(200, 'Question must be 200 characters or less'),
  answer: z
    .string()
    .trim()
    .min(1, 'Answer is required')
    .max(2000, 'Answer must be 2000 characters or less')
    .refine(
      (str) => !/<[^>]*>/g.test(str),
      'Answer cannot contain HTML tags'
    ),
  order: z.number().int().min(0, 'Order must be non-negative'),
});

/**
 * Array of FAQ items (max 20 per org, unique order values)
 */
export const pricingFaqSchema = z
  .array(pricingFaqItemSchema)
  .max(20, 'Maximum 20 FAQ items allowed')
  .refine(
    (items) => {
      const orders = items.map((i) => i.order);
      return new Set(orders).size === orders.length;
    },
    'Each FAQ item must have a unique order value'
  );

export type PricingFaqItem = z.infer<typeof pricingFaqItemSchema>;
```

Add `pricingFaq` to `updateBrandingSchema` (line 70):

```ts
export const updateBrandingSchema = z.object({
  // ... existing fields ...
  heroLayout: z.enum(['default', 'centered', 'logo-hero', 'minimal']).optional(),
  pricingFaq: z.union([
    z.literal(null),    // Explicitly clear
    z.string().min(1),  // Non-empty JSON string
  ]).optional(),
});
```

Add to `DEFAULT_BRANDING`:

```ts
export const DEFAULT_BRANDING: BrandingSettingsResponse = {
  // ... existing defaults ...
  heroLayout: 'default',
  pricingFaq: null,  // <-- NEW
};
```

Add to `brandingSettingsSchema`:

```ts
export const brandingSettingsSchema = z.object({
  // ... existing fields ...
  heroLayout: z.string(),
  pricingFaq: z.string().nullable(),  // <-- NEW
});
```

---

## 5. Shared Types

### File: `packages/shared-types/src/api-responses.ts`

Add `pricingFaq` to `BrandingSettingsResponse` (line 188):

```ts
export interface BrandingSettingsResponse {
  // ... existing fields ...
  heroLayout: string;
  // Pricing FAQ
  pricingFaq: string | null;  // <-- NEW (JSON string: PricingFaqItem[])
}
```

Also add to `PublicBrandingResponse` if it exists as a separate type — FAQ data must be accessible on the public pricing page without auth.

---

## 6. Branding Settings Service

### File: `packages/platform-settings/src/services/branding-settings-service.ts`

### 6.1 Update `get()` select (line 66–87)

Add to the select object:

```ts
pricingFaq: schema.brandingSettings.pricingFaq,
```

### 6.2 Update `mapRow()` type signature and return (line 104–148)

Add to the parameter type:

```ts
private mapRow(row: {
  // ... existing fields ...
  heroLayout: string | null;
  pricingFaq: string | null;  // <-- NEW
}): BrandingSettingsResponse {
  return {
    // ... existing fields ...
    heroLayout: row.heroLayout ?? 'default',
    pricingFaq: row.pricingFaq,  // <-- NEW
  };
}
```

### 6.3 Update `update()` fieldMap (line 160–178)

Add to the `fieldMap` object:

```ts
const fieldMap: Record<string, keyof UpdateBrandingInput> = {
  // ... existing fields ...
  heroLayout: 'heroLayout',
  pricingFaq: 'pricingFaq',  // <-- NEW
};
```

No other changes needed — the existing upsert pattern handles the new field automatically via the `fieldMap` loop.

---

## 7. Public Access Path

The pricing page needs FAQ data without requiring authentication (visitors should see the FAQ). The data flows through the existing org layout branding cascade:

```
+layout.server.ts (org) 
  → api.org.getPublicInfo(slug) 
  → includes branding settings 
  → data.org.brandFineTune or data.org.branding
  → pricing +page.svelte accesses via data from parent()
```

### How the pricing page accesses FAQ

In `+page.server.ts`:

```ts
const { org } = await parent();
// org.branding.pricingFaq is available as JSON string
```

In `+page.svelte`:

```ts
const faqItems = $derived.by(() => {
  try {
    const raw = data.org?.branding?.pricingFaq;
    if (!raw) return DEFAULT_FAQ;
    const parsed = JSON.parse(raw) as PricingFaqItem[];
    return parsed.length > 0
      ? parsed.sort((a, b) => a.order - b.order)
      : DEFAULT_FAQ;
  } catch {
    return DEFAULT_FAQ;
  }
});
```

### Verify the public info endpoint

Check that the org public info endpoint (`GET /api/organizations/public/:slug/info`) returns branding settings that include the new `pricingFaq` field. If the endpoint uses `BrandingSettingsService.get()`, it will include it automatically.

---

## 8. Default FAQ Content

When no FAQ is configured by the creator, the pricing page shows these sensible defaults:

```ts
const DEFAULT_FAQ: PricingFaqItem[] = [
  {
    id: 'default-cancel',
    question: 'Can I cancel my subscription at any time?',
    answer:
      'Yes, you can cancel your subscription at any time from your account settings. ' +
      'Your access will continue until the end of your current billing period.',
    order: 0,
  },
  {
    id: 'default-payment',
    question: 'What payment methods do you accept?',
    answer:
      'We accept all major credit and debit cards including Visa, Mastercard, and American Express. ' +
      'All payments are processed securely through Stripe.',
    order: 1,
  },
  {
    id: 'default-access',
    question: 'Do I get instant access after subscribing?',
    answer:
      'Yes, you get immediate access to all content included in your subscription tier ' +
      'as soon as your payment is confirmed.',
    order: 2,
  },
  {
    id: 'default-change-plan',
    question: 'Can I change my plan later?',
    answer:
      'Absolutely. You can upgrade or downgrade your subscription tier at any time. ' +
      'Changes take effect at the start of your next billing period.',
    order: 3,
  },
];
```

---

## 9. JSON Validation on Save

When the Studio FAQ editor saves, the FAQ array is:
1. Validated client-side with `pricingFaqSchema` (Zod array of items)
2. Serialised to JSON string: `JSON.stringify(items)`
3. Sent as `pricingFaq: jsonString` in the branding update payload
4. Server validates via `updateBrandingSchema` (non-empty string or null)

**Server-side JSON validation** (defense-in-depth): Unlike `tokenOverrides` which is only written by the brand editor's controlled UI, FAQ data comes from a simpler Studio editor. Add a parse check in `BrandingSettingsService.update()`:

```ts
// In update(), after building updateValues:
if (input.pricingFaq !== undefined && input.pricingFaq !== null) {
  try {
    const parsed = JSON.parse(input.pricingFaq);
    pricingFaqSchema.parse(parsed); // Validate structure
  } catch (e) {
    throw new SettingsUpsertError('pricingFaq must be valid JSON matching the FAQ schema');
  }
}
```

This prevents malformed JSON from network errors, encoding corruption, or bypassed client validation.

---

## 10. Cache Invalidation

The existing branding update flow already handles cache invalidation:

1. `BrandingSettingsService.update()` writes to DB
2. Organization-api route calls `invalidateBrandAndCache()` in `waitUntil()`
3. KV cache key `brand:{slug}` is refreshed
4. Org version key is bumped → client staleness check triggers re-fetch

**No additional cache work needed.**

---

## 11. Verification

1. Add `pricingFaq` column via migration → verify column exists in DB
2. Call `PUT /api/organizations/:id/settings/branding` with `pricingFaq: JSON.stringify([...items])` → verify stored
3. Call `GET /api/organizations/public/:slug/info` → verify `pricingFaq` returned in branding
4. Set `pricingFaq: null` → verify clears the FAQ
5. Set `pricingFaq: "invalid json"` → verify it's stored as-is (validation is client-side)
6. Verify pricing page renders FAQ items from branding data
7. Verify pricing page shows defaults when `pricingFaq` is null
8. Verify pricing page shows defaults when `pricingFaq` is empty array `"[]"`
