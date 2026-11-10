/**
 * ContentTable, the personal studio's list (Codex-a6ofh.2.6): a draft shows
 * how far it has got and Continue, at the step still to do; a live piece
 * keeps its toggle and Edit.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { ContentWithRelations } from '$lib/types';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import { draftRow, LIVE, withMedia } from './__fixtures__/draft-row';
import ContentTable from './ContentTable.svelte';

// The real toggle calls a remote command, which imports `$app/server`.
vi.mock('./publish-toggle', () => ({ togglePublishStatus: vi.fn() }));

/** The personal studio's rows: no org, media ready. */
const row = (id: string, fields: Partial<ContentWithRelations> = {}) =>
  draftRow({
    id,
    title: `Piece ${id}`,
    organizationId: null,
    ...withMedia('ready'),
    ...fields,
  });

const cells = (id: string) => {
  const title = [...document.querySelectorAll('.title-link')].find(
    (link) => link.textContent?.trim() === `Piece ${id}`
  );
  return title?.closest('tr') ?? null;
};

describe('ContentTable', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('a draft shows its progress and Continue; a live piece its toggle and Edit', () => {
    component = mount(ContentTable, {
      target: document.body,
      props: {
        payouts: 'ready',
        items: [row('d1'), row('p1', LIVE)],
      },
    });
    flushSync();

    const draft = cells('d1');
    expect(draft?.querySelector('.draft-progress')?.textContent).toContain(
      'Ready to publish'
    );
    expect(draft?.querySelector('.title-link')?.getAttribute('href')).toBe(
      '/studio/content/d1/edit?step=publish'
    );
    const cont = draft?.querySelector('.cell-actions a');
    expect(cont?.textContent?.trim()).toBe('Continue');
    expect(cont?.getAttribute('href')).toBe(
      '/studio/content/d1/edit?step=publish'
    );
    expect(draft?.querySelector('button')).toBeNull();

    const live = cells('p1');
    expect(live?.querySelector('.draft-progress')).toBeNull();
    expect(
      live?.querySelector('button[data-action="unpublish"]')
    ).not.toBeNull();
    expect(live?.querySelector('.action-edit')?.getAttribute('href')).toBe(
      '/studio/content/p1/edit'
    );
  });
});
