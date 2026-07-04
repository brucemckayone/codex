import { z } from 'zod';

/**
 * Creator first-run onboarding step ids, in surface order.
 *
 * These drive the guided "become a creator" wizard (unified from
 * /become-creator) and are stored as the `currentStep` resume pointer on the
 * `creator_onboarding` table. Kept as a Zod enum here — not a Postgres enum —
 * so the step vocabulary can evolve without a DB migration.
 */
export const creatorOnboardingStepSchema = z.enum([
  'essentials',
  'profile',
  'payouts',
  'finish',
]);

export type CreatorOnboardingStep = z.infer<typeof creatorOnboardingStepSchema>;

/** Ordered list of steps — single source of truth for wizard progression. */
export const CREATOR_ONBOARDING_STEPS = creatorOnboardingStepSchema.options;

/**
 * Patch schema for the creator onboarding record.
 *
 * The client sends boolean *intents* (`welcomeSeen` / `dismissed` /
 * `completed`); the service maps a `true` intent to a server-set timestamp
 * (never trusting a client clock). `currentStep` moves the resume pointer.
 * All fields optional — this is a partial patch.
 */
export const updateCreatorOnboardingSchema = z
  .object({
    currentStep: creatorOnboardingStepSchema.optional(),
    welcomeSeen: z.boolean().optional(),
    dismissed: z.boolean().optional(),
    completed: z.boolean().optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'At least one field must be provided',
  });

export type UpdateCreatorOnboardingInput = z.infer<
  typeof updateCreatorOnboardingSchema
>;
