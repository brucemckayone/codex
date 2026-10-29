/**
 * The /admin shell (Codex-2hxff.28): the Support sub-nav. The Queue count is
 * streamed: the nav renders at once without a number, shows it when the
 * counts land, and shows no Badge at all if they fail (data design §7).
 * The layout holds the one counts query its pages refresh.
 */

import { createRawSnippet } from 'svelte';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

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
  countsSlot,
  getSupportQueueCounts,
  httpError,
  reset,
} from '$lib/components/support/__fixtures__/support-remote.mock.svelte';
import AdminLayout from '../+layout.svelte';
import AdminLayoutWithProbe from './AdminLayoutWithProbe.svelte';

let component: ReturnType<typeof mount> | null = null;

beforeEach(() => reset());

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

function mountAt(href: string) {
  setPage(href);
  component = mount(AdminLayout, {
    target: document.body,
    props: {
      children: createRawSnippet(() => ({
        render: () => '<p data-testid="child">page</p>',
      })),
    },
  });
  flushSync();
}

const queueLink = () =>
  [...document.querySelectorAll('nav a')].find((a) =>
    a.textContent?.includes(m.support_nav_queue())
  );

describe('the Support nav', () => {
  test('renders at once, with the page, before the count lands', () => {
    mountAt('/admin/queue');
    expect(document.querySelector('[data-testid="child"]')).not.toBeNull();
    expect(queueLink()?.getAttribute('aria-current')).toBe('page');
    expect(queueLink()?.querySelector('[data-variant="warning"]')).toBeNull();
  });

  test('shows the waiting total of all three tabs once the counts land, and says it', () => {
    mountAt('/admin/refunds');
    // Owed to creators counts too (Q8): 2 + 1 + 6, as drawn (O1).
    countsSlot().current = {
      failedRefunds: 2,
      creatorDebts: 1,
      owedToCreators: 6,
    };
    flushSync();
    expect(
      queueLink()?.querySelector('[data-variant="warning"]')?.textContent
    ).toBe('9');
    expect(queueLink()?.textContent).toContain(
      m.support_nav_queue_waiting({ count: '9' })
    );
  });

  test('a page gets the layout’s own counts query, never a second one', () => {
    // kit drops a query whose first load failed: a second call would be a
    // new instance the badge never reads. Here the first call's is unique.
    getSupportQueueCounts.mockImplementationOnce(
      () => ({ current: undefined, error: undefined, loading: false }) as never
    );
    const seen: unknown[] = [];
    setPage('/admin/queue');
    component = mount(AdminLayoutWithProbe, {
      target: document.body,
      props: { onCounts: (query: unknown) => seen.push(query) },
    });
    flushSync();
    expect(getSupportQueueCounts).toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(getSupportQueueCounts.mock.results[0]?.value);
  });

  test('a failed count shows no badge, and the nav still works', () => {
    mountAt('/admin/refunds');
    countsSlot().error = httpError(500);
    flushSync();
    expect(queueLink()?.querySelector('[data-variant="warning"]')).toBeNull();
    expect(queueLink()?.getAttribute('href')).toBe('/admin/queue');
  });
});
