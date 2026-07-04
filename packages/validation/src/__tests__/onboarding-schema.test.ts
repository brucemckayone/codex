import { describe, expect, it } from 'vitest';
import {
  CREATOR_ONBOARDING_STEPS,
  creatorOnboardingStepSchema,
  updateCreatorOnboardingSchema,
} from '../identity/onboarding-schema';

describe('creatorOnboardingStepSchema', () => {
  it('accepts every step in surface order', () => {
    expect(CREATOR_ONBOARDING_STEPS).toEqual([
      'essentials',
      'profile',
      'payouts',
      'finish',
    ]);
    for (const step of CREATOR_ONBOARDING_STEPS) {
      expect(creatorOnboardingStepSchema.parse(step)).toBe(step);
    }
  });

  it('rejects an unknown step', () => {
    expect(creatorOnboardingStepSchema.safeParse('dashboard').success).toBe(
      false
    );
  });
});

describe('updateCreatorOnboardingSchema', () => {
  it('accepts a step-pointer move', () => {
    const parsed = updateCreatorOnboardingSchema.parse({
      currentStep: 'payouts',
    });
    expect(parsed).toEqual({ currentStep: 'payouts' });
  });

  it('accepts boolean intents', () => {
    const parsed = updateCreatorOnboardingSchema.parse({
      welcomeSeen: true,
      dismissed: false,
      completed: true,
    });
    expect(parsed).toEqual({
      welcomeSeen: true,
      dismissed: false,
      completed: true,
    });
  });

  it('rejects an empty patch (must provide at least one field)', () => {
    expect(updateCreatorOnboardingSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a bad step value', () => {
    expect(
      updateCreatorOnboardingSchema.safeParse({ currentStep: 'nope' }).success
    ).toBe(false);
  });

  it('rejects a non-boolean intent', () => {
    expect(
      updateCreatorOnboardingSchema.safeParse({ completed: 'yes' }).success
    ).toBe(false);
  });
});
