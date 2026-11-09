/**
 * The editor bar's "Preview as a visitor" (Codex-a6ofh.2.11, mockup w4): on
 * both steps once the draft exists, a plain link to the preview, so leaving
 * goes through the session's guard, which saves first.
 */
import { afterEach, describe, expect, test } from 'vitest';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import type { DraftSession } from './draft-session.svelte';
import WriteBar from './WriteBar.svelte';

/** Only what the bar reads of a session. */
function session(
  contentId: string | null,
  extra: Partial<Record<keyof DraftSession, unknown>> = {}
): DraftSession {
  return {
    contentId,
    status: 'idle',
    needsTitle: false,
    lastSavedAt: null,
    errorMessage: null,
    wentLiveElsewhere: false,
    retry: () => {},
    ...extra,
  } as unknown as DraftSession;
}

let component: ReturnType<typeof mount> | null = null;

function render(
  props: Partial<Parameters<typeof WriteBar>[1]> & {
    contentId?: string | null;
    sessionExtra?: Partial<Record<keyof DraftSession, unknown>>;
  } = {}
) {
  const { contentId = 'c1', sessionExtra, ...rest } = props;
  component = mount(WriteBar, {
    target: document.body,
    props: {
      session: session(contentId, sessionExtra),
      contentType: 'video',
      backHref: '/studio/content',
      ...rest,
    },
  });
  flushSync();
}

const previewLink = () =>
  [...document.querySelectorAll('a')].find((a) =>
    a.textContent?.includes('Preview as a visitor')
  ) ?? null;

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

describe('Preview as a visitor', () => {
  test('on Write, beside Next: a link to the preview', () => {
    render({ previewHref: '/studio/content/c1/preview', onnext: () => {} });

    expect(previewLink()?.getAttribute('href')).toBe(
      '/studio/content/c1/preview'
    );
    expect(
      document.querySelector('.write-bar')?.hasAttribute('data-preview')
    ).toBe(true);
    expect(document.querySelector('.write-next')).not.toBeNull();
  });

  test('on Publish too, where there is no Next', () => {
    render({
      step: 'publish',
      previewHref: '/studio/content/c1/preview?step=publish',
    });

    expect(previewLink()?.getAttribute('href')).toBe(
      '/studio/content/c1/preview?step=publish'
    );
    expect(document.querySelector('.write-next')).toBeNull();
  });

  test('not before the draft exists: there is nothing saved to show', () => {
    render({ contentId: null, previewHref: null, onnext: () => {} });

    expect(previewLink()).toBeNull();
    expect(
      document.querySelector('.write-bar')?.hasAttribute('data-preview')
    ).toBe(false);
  });
});

// Codex-a6ofh.2: the piece went live under this editor. The notice below the
// bar says so, once, and has the way on; the bar only says it is live.
describe('it went live by another way', () => {
  test('the pill says Live; no error, and no Try again that would send', () => {
    render({
      sessionExtra: {
        wentLiveElsewhere: true,
        status: 'error',
        errorMessage: 'It went live.',
      },
    });

    expect(document.querySelector('.write-state')?.textContent).toContain(
      m.studio_live_badge()
    );
    expect(document.querySelector('.write-error')).toBeNull();
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(
      [...document.querySelectorAll('button')].some((b) =>
        b.textContent?.includes(m.common_try_again())
      )
    ).toBe(false);
  });

  test('calibration: a draft whose save failed still says so, with Try again', () => {
    render({ sessionExtra: { status: 'error', errorMessage: 'Not saved.' } });

    expect(document.querySelector('.write-error')?.textContent).toBe(
      'Not saved.'
    );
    expect(
      [...document.querySelectorAll('button')].some((b) =>
        b.textContent?.includes(m.common_try_again())
      )
    ).toBe(true);
  });
});
