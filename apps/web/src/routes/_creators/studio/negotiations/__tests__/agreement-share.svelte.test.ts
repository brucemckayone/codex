/**
 * Creator studio → Negotiations: an active agreement shows the creator's own
 * `creatorSharePercent`, never `10000 - organizationFeePercentage`
 * (Codex-fazy6).
 *
 * The worker still sends the legacy column, and the fixture sets it to
 * DISAGREE with the real share (it would rebuild 70% from a 40% agreement).
 * A missing share (`null`) shows "—".
 *
 * Mounts the real `+page.svelte`; the remote module is mocked.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

vi.mock(
  '$lib/remote/agreements.remote',
  () =>
    import(
      '$lib/components/agreements/__fixtures__/agreements-remote.mock.svelte'
    )
);

import {
  LEGACY_SHARE,
  portfolioActiveRow,
  REAL_SHARE,
  reset,
  setPortfolio,
} from '$lib/components/agreements/__fixtures__/agreements-remote.mock.svelte';
import {
  MISSING_SHARE_PARTS,
  missingShareParts,
} from '$lib/components/agreements/__fixtures__/missing-share';
import NegotiationsPage from '../+page.svelte';

let component: ReturnType<typeof mount> | null = null;

beforeEach(() => reset());

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

function mountWith(rows: ReturnType<typeof portfolioActiveRow>[]) {
  setPortfolio(rows);
  component = mount(NegotiationsPage, {
    target: document.body,
    props: { data: {} } as never,
  });
  flushSync();
}

const share = () =>
  document
    .querySelector('.negotiations-page__item-share')
    ?.textContent?.replace(/\s+/g, ' ')
    .trim() ?? '';

describe('an active agreement', () => {
  test("shows the agreement's own 40%, not the legacy column's 70%", () => {
    mountWith([portfolioActiveRow()]);
    expect(share().startsWith(REAL_SHARE)).toBe(true);
    expect(share()).not.toContain(LEGACY_SHARE);
  });

  test('a missing share shows an em dash, never 0%', () => {
    mountWith([portfolioActiveRow({ creatorSharePercent: null })]);
    expect(share().startsWith('—')).toBe(true);
    expect(
      missingShareParts(
        document.querySelector('.negotiations-page__item-share')
      )
    ).toEqual(MISSING_SHARE_PARTS);
    expect(share()).not.toContain('0%');
    expect(share()).not.toContain(LEGACY_SHARE);
  });
});
