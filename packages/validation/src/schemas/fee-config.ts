/**
 * Fee Configuration Validation Schemas (Codex-m644n)
 *
 * Internal admin-api consumes these — no public web routes exist for fee
 * mutation. Used by `/api/admin/fees/*` endpoints gated by platform_owner.
 */

import { z } from 'zod';

/** Basis points integer in [0, 10000]. 10000 = 100%. */
const bpsSchema = z.number().int().min(0).max(10000);

/** Non-negative cents integer. */
const centsSchema = z.number().int().min(0);

/** Identifier for an organization (UUID). */
const orgIdSchema = z.string().uuid();

/** Identifier for a user (BetterAuth text id, not UUID). */
const userIdSchema = z.string().min(1).max(255);

// ─── Platform-level ─────────────────────────────────────────────────────────

export const updatePlatformFeesSchema = z
  .object({
    platformFeePercent: bpsSchema.optional(),
    subscriptionOrgFeePercent: bpsSchema.optional(),
    oneOffOrgFeePercent: bpsSchema.optional(),
    minPlatformFeeCents: centsSchema.optional(),
    minTransferCents: centsSchema.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'At least one fee field must be provided',
  });
export type UpdatePlatformFeesInput = z.infer<typeof updatePlatformFeesSchema>;

// ─── Per-org ────────────────────────────────────────────────────────────────

export const orgIdParamsSchema = z.object({
  orgId: orgIdSchema,
});
export type OrgIdParams = z.infer<typeof orgIdParamsSchema>;

export const updateOrgFeesSchema = z
  .object({
    platformFeePercent: bpsSchema.nullable().optional(),
    orgFeePercent: bpsSchema.nullable().optional(),
    minPlatformFeeCents: centsSchema.nullable().optional(),
    minTransferCents: centsSchema.nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'At least one fee field must be provided',
  });
export type UpdateOrgFeesInput = z.infer<typeof updateOrgFeesSchema>;

// ─── Per-creator override ───────────────────────────────────────────────────

export const orgCreatorParamsSchema = z.object({
  orgId: orgIdSchema,
  creatorId: userIdSchema,
});
export type OrgCreatorParams = z.infer<typeof orgCreatorParamsSchema>;

export const upsertCreatorOverrideSchema = z
  .object({
    platformFeePercent: bpsSchema.nullable().optional(),
    orgFeePercent: bpsSchema.nullable().optional(),
    minPlatformFeeCents: centsSchema.nullable().optional(),
    minTransferCents: centsSchema.nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'At least one field must be provided',
  });
export type UpsertCreatorOverrideInput = z.infer<
  typeof upsertCreatorOverrideSchema
>;

// ─── Audit log query ────────────────────────────────────────────────────────

export const feeAuditLogQuerySchema = z.object({
  scope: z.enum(['platform', 'org', 'override']).optional(),
  orgId: orgIdSchema.optional(),
  creatorId: userIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type FeeAuditLogQuery = z.infer<typeof feeAuditLogQuerySchema>;
