/**
 * The personal studio's preview route (Codex-a6ofh.2.11) is the shared
 * ContentPreview for the piece in its address, titled as a visitor's tab
 * would be, with the creator's name.
 */
import { afterEach, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

vi.mock('$app/state', () => ({ page: { params: { contentId: 'c1' } } }));
vi.mock('$lib/components/studio/editor/ContentPreview.svelte', async () => ({
  default: (await import('./PreviewStub.svelte')).default,
}));

const Page = (await import('../+page.svelte')).default;
let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

test('previews the piece in its address, under the creator’s name', () => {
  component = mount(Page, {
    target: document.body,
    props: {
      data: {
        creator: { id: 'u1', name: 'Alex Creator', username: 'alex' },
        studioUser: { name: 'Alex' },
      },
    } as never,
  });
  flushSync();

  const probe = document.querySelector<HTMLElement>('[data-probe="preview"]');
  expect(probe?.dataset).toMatchObject({
    id: 'c1',
    suffix: 'Alex Creator',
    author: 'Alex Creator',
  });
});
