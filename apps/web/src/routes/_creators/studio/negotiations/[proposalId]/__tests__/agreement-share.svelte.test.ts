/**
 * Creator studio → Negotiation detail: "Your share" and the pie read the
 * active agreement's own `creatorSharePercent`, never
 * `10000 - organizationFeePercentage` (Codex-fazy6).
 *
 * The fixture's legacy column DISAGREES with the real share (it would rebuild
 * 70% from a 40% agreement). A missing share (`null`) shows "—" and gets no
 * "Your share" slice, so the pie legend never says 0% for it.
 *
 * Mounts the real `+page.svelte` and pie; `$app/*` and the remote module are
 * mocked.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}) }));
vi.mock(
  '$app/state',
  () => import('$lib/components/support/__fixtures__/app-state.mock.svelte')
);
vi.mock(
  '$lib/remote/agreements.remote',
  () =>
    import(
      '$lib/components/agreements/__fixtures__/agreements-remote.mock.svelte'
    )
);

import {
  acceptedProposal,
  LEGACY_SHARE,
  portfolioActiveRow,
  REAL_SHARE,
  reset,
  setMyThread,
  setPortfolio,
} from '$lib/components/agreements/__fixtures__/agreements-remote.mock.svelte';
import { setPage } from '$lib/components/support/__fixtures__/app-state.mock.svelte';
import DetailPage from '../+page.svelte';

let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  reset();
  const proposal = acceptedProposal();
  setPage(`/studio/negotiations/${proposal.id}`, { proposalId: proposal.id });
  setMyThread([proposal]);
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

function mountWith(rows: ReturnType<typeof portfolioActiveRow>[]) {
  setPortfolio(rows);
  component = mount(DetailPage, {
    target: document.body,
    props: { data: {} } as never,
  });
  flushSync();
}

const text = (el: Element | null | undefined) =>
  el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const yourShare = () =>
  document.querySelector('.agreement-detail__split-summary strong');
const pie = () => document.querySelector('.revenue-split-pie');

describe('an active agreement', () => {
  test('"Your share" and the pie say 40%, not the legacy column\'s 70%', () => {
    mountWith([portfolioActiveRow()]);
    expect(text(yourShare())).toBe(REAL_SHARE);
    expect(text(pie())).toContain('Your share');
    expect(text(pie())).toContain(REAL_SHARE);
    expect(text(pie())).not.toContain(LEGACY_SHARE);
  });

  test('a missing share shows an em dash and gets no pie slice', () => {
    mountWith([portfolioActiveRow({ creatorSharePercent: null })]);
    expect(text(yourShare())).toBe('—');
    expect(text(pie())).not.toContain('Your share');
    expect(text(pie())).not.toContain(LEGACY_SHARE);
  });
});
