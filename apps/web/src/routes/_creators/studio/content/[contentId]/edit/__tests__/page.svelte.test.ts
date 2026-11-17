/**
 * The personal studio's edit page opens the shared editor for the types it
 * knows, and says plainly that any other cannot be opened, logging it
 * (Codex-a6ofh.2.10: the old form that took them is gone).
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

vi.mock('$app/state', () => ({
  page: { url: new URL('https://creators.test/studio/content/c1/edit') },
}));
vi.mock('$lib/components/studio/editor/ContentEditor.svelte', async () => ({
  default: (await import('./EditorStub.svelte')).default,
}));
const told = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn() }));
vi.mock('$lib/observability', () => ({
  logger: { warn: told.warn, error: told.error },
}));

const EditPage = (await import('../+page.svelte')).default;

let component: ReturnType<typeof mount> | null = null;
function render(contentType: string) {
  component = mount(EditPage, {
    target: document.body,
    props: {
      data: {
        content: {
          id: 'c1',
          title: 'A piece',
          contentType,
          status: 'draft',
          publishedAt: null,
          creator: null,
        },
        organizationId: null,
        orgSlug: null,
        creator: { username: 'alex', name: 'Alex Creator' },
        studioUser: { name: 'Alex Creator' },
      },
    } as never,
  });
  flushSync();
}

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('the personal edit page', () => {
  test('a type the editor knows opens it, at the address’s step', () => {
    render('audio');
    expect(document.querySelector('[data-probe="editor"]')?.textContent).toBe(
      'audio:write'
    );
    expect(document.querySelector('.unknown-type')).toBeNull();
    expect(told.error).not.toHaveBeenCalled();
  });

  test('a type it does not know says it cannot be opened, and logs the type', () => {
    render('podcast');
    expect(document.querySelector('[data-probe="editor"]')).toBeNull();
    expect(
      document.querySelector('.unknown-type[role="alert"]')?.textContent
    ).toBe('This piece can’t be opened in the editor.');
    expect(told.error).toHaveBeenCalledWith(
      'studio_content_edit.unknown_type',
      {
        contentId: 'c1',
        contentType: 'podcast',
      }
    );
  });
});
