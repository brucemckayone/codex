/**
 * The notice a draft's editor shows once its piece went live under it
 * (Codex-a6ofh.2, owner 2026-11-09): said once, as an alert mounted before
 * its words come, and its button opens the piece to update.
 */
import { tick } from 'svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import type { DraftSession } from './draft-session.svelte';
import WentLiveNotice from './WentLiveNotice.svelte';

const state = $state({ wentLiveElsewhere: false, openLiveFailed: false });
const openLive = vi.fn();

const session = {
  get wentLiveElsewhere() {
    return state.wentLiveElsewhere;
  },
  get openLiveFailed() {
    return state.openLiveFailed;
  },
  savedTitle: 'Runes deep dive',
  openLive,
} as unknown as DraftSession;

let component: ReturnType<typeof mount> | null = null;

function render(props: { waitFor?: string | null } = {}) {
  component = mount(WentLiveNotice, {
    target: document.body,
    props: { session, ...props },
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
  state.openLiveFailed = false;
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

  test('a press that could not open it says so, in the same alert', () => {
    state.wentLiveElsewhere = true;
    render();
    const before = alertEl();
    expect(alertEl()?.textContent).not.toContain(
      m.studio_editor_open_live_failed()
    );

    state.openLiveFailed = true;
    flushSync();

    expect(alertEl()).toBe(before);
    expect(alertEl()?.textContent).toContain(
      m.studio_editor_open_live_failed()
    );
  });

  test('something still on its way holds Open, and says why', () => {
    state.wentLiveElsewhere = true;
    render({ waitFor: m.studio_editor_next_needs_cover() });

    const button = openButton();
    expect(button?.disabled).toBe(true);
    const hintId = button?.getAttribute('aria-describedby');
    expect(hintId).toBeTruthy();
    expect(document.getElementById(hintId ?? '')?.textContent).toBe(
      m.studio_editor_next_needs_cover()
    );
    button?.click();
    expect(openLive).not.toHaveBeenCalled();
  });

  test('the step froze under the creator: focus that was in it comes to Open', async () => {
    const frozen = document.createElement('div');
    const field = document.createElement('textarea');
    frozen.appendChild(field);
    document.body.appendChild(frozen);
    render();
    field.focus();
    expect(document.activeElement).toBe(field);

    // As the step does: the canvas goes inert as the notice comes.
    frozen.inert = true;
    state.wentLiveElsewhere = true;
    flushSync();
    await tick();
    await tick();

    expect(document.activeElement).toBe(openButton());
  });

  test('focus somewhere still usable stays where it is', async () => {
    const elsewhere = document.createElement('button');
    document.body.appendChild(elsewhere);
    render();
    elsewhere.focus();

    state.wentLiveElsewhere = true;
    flushSync();
    await tick();
    await tick();

    expect(document.activeElement).toBe(elsewhere);
  });
});
