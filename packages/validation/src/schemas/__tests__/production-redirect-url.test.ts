/**
 * Checkout return links, by environment (Codex-2hxff.79).
 *
 * `checkoutRedirectUrlSchema` is the same in every environment: it cannot
 * tell them apart, and e2e returns to localhost and lvh.me. A production
 * worker applies `isProductionRedirectUrl` on top, which refuses the
 * development hosts and plain http.
 */

import { describe, expect, it } from 'vitest';
import {
  checkoutRedirectUrlSchema,
  isProductionRedirectUrl,
} from '../purchase';

const DEV_LINKS = [
  'http://localhost:3000/checkout/success',
  'https://localhost/checkout/success',
  'http://127.0.0.1:5173/checkout/success',
  'http://of-blood-and-bones.lvh.me:3000/checkout/success',
  'https://of-blood-and-bones.lvh.me/checkout/success',
];

describe('isProductionRedirectUrl', () => {
  it.each([
    'https://revelations.studio/checkout/success?session_id={CHECKOUT_SESSION_ID}',
    'https://of-blood-and-bones.revelations.studio/checkout/success',
    'https://app.revelations.studio/account/payment',
    'https://codex-staging.revelations.studio/checkout/success',
  ])('accepts https on the platform: %s', (url) => {
    expect(isProductionRedirectUrl(url)).toBe(true);
  });

  it.each(DEV_LINKS)('refuses a development host: %s', (url) => {
    expect(isProductionRedirectUrl(url)).toBe(false);
  });

  it.each([
    'http://revelations.studio/checkout/success',
    'http://of-blood-and-bones.revelations.studio/checkout/success',
  ])('refuses plain http, even on the platform: %s', (url) => {
    expect(isProductionRedirectUrl(url)).toBe(false);
  });

  it.each([
    'https://evil.example/checkout/success',
    'https://revelations.studio.evil.example/checkout/success',
    'https://evilrevelations.studio/checkout/success',
    'javascript:alert(1)',
    'not a url',
  ])('refuses anything else: %s', (url) => {
    expect(isProductionRedirectUrl(url)).toBe(false);
  });
});

describe('checkoutRedirectUrlSchema is unchanged in every environment', () => {
  it.each(DEV_LINKS)('still accepts a development host: %s', (url) => {
    expect(checkoutRedirectUrlSchema.safeParse(url).success).toBe(true);
  });

  it('still refuses a host off the list', () => {
    expect(
      checkoutRedirectUrlSchema.safeParse('https://evil.example/success')
        .success
    ).toBe(false);
  });
});
