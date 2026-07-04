/**
 * Creator first-run onboarding flow — pure step resolution.
 *
 * The guided /become-creator wizard is a linear stepper whose active step is
 * encoded in a `?step=` URL param and mirrored by the server `currentStep`
 * pointer. This module resolves "which step should the user see" from the
 * available signals, and provides the ordered-list navigation helpers the
 * wizard shell and guards need.
 *
 * Pure (mirrors onboarding-checklist.ts): no `$state`/`$derived`, no browser
 * globals — it takes resolved signals as plain inputs so it unit-tests without
 * a Svelte render.
 */

import {
  CREATOR_ONBOARDING_STEPS,
  type CreatorOnboardingStep,
  creatorOnboardingStepSchema,
} from '@codex/validation';

export { CREATOR_ONBOARDING_STEPS, type CreatorOnboardingStep };

/** Signals the wizard/guards resolve the effective step from. */
export interface OnboardingSignals {
  /** The user's global role — `customer` means pre-upgrade. */
  role: string;
  /** Username is set (become-creator complete). */
  hasUsername: boolean;
  /** An avatar has been uploaded. */
  hasAvatar: boolean;
  /** Payouts fully enabled on the per-user Stripe Connect account. */
  payoutsEnabled: boolean;
  /** Server-stored resume pointer (may be any string; validated here). */
  currentStep: string;
}

/**
 * Onboarding is "active" (should route the creator into the wizard) only while
 * it has neither been completed nor explicitly dismissed. Reading timestamps
 * as `string | null` matches the JSON-over-wire shape.
 */
export function isOnboardingActive(state: {
  dismissedAt: string | null;
  completedAt: string | null;
}): boolean {
  return !state.dismissedAt && !state.completedAt;
}

/**
 * Steps that only the guided wizard's own progression can set (the essentials
 * form bumps the pointer to `profile`). Used by the studio safety-net guard to
 * distinguish a creator who started-then-abandoned the new flow from a legacy
 * creator whose record was just upserted with the `essentials` default.
 */
const MID_FLOW_STEPS = new Set<CreatorOnboardingStep>(['profile', 'payouts']);

/**
 * Should a creator landing on the studio be bounced back into the wizard to
 * finish setup? True only while onboarding is active AND they provably advanced
 * past essentials — so a legacy creator (fresh `essentials` upsert) is never
 * trapped, and finished/dismissed creators are left alone.
 */
export function shouldResumeInWizard(record: {
  currentStep: string;
  dismissedAt: string | null;
  completedAt: string | null;
}): boolean {
  return (
    isOnboardingActive(record) &&
    MID_FLOW_STEPS.has(record.currentStep as CreatorOnboardingStep)
  );
}

/** Data-derived fallback when no valid pointer/param is available. */
function deriveStepFromData(signals: OnboardingSignals): CreatorOnboardingStep {
  if (signals.role === 'customer' || !signals.hasUsername) return 'essentials';
  if (!signals.hasAvatar) return 'profile';
  if (!signals.payoutsEnabled) return 'payouts';
  return 'finish';
}

/**
 * Resolve the effective step to display.
 *
 * Precedence:
 *  1. Pre-upgrade (`customer` / no username) is always pinned to `essentials`
 *     — the role guard on the studio would otherwise bounce them, and no later
 *     step is meaningful without a creator identity.
 *  2. A valid `?step=` request (in-flow back/next, resume link, Stripe return).
 *  3. The stored `currentStep` pointer.
 *  4. Data-derived fallback.
 */
export function resolveOnboardingStep(
  signals: OnboardingSignals,
  requestedStep?: string | null
): CreatorOnboardingStep {
  if (signals.role === 'customer' || !signals.hasUsername) return 'essentials';

  const requested = creatorOnboardingStepSchema.safeParse(requestedStep);
  if (requested.success) return requested.data;

  const stored = creatorOnboardingStepSchema.safeParse(signals.currentStep);
  if (stored.success) return stored.data;

  return deriveStepFromData(signals);
}

/** Zero-based index of a step in surface order (-1 if unknown). */
export function stepIndex(step: CreatorOnboardingStep): number {
  return CREATOR_ONBOARDING_STEPS.indexOf(step);
}

/** The next step in surface order, or null at the end. */
export function nextStep(
  step: CreatorOnboardingStep
): CreatorOnboardingStep | null {
  const i = stepIndex(step);
  return i >= 0 && i < CREATOR_ONBOARDING_STEPS.length - 1
    ? CREATOR_ONBOARDING_STEPS[i + 1]
    : null;
}

/** The previous step in surface order, or null at the start. */
export function prevStep(
  step: CreatorOnboardingStep
): CreatorOnboardingStep | null {
  const i = stepIndex(step);
  return i > 0 ? CREATOR_ONBOARDING_STEPS[i - 1] : null;
}

/** 1-based position + total, for "Step 2 of 5" style progress copy. */
export function stepProgress(step: CreatorOnboardingStep): {
  position: number;
  total: number;
  percent: number;
} {
  const total = CREATOR_ONBOARDING_STEPS.length;
  const position = stepIndex(step) + 1;
  return {
    position,
    total,
    percent: Math.round((position / total) * 100),
  };
}
