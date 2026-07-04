import type { R2Service } from '@codex/cloudflare-clients';
import type { Database } from '@codex/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IdentityService } from '../services/identity-service';

/**
 * Unit tests for the creator onboarding methods.
 *
 * Unlike the (skipped) notification-preferences tests, these CAPTURE the
 * arguments the service passes into the insert/upsert chain, so they actually
 * assert the meaningful logic: the boolean-intent → server-timestamp mapping
 * and the partial-patch behaviour.
 */

// Captured call args from the mocked insert chain.
let valuesArg: Record<string, unknown> | undefined;
let setArg: Record<string, unknown> | undefined;
let returnedRow: Record<string, unknown>;

const mockReturning = vi.fn(async () => [returnedRow]);
const mockOnConflict = vi.fn((cfg: { set: Record<string, unknown> }) => {
  setArg = cfg.set;
  return { returning: mockReturning };
});
const mockValues = vi.fn((v: Record<string, unknown>) => {
  valuesArg = v;
  return { onConflictDoUpdate: mockOnConflict };
});

const mockDb = {
  insert: vi.fn(() => ({ values: mockValues })),
} as unknown as Database;

const mockR2Service = {
  put: vi.fn(),
  delete: vi.fn(),
} as unknown as R2Service;

const USER_ID = 'user-123';

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    userId: USER_ID,
    currentStep: 'essentials',
    welcomeSeenAt: null,
    dismissedAt: null,
    completedAt: null,
    createdAt: new Date('2026-07-03T00:00:00.000Z'),
    updatedAt: new Date('2026-07-03T00:00:00.000Z'),
    ...overrides,
  };
}

describe('IdentityService creator onboarding', () => {
  let service: IdentityService;

  beforeEach(() => {
    valuesArg = undefined;
    setArg = undefined;
    returnedRow = makeRow();
    vi.clearAllMocks();
    service = new IdentityService({
      db: mockDb,
      environment: 'test',
      r2Service: mockR2Service,
      r2PublicUrlBase: 'https://cdn-test.revelations.studio',
    });
  });

  describe('getCreatorOnboarding', () => {
    it('upserts with only userId and a no-op set, returning the row', async () => {
      const result = await service.getCreatorOnboarding(USER_ID);

      expect(valuesArg).toEqual({ userId: USER_ID });
      expect(setArg).toEqual({ userId: USER_ID });
      expect(result.currentStep).toBe('essentials');
      expect(result.welcomeSeenAt).toBeNull();
    });
  });

  describe('updateCreatorOnboarding', () => {
    it('moves the step pointer without touching timestamps', async () => {
      returnedRow = makeRow({ currentStep: 'payouts' });

      const result = await service.updateCreatorOnboarding(USER_ID, {
        currentStep: 'payouts',
      });

      expect(valuesArg).toMatchObject({
        userId: USER_ID,
        currentStep: 'payouts',
      });
      expect(setArg?.currentStep).toBe('payouts');
      // No boolean intents → no timestamp keys in the patch.
      expect(setArg).not.toHaveProperty('welcomeSeenAt');
      expect(setArg).not.toHaveProperty('dismissedAt');
      expect(setArg).not.toHaveProperty('completedAt');
      expect(result.currentStep).toBe('payouts');
    });

    it('maps boolean intents to server-set Date timestamps', async () => {
      await service.updateCreatorOnboarding(USER_ID, {
        welcomeSeen: true,
        dismissed: true,
        completed: true,
      });

      expect(setArg?.welcomeSeenAt).toBeInstanceOf(Date);
      expect(setArg?.dismissedAt).toBeInstanceOf(Date);
      expect(setArg?.completedAt).toBeInstanceOf(Date);
      // updatedAt is always bumped on the upsert path.
      expect(setArg?.updatedAt).toBeInstanceOf(Date);
    });

    it('ignores a false intent (does not write that timestamp)', async () => {
      await service.updateCreatorOnboarding(USER_ID, {
        welcomeSeen: false,
        completed: true,
      });

      expect(setArg).not.toHaveProperty('welcomeSeenAt');
      expect(setArg?.completedAt).toBeInstanceOf(Date);
    });
  });
});
