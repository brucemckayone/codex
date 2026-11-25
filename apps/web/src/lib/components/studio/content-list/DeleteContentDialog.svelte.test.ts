/**
 * The delete dialog's width (owner, 2026-11-22, VISUAL-VERIFY V1).
 *
 * At `sm` (28rem) the row Cancel, Unpublish instead, Delete in 30 days did
 * not fit, and the footer clipped Cancel to "ncel". The dialog widens only
 * for that row, as mockup LN1 draws it; any other row keeps `sm`. jsdom lays
 * nothing out, so this pins the width the panel is given, beside the
 * actions that need it; the shot in Chromium is the proof that it fits.
 */
import { afterEach, describe, expect, test } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import DeleteContentDialog from './DeleteContentDialog.svelte';
import type { DeletePiece } from './delete-words';

/** A live piece three people bought: unpublishing keeps it for them. */
const bought: DeletePiece = {
  id: 'c1',
  title: 'CSS Variables Masterclass',
  slug: 'css-variables-masterclass',
  status: 'published',
  holderCount: 3,
  courseOnly: false,
  isTeamOnly: false,
  isFollowerGated: false,
  isTierGated: false,
  priceCents: 499,
  ownersCanDownload: true,
};

describe('DeleteContentDialog width', () => {
  let component: ReturnType<typeof mount> | undefined;

  afterEach(() => {
    if (component) unmount(component);
    component = undefined;
    document.body.innerHTML = '';
  });

  function open(piece: DeletePiece) {
    component = mount(DeleteContentDialog, {
      target: document.body,
      props: {
        target: { mode: 'one', piece },
        busy: false,
        onDelete: () => {},
        onUnpublish: () => {},
        onClose: () => {},
      },
    });
    flushSync();
    return {
      panel: document.querySelector<HTMLElement>('.dialog-content'),
      actions: [...document.querySelectorAll('.dialog-footer button')].map(
        (b) => b.textContent?.trim()
      ),
    };
  }

  test('three actions: the panel is wide enough for them in one row', () => {
    const { panel, actions } = open(bought);

    expect(actions).toEqual([
      'Cancel',
      'Unpublish instead',
      'Delete in 30 days',
    ]);
    expect(panel?.style.maxWidth).toBe('34rem');
  });

  test('two actions: the panel keeps its sm width', () => {
    // Followers lose it when it is unpublished, so Unpublish instead is not offered.
    const { panel, actions } = open({
      ...bought,
      isFollowerGated: true,
      priceCents: null,
    });

    expect(actions).toEqual(['Cancel', 'Delete in 30 days']);
    expect(panel?.style.maxWidth).toBe('');
  });
});
