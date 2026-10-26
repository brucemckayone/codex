/**
 * Creator studio → Negotiation detail: the bar is what's left after Codex's
 * fee (Codex-2hxff.20 AGR-11), the same basis as the owner's page, and the
 * peer slice is "Other creators (2)".
 *
 * The page used to hard-code a 10% "Platform fee" slice and draw the shares
 * against the whole sale, so "Org residual" came out 10 points short. And it
 * passed "Other creators (2)" to a bar that replaced any anonymous label with
 * "Other creator 2", which reads as one person.
 *
 * Mounts the real `+page.svelte` and pie; `$app/*` and the remote module are
 * mocked.
 */

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import * as m from '$paraglide/messages';
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
  portfolioActiveRow,
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
  // Tom's 25%, and two peers on the pool at 30% between them.
  setPortfolio([
    {
      ...portfolioActiveRow({ creatorSharePercent: 2500 }),
      peers: { count: 2, aggregateSharePercent: 3000 },
    },
  ]);
  component = mount(DetailPage, {
    target: document.body,
    props: { data: {} } as never,
  });
  flushSync();
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

const legend = () =>
  [...document.querySelectorAll('.revenue-split-pie__legend-item')].map(
    (li) => [
      li.querySelector('.revenue-split-pie__legend-label')?.textContent?.trim(),
      li.querySelector('.revenue-split-pie__legend-value')?.textContent?.trim(),
    ]
  );

test("the bar is 100% of what's left after Codex's fee, with no fee slice", () => {
  expect(legend()).toEqual([
    ['Your share', '25%'],
    ['Other creators (2)', '30%'],
    [m.agreement_split_organisation(), '45%'],
  ]);
  expect(document.body.textContent).not.toContain('Platform fee');
  expect(document.querySelector('.revenue-split-pie__basis')?.textContent).toBe(
    m.agreement_split_basis()
  );
});
