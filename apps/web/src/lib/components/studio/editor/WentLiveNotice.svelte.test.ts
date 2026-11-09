/**
 * The notice a draft's editor shows once its piece went live under it
 * (Codex-a6ofh.2, owner 2026-11-09): said once, as an alert mounted before
 * its words come, and its button opens the piece to update.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import type { DraftSession } from './draft-session.svelte';
import WentLiveNotice from './WentLiveNotice.svelte';

const state = $state({ wentLiveElsewhere: false });
const openLive = vi.fn();

const session = {
  get wentLiveElsewhere() {
    return state.wentLiveElsewhere;
  },
  savedTitle: 'Runes deep dive',
  openLive,
} as unknown as DraftSession;

let component: ReturnType<typeof mount> | null = null;

function render() {
  component = mount(WentLiveNotice, {
    target: document.body,
    props: { session },
  });
  flushSync();
}

const alertEl = () => document.querySelector('[role="alert"]');
const openButton = () =>
  [...document.querySelectorAll('button')].find((b) =>
    b.textContent?.includes(m.studio_editor_open_live())
  );

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
  state.wentLiveElsewhere = false;
  openLive.mockReset();
});

describe('WentLiveNotice', () => {
  test('mounted, empty, before anything went live: its words are heard when they come', () => {
    render();

    expect(alertEl()).not.toBeNull();
    expect(alertEl()?.textContent?.trim()).toBe('');
    expect(openButton()).toBeUndefined();
  });

  test('says it went live, by its live title, in the alert already there', () => {
    render();
    const before = alertEl();

    state.wentLiveElsewhere = true;
    flushSync();

    expect(alertEl()).toBe(before);
    expect(alertEl()?.textContent).toContain(
      m.studio_editor_went_live_elsewhere({ title: 'Runes deep dive' })
    );
  });

  test('Open it to update opens it, once while it is going', async () => {
    const opening = Promise.withResolvers<void>();
    openLive.mockReturnValue(opening.promise);
    state.wentLiveElsewhere = true;
    render();

    openButton()?.click();
    openButton()?.click();
    flushSync();

    expect(openLive).toHaveBeenCalledTimes(1);
    expect(openButton()?.getAttribute('aria-busy')).toBe('true');
    opening.resolve();
    await opening.promise;
    await Promise.resolve();
    flushSync();
    expect(openButton()?.getAttribute('aria-busy')).not.toBe('true');
  });
});
