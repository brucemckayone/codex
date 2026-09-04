# WP2: Template Token Registry & Global Seed

**Parent spec**: `docs/email-notifications-design-spec.md`
**Priority**: P0
**Dependencies**: None (foundation work, can be done in parallel with WP1)
**Estimated scope**: 4 files changed/created, ~800 lines of new code (mostly HTML templates)

---

## Goal

Define token schemas for all 18 email templates, register their allowed tokens in the template renderer, create responsive default HTML+text templates, and seed them as global templates in the database.

## Context

The `@codex/notifications` package already has a template rendering pipeline: token registry (`TEMPLATE_TOKENS` in `renderer.ts`), Zod data schemas per template (`templateDataSchemas` in `packages/validation/src/schemas/notifications.ts`), and data validation (`validateTemplateData`). Currently, only 4 templates are registered: `email-verification`, `password-reset`, `password-changed`, and `purchase-receipt`. The design spec calls for 18 total templates across auth, commerce, org, media, content, and engagement domains. This work packet adds the remaining 14 template definitions and seeds all 18 as global templates in the database.

## Changes

### `packages/validation/src/schemas/notifications.ts` (update)

Add Zod data schemas for the 14 new templates below the existing `purchaseReceiptDataSchema`. Each schema defines the exact tokens the template expects.

```typescript
// ============================================
// Commerce Templates
// ============================================

export const subscriptionCreatedDataSchema = z.object({
  userName: z.string(),
  planName: z.string(),
  priceFormatted: z.string(),       // e.g. "£9.99"
  billingInterval: z.string(),      // e.g. "monthly", "yearly"
  nextBillingDate: z.string(),      // e.g. "15 May 2026"
  manageUrl: z.string().url(),
});

export const subscriptionRenewedDataSchema = z.object({
  userName: z.string(),
  planName: z.string(),
  priceFormatted: z.string(),
  billingDate: z.string(),
  nextBillingDate: z.string(),
  manageUrl: z.string().url(),
});

export const paymentFailedDataSchema = z.object({
  userName: z.string(),
  planName: z.string(),
  priceFormatted: z.string(),
  retryDate: z.string(),
  updatePaymentUrl: z.string().url(),
});

export const subscriptionCancelledDataSchema = z.object({
  userName: z.string(),
  planName: z.string(),
  accessEndDate: z.string(),
  resubscribeUrl: z.string().url(),
});

export const refundProcessedDataSchema = z.object({
  userName: z.string(),
  contentTitle: z.string(),
  refundAmount: z.string(),         // e.g. "£9.99"
  originalAmount: z.string(),
  refundDate: z.string(),
});

// ============================================
// Organization Templates
// ============================================

export const orgMemberInvitationDataSchema = z.object({
  inviterName: z.string(),
  orgName: z.string(),
  roleName: z.string(),
  acceptUrl: z.string().url(),
  expiryDays: z.string(),
});

export const memberRoleChangedDataSchema = z.object({
  userName: z.string(),
  orgName: z.string(),
  oldRole: z.string(),
  newRole: z.string(),
});

export const memberRemovedDataSchema = z.object({
  userName: z.string(),
  orgName: z.string(),
});

// ============================================
// Auth / Onboarding Templates
// ============================================

export const welcomeDataSchema = z.object({
  userName: z.string(),
  loginUrl: z.string().url(),
  exploreUrl: z.string().url(),
});

// ============================================
// Media / Transcoding Templates
// ============================================

export const transcodingCompleteDataSchema = z.object({
  userName: z.string(),
  contentTitle: z.string(),
  contentUrl: z.string().url(),
  duration: z.string(),             // e.g. "12:34"
});

export const transcodingFailedDataSchema = z.object({
  userName: z.string(),
  contentTitle: z.string(),
  errorSummary: z.string(),
  retryUrl: z.string().url(),
});

// ============================================
// Creator Templates
// ============================================

export const newSaleDataSchema = z.object({
  creatorName: z.string(),
  contentTitle: z.string(),
  saleAmount: z.string(),           // e.g. "£19.99"
  buyerName: z.string(),
  dashboardUrl: z.string().url(),
});

export const connectAccountStatusDataSchema = z.object({
  creatorName: z.string(),
  accountStatus: z.string(),        // e.g. "verified", "pending", "restricted"
  actionRequired: z.string(),
  dashboardUrl: z.string().url(),
});

// ============================================
// Engagement Templates
// ============================================

export const newContentPublishedDataSchema = z.object({
  userName: z.string(),
  contentTitle: z.string(),
  creatorName: z.string(),
  contentUrl: z.string().url(),
  contentDescription: z.string(),
});

export const weeklyDigestDataSchema = z.object({
  userName: z.string(),
  newContentCount: z.string(),      // stringified number for template rendering
  topContent: z.string(),           // formatted list of top content titles
  platformUrl: z.string().url(),
});
```

Update the `templateDataSchemas` map to include all 18 templates:

```typescript
export const templateDataSchemas = {
  // Auth
  'email-verification': emailVerificationDataSchema,
  'password-reset': passwordResetDataSchema,
  'password-changed': passwordChangedDataSchema,
  'welcome': welcomeDataSchema,
  // Commerce
  'purchase-receipt': purchaseReceiptDataSchema,
  'subscription-created': subscriptionCreatedDataSchema,
  'subscription-renewed': subscriptionRenewedDataSchema,
  'payment-failed': paymentFailedDataSchema,
  'subscription-cancelled': subscriptionCancelledDataSchema,
  'refund-processed': refundProcessedDataSchema,
  // Organization
  'org-member-invitation': orgMemberInvitationDataSchema,
  'member-role-changed': memberRoleChangedDataSchema,
  'member-removed': memberRemovedDataSchema,
  // Media
  'transcoding-complete': transcodingCompleteDataSchema,
  'transcoding-failed': transcodingFailedDataSchema,
  // Creator
  'new-sale': newSaleDataSchema,
  'connect-account-status': connectAccountStatusDataSchema,
  // Engagement
  'new-content-published': newContentPublishedDataSchema,
  'weekly-digest': weeklyDigestDataSchema,
} as const;
```

### `packages/notifications/src/templates/renderer.ts` (update)

Expand `TEMPLATE_TOKENS` to include all 18 templates plus the `_unsubscribe` meta-tokens. The token names must match the Zod schema field names exactly.

```typescript
export const TEMPLATE_TOKENS: Record<string, string[]> = {
  // Brand tokens (available to all templates)
  _brand: [
    'platformName',
    'logoUrl',
    'primaryColor',
    'secondaryColor',
    'supportEmail',
    'contactUrl',
  ],

  // Unsubscribe tokens (available to non-transactional templates)
  _unsubscribe: [
    'unsubscribeUrl',
    'preferencesUrl',
  ],

  // Auth
  'email-verification': ['userName', 'verificationUrl', 'expiryHours'],
  'password-reset': ['userName', 'resetUrl', 'expiryHours'],
  'password-changed': ['userName', 'supportUrl'],
  'welcome': ['userName', 'loginUrl', 'exploreUrl'],

  // Commerce
  'purchase-receipt': ['userName', 'contentTitle', 'priceFormatted', 'purchaseDate', 'contentUrl'],
  'subscription-created': ['userName', 'planName', 'priceFormatted', 'billingInterval', 'nextBillingDate', 'manageUrl'],
  'subscription-renewed': ['userName', 'planName', 'priceFormatted', 'billingDate', 'nextBillingDate', 'manageUrl'],
  'payment-failed': ['userName', 'planName', 'priceFormatted', 'retryDate', 'updatePaymentUrl'],
  'subscription-cancelled': ['userName', 'planName', 'accessEndDate', 'resubscribeUrl'],
  'refund-processed': ['userName', 'contentTitle', 'refundAmount', 'originalAmount', 'refundDate'],

  // Organization
  'org-member-invitation': ['inviterName', 'orgName', 'roleName', 'acceptUrl', 'expiryDays'],
  'member-role-changed': ['userName', 'orgName', 'oldRole', 'newRole'],
  'member-removed': ['userName', 'orgName'],

  // Media
  'transcoding-complete': ['userName', 'contentTitle', 'contentUrl', 'duration'],
  'transcoding-failed': ['userName', 'contentTitle', 'errorSummary', 'retryUrl'],

  // Creator
  'new-sale': ['creatorName', 'contentTitle', 'saleAmount', 'buyerName', 'dashboardUrl'],
  'connect-account-status': ['creatorName', 'accountStatus', 'actionRequired', 'dashboardUrl'],

  // Engagement
  'new-content-published': ['userName', 'contentTitle', 'creatorName', 'contentUrl', 'contentDescription'],
  'weekly-digest': ['userName', 'newContentCount', 'topContent', 'platformUrl'],
};
```

Update `getAllowedTokens()` to merge `_unsubscribe` tokens for non-transactional templates:

```typescript
// Transactional templates (no unsubscribe link)
const TRANSACTIONAL_TEMPLATES = new Set([
  'email-verification',
  'password-reset',
  'password-changed',
  'purchase-receipt',
  'subscription-created',
  'subscription-renewed',
  'subscription-cancelled',
  'refund-processed',
]);

export function getAllowedTokens(templateName: string): string[] {
  const brandTokens = TEMPLATE_TOKENS._brand || [];
  const templateTokens = TEMPLATE_TOKENS[templateName] || [];
  const unsubscribeTokens = TRANSACTIONAL_TEMPLATES.has(templateName)
    ? []
    : (TEMPLATE_TOKENS._unsubscribe || []);
  return [...brandTokens, ...unsubscribeTokens, ...templateTokens];
}
```

### `packages/database/scripts/seed/templates.ts` (new)

Create the seed function that inserts all 18 global templates. This is the largest file in this work packet -- each template needs a subject, HTML body, and text body.

**HTML template structure**: All HTML templates should follow a consistent responsive layout:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;">
        <!-- Logo header (if logoUrl provided) -->
        <tr><td style="padding:24px 32px 0;text-align:center;">
          {{logoUrl}}
        </td></tr>
        <!-- Content -->
        <tr><td style="padding:32px;">
          <h1 style="margin:0 0 16px;font-size:22px;color:#18181b;">Subject line here</h1>
          <p style="margin:0 0 24px;color:#3f3f46;font-size:15px;line-height:1.6;">
            Hi {{userName}}, ...
          </p>
          <!-- CTA button -->
          <table cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
            <tr><td style="border-radius:6px;background:{{primaryColor}};">
              <a href="{{actionUrl}}" style="display:inline-block;padding:12px 32px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:500;">
                Button text
              </a>
            </td></tr>
          </table>
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:16px 32px;border-top:1px solid #e4e4e7;text-align:center;">
          <p style="margin:0;color:#a1a1aa;font-size:12px;">
            {{platformName}} &mdash; <a href="mailto:{{supportEmail}}" style="color:#a1a1aa;">{{supportEmail}}</a>
          </p>
          <!-- Non-transactional: unsubscribe link -->
          <p style="margin:8px 0 0;color:#a1a1aa;font-size:11px;">
            <a href="{{unsubscribeUrl}}" style="color:#a1a1aa;">Unsubscribe</a> &middot;
            <a href="{{preferencesUrl}}" style="color:#a1a1aa;">Email preferences</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
```

**Design rules for the HTML templates**:
- 600px max-width single-column table layout (Outlook-safe)
- System font stack (no web font loading)
- All styles inline (no `<style>` blocks -- many email clients strip them)
- Brand tokens: `{{primaryColor}}` for CTA button backgrounds, `{{logoUrl}}` in header, `{{platformName}}` in footer
- Unsubscribe footer on non-transactional templates only (marketing, digest, engagement)
- Currency always GBP with pound sign (e.g. `{{priceFormatted}}` expects values like `£19.99`)
- Fallback plain text URLs below CTA buttons (for email clients that strip links)

**Seed function skeleton**:

```typescript
import type { dbWs as DbClient } from '../../src';
import { schema } from '../../src';

const GLOBAL_TEMPLATES = [
  {
    name: 'email-verification',
    description: 'Sent when a user registers to verify their email address',
    subject: 'Verify your email - {{platformName}}',
    htmlBody: `...`, // Full responsive HTML
    textBody: `Hi {{userName}},\n\nThanks for signing up...`,
  },
  {
    name: 'password-reset',
    description: 'Sent when a user requests a password reset',
    subject: 'Reset your password - {{platformName}}',
    htmlBody: `...`,
    textBody: `...`,
  },
  // ... all 18 templates
];

export async function seedTemplates(db: typeof DbClient) {
  for (const template of GLOBAL_TEMPLATES) {
    await db
      .insert(schema.emailTemplates)
      .values({
        name: template.name,
        scope: 'global',
        status: 'active',
        subject: template.subject,
        htmlBody: template.htmlBody,
        textBody: template.textBody,
        description: template.description,
      })
      .onConflictDoNothing(); // Idempotent: skip if already seeded
  }
}
```

**Complete template list** (all 18):

| # | Name | Category | Subject line |
|---|---|---|---|
| 1 | `email-verification` | transactional | Verify your email - {{platformName}} |
| 2 | `password-reset` | transactional | Reset your password - {{platformName}} |
| 3 | `password-changed` | transactional | Your password was changed - {{platformName}} |
| 4 | `welcome` | transactional | Welcome to {{platformName}} |
| 5 | `purchase-receipt` | transactional | Your receipt from {{platformName}} |
| 6 | `subscription-created` | transactional | Subscription confirmed - {{planName}} |
| 7 | `subscription-renewed` | transactional | Subscription renewed - {{planName}} |
| 8 | `payment-failed` | transactional | Payment failed - action required |
| 9 | `subscription-cancelled` | transactional | Subscription cancelled - {{planName}} |
| 10 | `refund-processed` | transactional | Refund processed - {{platformName}} |
| 11 | `org-member-invitation` | transactional | You've been invited to {{orgName}} |
| 12 | `member-role-changed` | transactional | Your role in {{orgName}} has changed |
| 13 | `member-removed` | transactional | You've been removed from {{orgName}} |
| 14 | `transcoding-complete` | transactional | Your video is ready - {{contentTitle}} |
| 15 | `transcoding-failed` | transactional | Transcoding failed - {{contentTitle}} |
| 16 | `new-sale` | marketing | New sale: {{contentTitle}} |
| 17 | `connect-account-status` | transactional | Stripe account update - {{accountStatus}} |
| 18 | `new-content-published` | marketing | New release: {{contentTitle}} by {{creatorName}} |
| 19 | `weekly-digest` | digest | Your weekly roundup from {{platformName}} |

**Note on conflict strategy**: Use `.onConflictDoNothing()` keyed on the `(name, scope, organizationId, creatorId)` unique constraint (or the equivalent unique index on the `emailTemplates` table). Check the actual schema for the correct unique constraint before implementing. If the table uses a single unique index on `name` + `scope`, that suffices for global templates since `organizationId` and `creatorId` are null for global scope.

### `packages/database/scripts/seed/index.ts` (update)

Import and call the template seed function. Add it after the existing seed steps:

```typescript
import { seedTemplates } from './templates';

// In the main seed function, after existing seeds:
await seedTemplates(db);
```

**Ordering**: Templates have no foreign key dependencies on other seeded data (they reference no users, orgs, or content), so they can run at any position in the seed sequence. Place them after `seedUsers` and `seedOrganizations` for logical grouping.

## Verification

### Unit Tests

File: `packages/validation/src/schemas/__tests__/notifications-templates.test.ts`

For each of the 18 Zod schemas:
- **Valid data passes**: Provide all required fields with correct types, verify `.parse()` succeeds.
- **Missing required field rejects**: Omit one required field, verify `.parse()` throws `ZodError`.
- **Invalid URL rejects**: For schemas with `.url()` fields, provide a non-URL string, verify rejection.
- **Extra fields stripped**: Provide extra fields not in schema, verify they are stripped (Zod's default `strip` behavior).

File: `packages/notifications/src/templates/__tests__/renderer-tokens.test.ts`

- **`getAllowedTokens()` returns correct tokens for each template**: For each of the 18 template names, call `getAllowedTokens(name)` and verify it includes brand tokens + template-specific tokens.
- **Non-transactional templates include unsubscribe tokens**: Verify `getAllowedTokens('new-sale')` includes `unsubscribeUrl` and `preferencesUrl`.
- **Transactional templates exclude unsubscribe tokens**: Verify `getAllowedTokens('email-verification')` does NOT include `unsubscribeUrl`.

### Integration Tests

File: `packages/database/scripts/seed/__tests__/templates-seed.test.ts`

- **Seed creates 18 templates**: Run `seedTemplates(db)` on empty database, query `emailTemplates` where `scope = 'global'`, verify count is 18.
- **Seed is idempotent**: Run `seedTemplates(db)` twice, verify count is still 18 (no duplicates).
- **All templates are active**: Verify all 18 seeded templates have `status = 'active'`.
- **All templates have non-empty bodies**: Verify no template has empty `htmlBody` or `textBody`.

### Manual Verification

1. Reset and reseed the database:
   ```bash
   pnpm db:seed
   ```
2. Connect to the database and verify:
   ```sql
   SELECT name, scope, status, length(html_body) as html_len, length(text_body) as text_len
   FROM email_templates
   WHERE scope = 'global'
   ORDER BY name;
   ```
   Expect 18 rows, all with `scope = 'global'`, `status = 'active'`, and non-zero body lengths.
3. Run seed again, verify no errors and count is still 18.
4. Use the template preview endpoint to render a few templates:
   ```bash
   # Start services
   pnpm dev

   # Preview email-verification template (requires auth)
   curl -X POST http://localhost:42075/api/templates/{id}/preview \
     -H "Content-Type: application/json" \
     -H "Cookie: codex-session=<valid-session>" \
     -d '{"data": {"userName": "Alice", "verificationUrl": "https://example.com/verify", "expiryHours": "24"}}'
   ```
   Verify the HTML response uses the responsive layout with brand tokens rendered.

## Review Checklist

- [ ] All 18 templates have matching Zod validation schemas in `@codex/validation`
- [ ] All 18 templates have matching token registrations in `TEMPLATE_TOKENS`
- [ ] Token names in Zod schemas match token names in `TEMPLATE_TOKENS` exactly
- [ ] `templateDataSchemas` map has all 18 entries
- [ ] `TRANSACTIONAL_TEMPLATES` set correctly classifies transactional vs non-transactional
- [ ] Non-transactional templates include unsubscribe footer in HTML
- [ ] Transactional templates do NOT include unsubscribe footer
- [ ] HTML templates use inline styles only (no `<style>` blocks)
- [ ] HTML templates are responsive (600px max-width, mobile-friendly)
- [ ] All currency references use GBP (pound symbol)
- [ ] Seed uses `.onConflictDoNothing()` for idempotency
- [ ] Seed sets `scope: 'global'` and `status: 'active'` on all templates
- [ ] No `as any` casts
- [ ] All new schemas and types are exported from package barrel files

## Acceptance Criteria

- [ ] All 18 templates have Zod validation schemas that correctly validate and reject invalid data
- [ ] All 18 templates have token registrations in `TEMPLATE_TOKENS` with matching field names
- [ ] `getAllowedTokens()` returns brand + template-specific + unsubscribe tokens (non-transactional) or brand + template-specific (transactional)
- [ ] Seed script creates 18 global templates in the database idempotently
- [ ] Running seed twice does not create duplicates
- [ ] HTML templates are responsive single-column table layouts (600px max-width)
- [ ] HTML templates use system font stack and inline styles
- [ ] HTML templates use brand tokens (`{{primaryColor}}`, `{{logoUrl}}`, `{{platformName}}`)
- [ ] Non-transactional HTML templates include unsubscribe footer with `{{unsubscribeUrl}}` and `{{preferencesUrl}}`
- [ ] All currency references use GBP (pound sign)
- [ ] Text templates provide equivalent content without HTML
- [ ] `templateDataSchemas` map is complete and used by `validateTemplateData()`
