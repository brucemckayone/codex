/**
 * 02 Media says when a draft's media was deleted (Codex-6sbn1, mockup
 * draft-after M1). The draft keeps its link, so the picker reads empty; the
 * section says why, and names the deleted item.
 */
import type { ComponentProps } from 'svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import { createFakeRemoteForm } from '$tests/utils/fake-remote-form.svelte';

vi.mock('$lib/remote/library.remote', () => ({
  getStreamingUrl: vi.fn(() => ({
    current: undefined,
    error: undefined,
    loading: true,
  })),
}));

const MediaSection = (await import('./MediaSection.svelte')).default;
const DELETED_ID = '6b000000-0000-4000-8000-000000000001';

let component: ReturnType<typeof mount> | null = null;

type Props = ComponentProps<typeof MediaSection>;

function render(props: Pick<Props, 'deletedMedia'>) {
  // The fake stands in for kit's remote form: the fields MediaSection reads.
  const form = createFakeRemoteForm({
    initial: { mediaItemId: DELETED_ID },
  }) as unknown as Props['form'];
  component = mount(MediaSection, {
    target: document.body,
    props: { form, mediaItems: [], orgSlug: 'hollow-oak', ...props },
  });
  flushSync();
}

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

describe('MediaSection · media missing', () => {
  test('a deleted media item: the warning and the struck-through card', () => {
    render({
      deletedMedia: {
        title: 'Winter Light (rough cut)',
        deletedAt: '2026-10-30T09:00:00.000Z',
      },
    });
    const alert = document.querySelector('[role="status"]');
    expect(alert?.textContent).toContain('This draft’s media was deleted.');
    expect(alert?.textContent).toContain(
      'Choose another media item before you publish.'
    );
    expect(document.querySelector('.missing-card__title')?.textContent).toBe(
      'Winter Light (rough cut)'
    );
    // `toContain`: from next year the date carries its year.
    expect(
      document.querySelector('.missing-card__meta')?.textContent
    ).toContain('Deleted from your library on 30 October');
  });

  test('no deleted media: no warning', () => {
    render({ deletedMedia: null });
    expect(document.querySelector('.missing-card')).toBeNull();
    expect(document.body.textContent).not.toContain('was deleted');
  });
});
