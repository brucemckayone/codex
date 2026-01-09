import { z } from 'zod';
import { createSanitizedStringSchema, uuidSchema } from '../primitives';

// ============================================
// Enums (must match database CHECK constraints)
// ============================================

export const templateScopeEnum = z.enum(['global', 'organization', 'creator']);
export type TemplateScope = z.infer<typeof templateScopeEnum>;

export const templateStatusEnum = z.enum(['draft', 'active', 'archived']);
export type TemplateStatus = z.infer<typeof templateStatusEnum>;

// ============================================
// Template Name Validation
// ============================================

// Template names are kebab-case identifiers (e.g., 'email-verification')
export const templateNameSchema = z
  .string()
  .min(3, 'Template name must be at least 3 characters')
  .max(100, 'Template name must be at most 100 characters')
  .regex(
    /^[a-z][a-z0-9-]*[a-z0-9]$/,
    'Template name must be kebab-case (lowercase letters, numbers, hyphens)'
  );

// ============================================
// Template Content Validation
// ============================================

export const templateSubjectSchema = z
  .string()
  .min(1, 'Subject is required')
  .max(500, 'Subject must be at most 500 characters');

export const templateBodySchema = z
  .string()
  .min(10, 'Body must be at least 10 characters')
  .max(100000, 'Body must be at most 100,000 characters');

// ============================================
// Create Template Schemas (per scope)
// ============================================

// Base fields for all templates
const templateContentFields = {
  name: templateNameSchema,
  subject: templateSubjectSchema,
  htmlBody: templateBodySchema,
  textBody: templateBodySchema,
  description: createSanitizedStringSchema(0, 1000, 'Description').optional(),
  status: templateStatusEnum.default('draft'),
};

// Global template (platform owner only)
export const createGlobalTemplateSchema = z.object({
  ...templateContentFields,
});
export type CreateGlobalTemplateInput = z.infer<
  typeof createGlobalTemplateSchema
>;

// Organization template
export const createOrgTemplateSchema = z.object({
  ...templateContentFields,
});
export type CreateOrgTemplateInput = z.infer<typeof createOrgTemplateSchema>;

// Creator template
export const createCreatorTemplateSchema = z.object({
  ...templateContentFields,
  organizationId: uuidSchema.optional(), // Optional org association for visibility
});
export type CreateCreatorTemplateInput = z.infer<
  typeof createCreatorTemplateSchema
>;

// ============================================
// Update Template Schema
// ============================================

export const updateTemplateSchema = z.object({
  subject: templateSubjectSchema.optional(),
  htmlBody: templateBodySchema.optional(),
  textBody: templateBodySchema.optional(),
  description: createSanitizedStringSchema(0, 1000, 'Description')
    .optional()
    .nullable(),
  status: templateStatusEnum.optional(),
});
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;

// ============================================
// Query Schemas
// ============================================

export const listTemplatesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: templateStatusEnum.optional(),
  scope: templateScopeEnum.optional(),
});
export type ListTemplatesQuery = z.infer<typeof listTemplatesQuerySchema>;

// ============================================
// Preview/Test Send Schemas
// ============================================

export const previewTemplateSchema = z.object({
  // Test data to render template with
  // Limited to 50 keys to prevent DoS via large data objects
  data: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .refine(
      (obj) => Object.keys(obj).length <= 50,
      'Maximum 50 data keys allowed'
    )
    .default({}),
});
export type PreviewTemplateInput = z.infer<typeof previewTemplateSchema>;

export const testSendTemplateSchema = z.object({
  // Email address to send test to
  recipientEmail: z.string().email('Invalid email address'),
  // Optional test data (limited to 50 keys)
  data: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .refine(
      (obj) => Object.keys(obj).length <= 50,
      'Maximum 50 data keys allowed'
    )
    .default({}),
});
export type TestSendTemplateInput = z.infer<typeof testSendTemplateSchema>;

// ============================================
// Send Email Schema (for service layer)
// ============================================

export const sendEmailSchema = z.object({
  templateName: templateNameSchema,
  recipientEmail: z.string().email(),
  recipientName: z.string().optional(),
  data: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  organizationId: uuidSchema.optional(),
  creatorId: z.string().optional(),
});
export type SendEmailInput = z.infer<typeof sendEmailSchema>;

// ============================================
// Template Data Contracts (per template type)
// ============================================

export const emailVerificationDataSchema = z.object({
  userName: z.string(),
  verificationUrl: z.string().url(),
  expiryHours: z.string(),
});

export const passwordResetDataSchema = z.object({
  userName: z.string(),
  resetUrl: z.string().url(),
  expiryHours: z.string(),
});

export const passwordChangedDataSchema = z.object({
  userName: z.string(),
  supportUrl: z.string().url().optional(),
});

export const purchaseReceiptDataSchema = z.object({
  userName: z.string(),
  contentTitle: z.string(),
  priceFormatted: z.string(), // e.g., "9.99"
  purchaseDate: z.string(),
  contentUrl: z.string().url(),
});

// Map template names to their data schemas
export const templateDataSchemas = {
  'email-verification': emailVerificationDataSchema,
  'password-reset': passwordResetDataSchema,
  'password-changed': passwordChangedDataSchema,
  'purchase-receipt': purchaseReceiptDataSchema,
} as const;

// Type for template data keys (enables compile-time checking)
export type TemplateDataKey = keyof typeof templateDataSchemas;
