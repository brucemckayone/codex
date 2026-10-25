import { afterEach, describe, expect, test, vi } from 'vitest';
import type { JourneyPractice } from '$lib/journeys/types';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import PracticeWorkingPane from './PracticeWorkingPane.svelte';

/**
 * The written body of an in-course practice (Codex-woj7k review).
 *
 * A body that failed to render used to read as "This reflection has no
 * written guidance yet.", with Mark complete offered for text the learner
 * never saw. `bodyUnavailable` (set by fetchInCoursePractice when stored text
 * rendered to nothing) says the text did not load, and withholds Mark
 * complete. A practice with no text at all keeps its own copy.
 */

vi.mock('$lib/collections', () => ({ markPracticeComplete: vi.fn() }));
vi.mock('$lib/components/VideoPlayer/hls', () => ({
  loadHls: vi.fn(),
  isHlsSupported: vi.fn(() => false),
}));

const writtenPractice = {
  contentId: 'content-1',
  slug: 'field-notes',
  title: 'Field notes',
  contentType: 'written',
  durationSeconds: null,
  thumbnailUrl: null,
  sortOrder: 0,
} as JourneyPractice;

function paneProps(overrides: Record<string, unknown> = {}) {
  return {
    practice: writtenPractice,
    courseTitle: 'Rootwork',
    stageName: 'Ground',
    stageGloss: null,
    dashboardHref: '/journeys/rootwork/dashboard',
    streamingUrl: null,
    waveformUrl: null,
    bodyHtml: null,
    initialProgressSeconds: 0,
    isComplete: false,
    playbackPercent: 0,
    prevHref: null,
    prevTitle: null,
    nextHref: '/journeys/rootwork/practice/next',
    nextLabel: 'Next practice',
    ...overrides,
  };
}

const markComplete = () =>
  [...document.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('Mark complete')
  );

describe('PracticeWorkingPane written body', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('text that did not load says so, and offers no Mark complete', () => {
    component = mount(PracticeWorkingPane, {
      target: document.body,
      props: paneProps({ bodyUnavailable: true }),
    });
    flushSync();

    const alert = document.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("didn't load");
    expect(document.body.textContent).not.toContain('no written guidance');
    expect(markComplete()).toBeUndefined();
  });

  test('a practice with no text keeps its own copy, and Mark complete', () => {
    component = mount(PracticeWorkingPane, {
      target: document.body,
      props: paneProps(),
    });
    flushSync();

    expect(document.body.textContent).toContain('no written guidance yet');
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(markComplete()).toBeDefined();
  });

  test('a rendered body shows, with Mark complete', () => {
    component = mount(PracticeWorkingPane, {
      target: document.body,
      props: paneProps({ bodyHtml: '<p>Set your intention.</p>' }),
    });
    flushSync();

    expect(document.querySelector('.pane__body')?.innerHTML).toContain(
      'Set your intention.'
    );
    expect(markComplete()).toBeDefined();
  });
});
