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
import type { ReadProblem } from './read-problem';
import WentLiveNotice from './WentLiveNotice.svelte';

const state = $state<{
  wentLiveElsewhere: boolean;
  openLiveProblem: ReadProblem | null;
}>({ wentLiveElsewhere: false, openLiveProblem: null });
const openLive = vi.fn();

const session = {
  get wentLiveElsewhere() {
    return state.wentLiveElsewhere;
  },
  get openLiveProblem() {
    return state.openLiveProblem;
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
  state.openLiveProblem = null;
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

  // Each by why: a try again can help an outage only (the round-3 review).
  test.each([
    ['outage', () => m.studio_editor_open_live_failed()],
    ['signed-out', () => m.studio_content_draft_signed_out()],
    ['gone', () => m.studio_editor_not_found()],
  ] as const)('a press that could not open it (%s) says why, in the same alert', (problem, words) => {
    state.wentLiveElsewhere = true;
    render();
    const before = alertEl();
    expect(alertEl()?.textContent).not.toContain(words());

    state.openLiveProblem = problem;
    flushSync();

    expect(alertEl()).toBe(before);
    expect(alertEl()?.textContent).toContain(words());
  });

  /** The text of every element the button names as its description. */
  const description = (button: HTMLElement | undefined) =>
    (button?.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent ?? '');

  // Focus moves to Open as the alert's words come, and a reader that cuts
  // speech on a focus move would say only the button: its description
  // carries the words (the round-3 review).
  test("Open's description carries why it is here, and why it failed", () => {
    state.wentLiveElsewhere = true;
    render();
    expect(description(openButton())).toEqual([
      m.studio_editor_went_live_elsewhere({ title: 'Runes deep dive' }),
    ]);

    state.openLiveProblem = 'gone';
    flushSync();
    expect(description(openButton())).toEqual([
      m.studio_editor_went_live_elsewhere({ title: 'Runes deep dive' }),
      m.studio_editor_not_found(),
    ]);
  });

  // In the freeze nothing else says why Open waits: it is said where it is
  // seen, not to a screen reader only (the round-3 review).
  test('something still on its way holds Open, and says why where it is seen', () => {
    state.wentLiveElsewhere = true;
    render({ waitFor: m.studio_editor_next_needs_cover() });

    const button = openButton();
    expect(button?.disabled).toBe(true);
    expect(description(button)).toContain(m.studio_editor_next_needs_cover());
    const hint = [...document.querySelectorAll('p')].find(
      (p) => p.textContent === m.studio_editor_next_needs_cover()
    );
    expect(hint).toBeDefined();
    expect(hint?.closest('.sr-only')).toBeNull();
    expect(hint?.classList.contains('sr-only')).toBe(false);
    button?.click();
    expect(openLive).not.toHaveBeenCalled();
  });

  // The button went busy, which drops focus: a press that did not open it
  // hands focus back, for the next try (the round-3 review).
  test('a press that could not open it hands focus back to Open', async () => {
    state.wentLiveElsewhere = true;
    openLive.mockImplementation(async () => {
      (document.activeElement as HTMLElement | null)?.blur();
      state.openLiveProblem = 'outage';
    });
    render();
    // The notice's own focus on arriving settles first: it is not the one
    // this test is about.
    await tick();
    await tick();
    openButton()?.focus();

    openButton()?.click();
    await vi.waitFor(() => expect(openLive).toHaveBeenCalled());
    await tick();
    await tick();
    await tick();

    expect(document.activeElement).toBe(openButton());
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
