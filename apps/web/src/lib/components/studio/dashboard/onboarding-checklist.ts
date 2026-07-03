/**
 * Creator first-run onboarding checklist (WP-9 — Codex-fc5oh.9).
 *
 * Pure state aggregator for the "Get set up" checklist rendered on the
 * personal creator studio dashboard (`_creators/studio/+page.svelte`).
 *
 * Why a pure function (mirrors `agreement-focus-items.ts`):
 *  - The dashboard is `ssr=false`; every signal arrives via remote queries.
 *    This helper receives the resolved booleans as plain inputs and stays
 *    free of `$derived` / browser globals, so it unit-tests without a
 *    Svelte render.
 *  - It returns STATE only (step ids + done flags + counts) — never display
 *    copy or hrefs. The component maps ids → Paraglide `m.*` copy + routes,
 *    keeping i18n in the component and completion logic here.
 *
 * Architecture note — why these four core steps (and studio is optional):
 *  The personal creator studio is orgless-capable. Content is
 *  org-nullable (slug uniqueness falls back to per-creator), media is
 *  creator-scoped, and Stripe Connect is ONE account per USER
 *  (`/connect/me/*`), not per-org. So a creator can connect payouts →
 *  upload → publish → get paid without ever creating an org. Opening a
 *  studio (org) is an OPTIONAL upgrade that unlocks branding, a team, and
 *  subscription tiers — hence it is surfaced separately and excluded from
 *  the core progress count.
 */

/** The four core onboarding steps, in surface order. */
export type OnboardingStepId = 'profile' | 'payouts' | 'media' | 'publish';

export interface OnboardingStepState {
  id: OnboardingStepId;
  done: boolean;
}

/** The optional "open a studio" step — surfaced only while org-less. */
export interface OptionalStudioStepState {
  /** Hidden once the creator already belongs to an org. */
  show: boolean;
  done: boolean;
}

export interface OnboardingChecklistState {
  /** Core steps in display order. */
  steps: OnboardingStepState[];
  optionalStudio: OptionalStudioStepState;
  /** Count of completed CORE steps (optional studio excluded). */
  completedCount: number;
  /** Total CORE steps. */
  totalCount: number;
  /** Whole-number completion percentage of core steps (0–100). */
  percent: number;
  /** True once every core step is done — caller hides the checklist. */
  complete: boolean;
}

export interface OnboardingChecklistInput {
  /**
   * Creator profile is set up. Always true for anyone who reached the
   * studio (become-creator requires a username), but modelled explicitly
   * so the first row reads as an already-earned win rather than a nag.
   */
  profileComplete: boolean;
  /**
   * Stripe Connect is fully enabled for payouts — i.e. both
   * `chargesEnabled` AND `payoutsEnabled` on the per-user account.
   */
  payoutsEnabled: boolean;
  /** At least one media item exists (creator-scoped count > 0). */
  hasMedia: boolean;
  /** At least one PUBLISHED content item exists (status='published'). */
  hasPublishedContent: boolean;
  /** The creator belongs to at least one organisation. */
  hasOrg: boolean;
}

/**
 * Build the checklist state from resolved signals. Ordering is fixed:
 * profile → payouts → media → publish. The optional studio step is
 * returned separately and never counts toward core completion.
 */
export function buildCreatorOnboardingChecklist(
  input: OnboardingChecklistInput
): OnboardingChecklistState {
  const steps: OnboardingStepState[] = [
    { id: 'profile', done: input.profileComplete },
    { id: 'payouts', done: input.payoutsEnabled },
    { id: 'media', done: input.hasMedia },
    { id: 'publish', done: input.hasPublishedContent },
  ];

  const totalCount = steps.length;
  const completedCount = steps.filter((s) => s.done).length;
  const percent =
    totalCount === 0 ? 100 : Math.round((completedCount / totalCount) * 100);

  return {
    steps,
    optionalStudio: {
      // Only nudge org creation while the creator has none — an existing
      // multi-org creator must never see a "create a studio" prompt.
      show: !input.hasOrg,
      done: input.hasOrg,
    },
    completedCount,
    totalCount,
    percent,
    complete: completedCount === totalCount,
  };
}
