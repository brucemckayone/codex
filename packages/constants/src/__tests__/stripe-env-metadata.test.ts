import { describe, expect, it } from 'vitest';
import {
  isForeignStripeEnvironment,
  STRIPE_ENV_METADATA_KEY,
  stripeEnvMetadata,
} from '../commerce';

describe('Stripe environment tag (Codex-2hxff.5)', () => {
  it('tags with codex_env', () => {
    expect(STRIPE_ENV_METADATA_KEY).toBe('codex_env');
    expect(stripeEnvMetadata('production')).toEqual({
      codex_env: 'production',
    });
  });

  it('an object tagged by another environment is foreign', () => {
    expect(
      isForeignStripeEnvironment({ codex_env: 'development' }, 'production')
    ).toBe(true);
  });

  it('an object tagged by this environment is not foreign', () => {
    expect(
      isForeignStripeEnvironment({ codex_env: 'production' }, 'production')
    ).toBe(false);
  });

  // Every object created before tagging began has no tag — every existing
  // subscription among them. Treating these as foreign would stop renewals.
  it.each([
    ['no metadata', undefined],
    ['null metadata', null],
    ['metadata without the key', { codex_user_id: 'u1' }],
    ['an empty tag', { codex_env: '' }],
  ])('%s is NOT foreign', (_label, metadata) => {
    expect(isForeignStripeEnvironment(metadata, 'production')).toBe(false);
  });
});
