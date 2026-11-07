/**
 * ContentRow, a draft against a live piece (Codex-a6ofh.2.6, mockup W7): a
 * draft shows how far it has got and Continue, at the step still to do; a
 * live piece keeps its toggle and Edit. A draft goes live on the Publish
 * step, with its checks, never from the list.
 */
import { afterEach, describe, expect, test } from 'vitest';
import type { ContentWithRelations } from '$lib/types';
import type { PayoutsRead } from '$lib/utils/connect-readiness';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import { draftRow, LIVE, PAID, withMedia } from '../../__fixtures__/draft-row';
import ContentRow from '../ContentRow.svelte';

const text = (selector: string) =>
  document.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() ??
  null;

describe('ContentRow', () => {
  let component: ReturnType<typeof mount> | null = null;

  function render(item: ContentWithRelations, payouts: PayoutsRead = 'ready') {
    component = mount(ContentRow, {
      target: document.body,
      props: { ordinal: '02', item, payouts, onPublishToggle: () => {} },
    });
    flushSync();
  }

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('a draft still being written says so, and Continue opens Write', () => {
    render(draftRow());

    expect(text('.draft-progress')).toContain('Step 1 of 2');
    expect(text('.draft-progress')).toContain('Add the video.');
    const cont = document.querySelector('a.row-edit');
    expect(cont?.getAttribute('href')).toBe('/studio/content/c1/edit');
    expect(cont?.getAttribute('aria-label')).toBe(
      'Continue Svelte runes deep dive'
    );
    // No way to publish from the list: that is the Publish step's.
    expect(document.querySelector('button')).toBeNull();
  });

  test('a draft with nothing left is ready, and Continue opens Publish', () => {
    render(draftRow(withMedia('ready')));

    expect(text('.draft-progress')).toContain('Ready to publish');
    expect(document.querySelector('a.row-edit')?.getAttribute('href')).toBe(
      '/studio/content/c1/edit?step=publish'
    );
  });

  test('payouts never read are never taken for set up', () => {
    render(draftRow({ ...withMedia('ready'), ...PAID }), 'unread');

    expect(text('.draft-progress')).not.toContain('Ready to publish');
    expect(text('.draft-progress')).toContain(
      'Couldn’t check your payout setup'
    );
  });

  test('a live piece keeps its toggle and Edit, with no progress', () => {
    render(draftRow({ ...withMedia('ready'), ...LIVE }));

    expect(document.querySelector('.draft-progress')).toBeNull();
    expect(document.querySelector('button')).not.toBeNull();
    expect(document.querySelector('a.row-edit')?.getAttribute('href')).toBe(
      '/studio/content/c1/edit'
    );
  });
});
