import { describe, expect, it } from 'vitest';
import {
  isOnboardingActive,
  nextStep,
  type OnboardingSignals,
  prevStep,
  resolveOnboardingStep,
  shouldResumeInWizard,
  stepProgress,
} from './onboarding-flow';

function signals(
  overrides: Partial<OnboardingSignals> = {}
): OnboardingSignals {
  return {
    role: 'creator',
    hasUsername: true,
    hasAvatar: true,
    payoutsEnabled: true,
    currentStep: 'essentials',
    ...overrides,
  };
}

describe('isOnboardingActive', () => {
  it('is active when neither dismissed nor completed', () => {
    expect(isOnboardingActive({ dismissedAt: null, completedAt: null })).toBe(
      true
    );
  });

  it('is inactive once dismissed', () => {
    expect(
      isOnboardingActive({
        dismissedAt: '2026-07-03T00:00:00Z',
        completedAt: null,
      })
    ).toBe(false);
  });

  it('is inactive once completed', () => {
    expect(
      isOnboardingActive({
        dismissedAt: null,
        completedAt: '2026-07-03T00:00:00Z',
      })
    ).toBe(false);
  });
});

describe('resolveOnboardingStep', () => {
  it('pins a customer to essentials regardless of pointer/param', () => {
    expect(
      resolveOnboardingStep(
        signals({
          role: 'customer',
          hasUsername: false,
          currentStep: 'payouts',
        }),
        'finish'
      )
    ).toBe('essentials');
  });

  it('pins a creator with no username to essentials', () => {
    expect(
      resolveOnboardingStep(signals({ hasUsername: false }), 'profile')
    ).toBe('essentials');
  });

  it('honors a valid requested step for an upgraded creator', () => {
    expect(resolveOnboardingStep(signals(), 'payouts')).toBe('payouts');
  });

  it('falls back to the stored pointer when no valid param', () => {
    expect(
      resolveOnboardingStep(signals({ currentStep: 'payouts' }), 'garbage')
    ).toBe('payouts');
  });

  it('derives from data when neither param nor pointer is valid', () => {
    // No avatar → profile step, despite a nonsense stored pointer.
    expect(
      resolveOnboardingStep(
        signals({ hasAvatar: false, currentStep: 'not-a-step' }),
        null
      )
    ).toBe('profile');
  });

  it('derives payouts when avatar present but payouts not enabled', () => {
    expect(
      resolveOnboardingStep(
        signals({ payoutsEnabled: false, currentStep: 'not-a-step' }),
        null
      )
    ).toBe('payouts');
  });

  it('derives finish when everything is done', () => {
    expect(
      resolveOnboardingStep(signals({ currentStep: 'not-a-step' }), null)
    ).toBe('finish');
  });
});

describe('shouldResumeInWizard', () => {
  const active = { dismissedAt: null, completedAt: null };

  it('resumes a creator who advanced past essentials and abandoned', () => {
    expect(shouldResumeInWizard({ currentStep: 'profile', ...active })).toBe(
      true
    );
    expect(shouldResumeInWizard({ currentStep: 'payouts', ...active })).toBe(
      true
    );
  });

  it('never traps a legacy creator whose record is a fresh essentials upsert', () => {
    expect(shouldResumeInWizard({ currentStep: 'essentials', ...active })).toBe(
      false
    );
  });

  it('leaves finished creators alone', () => {
    expect(
      shouldResumeInWizard({
        currentStep: 'profile',
        dismissedAt: null,
        completedAt: '2026-07-03T00:00:00Z',
      })
    ).toBe(false);
  });

  it('leaves dismissed creators alone', () => {
    expect(
      shouldResumeInWizard({
        currentStep: 'payouts',
        dismissedAt: '2026-07-03T00:00:00Z',
        completedAt: null,
      })
    ).toBe(false);
  });

  it('does not resume on the finish step (nothing left to do)', () => {
    expect(shouldResumeInWizard({ currentStep: 'finish', ...active })).toBe(
      false
    );
  });
});

describe('step navigation', () => {
  it('walks forward through the ordered steps', () => {
    expect(nextStep('essentials')).toBe('profile');
    expect(nextStep('profile')).toBe('payouts');
    expect(nextStep('payouts')).toBe('finish');
    expect(nextStep('finish')).toBeNull();
  });

  it('walks backward through the ordered steps', () => {
    expect(prevStep('finish')).toBe('payouts');
    expect(prevStep('essentials')).toBeNull();
  });

  it('reports 1-based progress', () => {
    expect(stepProgress('essentials')).toEqual({
      position: 1,
      total: 4,
      percent: 25,
    });
    expect(stepProgress('finish')).toEqual({
      position: 4,
      total: 4,
      percent: 100,
    });
  });
});
