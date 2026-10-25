/**
 * /admin/refunds — find a charge (Codex-2hxff.28, mockup A1, A2).
 *
 * The trap: a REJECTED remote query leaves `current` undefined and `loading`
 * false, which a naive gate reads as "no results", telling support "No
 * charge found" when the search never ran. The page must show the error.
 *
 * Mounts the real `+page.svelte`; `$app/*` and the remote module (it imports
 * `$app/server`) are the reactive doubles.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const navigation = vi.hoisted(() => ({
  goto: vi.fn(async (_url: string, _opts?: unknown) => {}),
  afterNavigate: vi.fn(),
}));
vi.mock('$app/navigation', () => navigation);
vi.mock(
  '$app/state',
  () => import('$lib/components/support/__fixtures__/app-state.mock.svelte')
);
vi.mock(
  '$lib/remote/support.remote',
  () =>
    import('$lib/components/support/__fixtures__/support-remote.mock.svelte')
);

import { setPage } from '$lib/components/support/__fixtures__/app-state.mock.svelte';
import {
  chargeSummary,
  list,
} from '$lib/components/support/__fixtures__/support-fixtures';
import {
  httpError,
  reset,
  searchSlot,
  searchSupportCharges,
} from '$lib/components/support/__fixtures__/support-remote.mock.svelte';
import RefundsPage from '../+page.svelte';

let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  reset();
  navigation.goto.mockClear();
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

function mountAt(href: string) {
  setPage(href);
  component = mount(RefundsPage, { target: document.body });
  flushSync();
}

const text = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';
const EMAIL = 'ellie.marsh@example.com';

describe('searching', () => {
  test('a rejected search shows the error, not "No charge found"', () => {
    mountAt(`/admin/refunds?q=${encodeURIComponent(EMAIL)}`);
    searchSlot(EMAIL).error = httpError(500, 'An unexpected error occurred');
    flushSync();

    expect(
      document.querySelector('[data-testid="search-error"]')
    ).not.toBeNull();
    expect(text()).toContain(m.support_search_error_lead());
    expect(text()).not.toContain(m.support_empty_title());
    // Our own words, not the server's pasted into the sentence.
    expect(text()).toContain(m.support_try_again_soon());
    expect(text()).not.toContain('An unexpected error occurred');
  });

  test('a search the guard refused (a 404, no code) says the session ended', () => {
    mountAt(`/admin/refunds?q=${encodeURIComponent(EMAIL)}`);
    searchSlot(EMAIL).error = httpError(404, 'Not Found');
    flushSync();
    expect(
      document.querySelector('[data-testid="session-ended"]')?.textContent
    ).toContain(m.support_outcome_signed_out_lead());
    expect(document.querySelector('[data-testid="search-error"]')).toBeNull();
    expect(document.body.textContent).not.toContain(m.support_try_again_soon());
  });

  test('while it runs: skeleton rows, and neither an error nor the empty state', () => {
    mountAt(`/admin/refunds?q=${encodeURIComponent(EMAIL)}`);
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(text()).not.toContain(m.support_empty_title());
    expect(document.querySelector('[data-testid="search-error"]')).toBeNull();
  });

  test('a search that found nothing: "No charge found", in words for an email', () => {
    mountAt(`/admin/refunds?q=${encodeURIComponent(EMAIL)}`);
    searchSlot(EMAIL).current = list([]);
    flushSync();
    expect(text()).toContain(m.support_empty_title());
    expect(text()).toContain(m.support_empty_email());
  });

  test('results: the charges, and who they are for', () => {
    mountAt(`/admin/refunds?q=${encodeURIComponent(EMAIL)}`);
    searchSlot(EMAIL).current = list([chargeSummary()]);
    flushSync();
    expect(searchSupportCharges).toHaveBeenCalledWith({
      q: EMAIL,
      page: 1,
      limit: 20,
    });
    expect(
      document.querySelectorAll('[data-testid="charge-row"]')
    ).toHaveLength(1);
    expect(text()).toContain(
      m.support_search_summary_for({
        charges: m.support_search_count_one(),
        name: 'Ellie Marsh',
        matched: m.support_matched_email(),
      })
    );
  });

  test('no search before 3 characters, and no query at all without one', () => {
    mountAt('/admin/refunds?q=el');
    expect(searchSupportCharges).not.toHaveBeenCalled();
    expect(text()).toContain(m.support_search_too_short());
    unmount(component as ReturnType<typeof mount>);
    document.body.innerHTML = '';
    mountAt('/admin/refunds');
    expect(searchSupportCharges).not.toHaveBeenCalled();
    expect(text()).not.toContain(m.support_empty_title());
  });

  test('Search puts the box’s text in the URL', () => {
    mountAt('/admin/refunds');
    const input = document.querySelector<HTMLInputElement>(
      'input[type="search"]'
    );
    if (!input) throw new Error('no search box');
    input.value = '  pi_3QzZ9KQ2eZvKYlo21x ';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    [...document.querySelectorAll('button')]
      .find((b) => b.textContent?.includes(m.support_search_button()))
      ?.click();
    expect(navigation.goto).toHaveBeenCalledWith(
      '/admin/refunds?q=pi_3QzZ9KQ2eZvKYlo21x',
      {
        keepFocus: true,
      }
    );
  });
});
