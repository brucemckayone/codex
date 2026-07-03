/**
 * Unit tests for the creator onboarding checklist aggregator
 * (WP-9 — Codex-fc5oh.9).
 *
 * Pure-function tests — no Svelte render, no remote calls. The aggregator
 * receives resolved boolean signals and returns checklist STATE; these
 * tests pin step ordering, core completion counting, percent rounding,
 * and the optional-studio visibility rule (never shown to org-owning
 * creators, and never counted toward core progress).
 */

import { describe, expect, it } from 'vitest';
import {
  buildCreatorOnboardingChecklist,
  type OnboardingChecklistInput,
} from './onboarding-checklist';

const base: OnboardingChecklistInput = {
  profileComplete: false,
  payoutsEnabled: false,
  hasMedia: false,
  hasPublishedContent: false,
  hasOrg: false,
};

describe('buildCreatorOnboardingChecklist', () => {
  it('emits the four core steps in fixed order', () => {
    const state = buildCreatorOnboardingChecklist(base);
    expect(state.steps.map((s) => s.id)).toEqual([
      'profile',
      'payouts',
      'media',
      'publish',
    ]);
  });

  it('reports zero progress when nothing is done', () => {
    const state = buildCreatorOnboardingChecklist(base);
    expect(state.completedCount).toBe(0);
    expect(state.totalCount).toBe(4);
    expect(state.percent).toBe(0);
    expect(state.complete).toBe(false);
  });

  it('counts a fresh creator (profile only) as 1 of 4 / 25%', () => {
    // become-creator always sets a username, so a brand-new creator lands
    // with exactly the profile step pre-completed.
    const state = buildCreatorOnboardingChecklist({
      ...base,
      profileComplete: true,
    });
    expect(state.completedCount).toBe(1);
    expect(state.percent).toBe(25);
    expect(state.complete).toBe(false);
    expect(state.steps.find((s) => s.id === 'profile')?.done).toBe(true);
  });

  it('marks each step done from its matching signal', () => {
    const state = buildCreatorOnboardingChecklist({
      profileComplete: true,
      payoutsEnabled: true,
      hasMedia: false,
      hasPublishedContent: false,
      hasOrg: false,
    });
    const done = Object.fromEntries(state.steps.map((s) => [s.id, s.done]));
    expect(done).toEqual({
      profile: true,
      payouts: true,
      media: false,
      publish: false,
    });
    expect(state.completedCount).toBe(2);
    expect(state.percent).toBe(50);
  });

  it('rounds partial progress to a whole percent', () => {
    // 3 of 4 core steps done → 75%.
    const state = buildCreatorOnboardingChecklist({
      profileComplete: true,
      payoutsEnabled: true,
      hasMedia: true,
      hasPublishedContent: false,
      hasOrg: false,
    });
    expect(state.completedCount).toBe(3);
    expect(state.percent).toBe(75);
    expect(state.complete).toBe(false);
  });

  it('is complete only when all four core steps are done', () => {
    const state = buildCreatorOnboardingChecklist({
      profileComplete: true,
      payoutsEnabled: true,
      hasMedia: true,
      hasPublishedContent: true,
      hasOrg: false,
    });
    expect(state.completedCount).toBe(4);
    expect(state.percent).toBe(100);
    expect(state.complete).toBe(true);
  });

  it('shows the optional studio step only while the creator is org-less', () => {
    const orgless = buildCreatorOnboardingChecklist(base);
    expect(orgless.optionalStudio.show).toBe(true);
    expect(orgless.optionalStudio.done).toBe(false);

    const withOrg = buildCreatorOnboardingChecklist({ ...base, hasOrg: true });
    expect(withOrg.optionalStudio.show).toBe(false);
    expect(withOrg.optionalStudio.done).toBe(true);
  });

  it('never counts the optional studio step toward core completion', () => {
    // Org exists but no core step done → still 0 of 4 core, not complete.
    const state = buildCreatorOnboardingChecklist({ ...base, hasOrg: true });
    expect(state.totalCount).toBe(4);
    expect(state.completedCount).toBe(0);
    expect(state.complete).toBe(false);
  });
});
