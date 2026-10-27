/**
 * Personal studio navigation (Codex-2hxff.21): Sales sits between
 * Negotiations and Earnings, with the org studio's Sales icon.
 */

import { describe, expect, test } from 'vitest';
import { SIDEBAR_OWNER_LINKS, SIDEBAR_PERSONAL_LINKS } from '../navigation';

describe('SIDEBAR_PERSONAL_LINKS', () => {
  test('lists Sales between Negotiations and Earnings', () => {
    expect(SIDEBAR_PERSONAL_LINKS.map((link) => link.href)).toEqual([
      '/studio/negotiations',
      '/studio/sales',
      '/studio/earnings',
      '/studio/settings',
    ]);
  });

  test('reuses the org Sales link label and icon', () => {
    const personal = SIDEBAR_PERSONAL_LINKS.find(
      (link) => link.href === '/studio/sales'
    );
    const owner = SIDEBAR_OWNER_LINKS.find(
      (link) => link.href === '/studio/sales'
    );
    expect(personal).toEqual(owner);
    expect(personal?.icon).toBe('sales');
  });
});
