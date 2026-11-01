/**
 * The Delete Media dialog as drawn (Codex-6sbn1): the Delete button follows
 * the flow (off while checking, off on a failed check, off while blocked), and
 * each state says what the approved mockups say.
 */
import type { MediaUsage, MediaUse } from '@codex/shared-types';
import { afterEach, describe, expect, test } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import MediaDeleteDialog from './MediaDeleteDialog.svelte';
import { MediaDeleteFlow } from './media-delete-flow.svelte';

const target = {
  id: '6b000000-0000-4000-8000-000000000001',
  title: 'The Long Field (final cut)',
  mediaType: 'video',
  durationSeconds: 1450,
  fileSizeBytes: 1_800_000_000,
};

const published: MediaUse = {
  kind: 'film',
  slot: 'media',
  live: true,
  liveReason: 'published',
  title: 'The Long Field',
  orgName: 'Hollow Oak Films',
  link: { to: 'content', contentId: 'c1', orgSlug: 'hollow-oak' },
};
const draft: MediaUse = {
  ...published,
  live: false,
  liveReason: null,
  title: 'Extended',
};

function usage(uses: MediaUse[]): MediaUsage {
  const live = uses.filter((u) => u.live).length;
  return {
    total: uses.length,
    live,
    drafts: uses.length - live,
    hidden: 0,
    uses,
    fingerprint: 'fp',
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

let component: ReturnType<typeof mount> | null = null;

function render(
  readUsage: () => Promise<MediaUsage>,
  remove: () => Promise<unknown> = async () => undefined,
  focusAfterDelete?: () => HTMLElement | null
) {
  const flow = new MediaDeleteFlow({ readUsage, remove });
  component = mount(MediaDeleteDialog, {
    target: document.body,
    props: { flow, onConfirm: () => void flow.confirm(), focusAfterDelete },
  });
  flow.open(target);
  flushSync();
  return flow;
}

function deleteButton(): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === 'Delete'
  );
}

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

describe('MediaDeleteDialog', () => {
  test('F1: checking, Delete is off', () => {
    render(() => new Promise(() => {}));
    expect(document.body.textContent).toContain('Checking where it’s used…');
    expect(deleteButton()?.disabled).toBe(true);
  });

  test('F2: a failed check says so, with Try again, and Delete is off', async () => {
    render(async () => {
      throw { status: 500, body: { message: 'x' } };
    });
    await tick();
    flushSync();
    expect(document.body.textContent).toContain(
      'We couldn’t check where this is used, so it can’t be deleted yet.'
    );
    expect(document.body.textContent).toContain('Try again');
    expect(document.body.textContent).not.toContain('isn’t used anywhere');
    expect(deleteButton()?.disabled).toBe(true);
  });

  test('B1: blocked lists the uses, drafts with Replace, and says why Delete is off', async () => {
    render(async () => usage([published, draft]));
    await tick();
    flushSync();
    const text = document.body.textContent ?? '';
    expect(text).toContain('This can’t be deleted yet.');
    expect(text).toContain('It’s used by a published film.');
    expect(text).toContain('Delete turns on when nothing published uses it.');
    const actions = [...document.querySelectorAll('.use__action')].map((a) =>
      a.textContent?.trim()
    );
    expect(actions).toEqual([
      expect.stringContaining('Replace'),
      expect.stringContaining('Replace'),
    ]);
    expect(deleteButton()?.disabled).toBe(true);
    // The disabled Delete is described by its reason.
    const describedBy = deleteButton()?.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)?.textContent).toBe(
      'Delete turns on when nothing published uses it.'
    );
  });

  test('W1: drafts only, the warning and the 30-day line, and Delete is on', async () => {
    render(async () => usage([draft]));
    await tick();
    flushSync();
    const text = document.body.textContent ?? '';
    expect(text).toContain('It’s used by 1 draft.');
    expect(text).toContain(
      'If you delete it by mistake, contact support within 30 days and we can bring it back.'
    );
    expect(deleteButton()?.disabled).toBe(false);
  });

  test('U1: unused, and Delete is on', async () => {
    render(async () => usage([]));
    await tick();
    flushSync();
    expect(document.body.textContent).toContain('It isn’t used anywhere.');
    expect(deleteButton()?.disabled).toBe(false);
  });

  test('R1: refused because it became published, the refusal names it and Delete stays off', async () => {
    let calls = 0;
    const flow = render(
      async () =>
        ++calls === 1
          ? usage([draft])
          : usage([{ ...draft, live: true, liveReason: 'published' }]),
      async () => {
        throw { status: 409, body: { code: 'MEDIA_IN_USE', message: 'x' } };
      }
    );
    await tick();
    await flow.confirm();
    flushSync();
    const text = document.body.textContent ?? '';
    expect(text).toContain('It wasn’t deleted.');
    expect(text).toContain('Since you opened this, “Extended” was published');
    // The refusal says why; the blocked line would say it twice.
    expect(text).not.toContain('This can’t be deleted yet.');
    expect(deleteButton()?.disabled).toBe(true);
  });

  test('after a delete, focus goes where the page says, not to the departing tile', async () => {
    const opener = document.createElement('button');
    const library = document.createElement('div');
    library.tabIndex = -1;
    document.body.appendChild(opener);
    document.body.appendChild(library);
    opener.focus();

    const flow = render(
      async () => usage([]),
      async () => undefined,
      () => library
    );
    await tick();
    flushSync();
    await flow.confirm();
    flow.close();
    flushSync();
    await tick();
    await tick();
    expect(document.activeElement).toBe(library);
  });
});
