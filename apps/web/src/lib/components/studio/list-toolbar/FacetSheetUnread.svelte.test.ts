/**
 * The phone sheet's word on a facet it could not read (Codex-a6ofh.3.3,
 * owner): what failed, then "Trying again…" while a Try again runs, then the
 * failed-again words if it fails too, as the desktop menu says them.
 */
import { afterEach, describe, expect, test } from 'vitest';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import FacetSheetUnread from './FacetSheetUnread.svelte';

let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

const settle = async () => {
  for (let i = 0; i < 3; i++)
    await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
};
const words = () =>
  document.querySelector('[role="status"]')?.textContent?.trim();
const retryButton = () =>
  document.querySelector<HTMLButtonElement>('.facet-unread-retry');

/** An unread facet whose each Try again waits for the test to settle it. */
function unreadFacet() {
  const reads: Array<{ ok: () => void; fail: (error: unknown) => void }> = [];
  return {
    reads,
    unread: {
      failed: () => 'Couldn’t load the things.',
      failedAgain: () => 'Still couldn’t load the things.',
      retry: () =>
        new Promise<void>((ok, fail) => {
          reads.push({ ok, fail });
        }),
    },
  };
}

describe('FacetSheetUnread', () => {
  test('says what failed, with a Try again', () => {
    const { unread } = unreadFacet();
    component = mount(FacetSheetUnread, {
      target: document.body,
      props: { unread },
    });
    flushSync();
    expect(words()).toBe('Couldn’t load the things.');
    expect(retryButton()?.textContent?.trim()).toBe(m.common_try_again());
  });

  test('says it is trying, once at a time, then that it failed again', async () => {
    const { unread, reads } = unreadFacet();
    component = mount(FacetSheetUnread, {
      target: document.body,
      props: { unread },
    });
    flushSync();

    retryButton()?.click();
    retryButton()?.click();
    flushSync();
    expect(reads).toHaveLength(1);
    expect(words()).toBe(m.studio_list_facet_retrying());
    expect(retryButton()?.getAttribute('aria-busy')).toBe('true');

    reads[0]?.fail(new Error('still down'));
    await settle();
    expect(words()).toBe('Still couldn’t load the things.');
    expect(retryButton()?.getAttribute('aria-busy')).toBe('false');
  });
});
