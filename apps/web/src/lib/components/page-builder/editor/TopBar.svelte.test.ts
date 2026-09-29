import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import { primaryAction, statusChip } from './editor-state';
import TopBar from './TopBar.svelte';

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
});

function render(state: {
  status: 'draft' | 'published';
  hasUnpublishedChanges?: boolean;
  busy?: 'publishing' | 'unpublishing' | null;
  save?: 'hidden' | 'saving' | 'saved' | 'error';
}) {
  const busy = state.busy ?? null;
  const props = {
    title: 'Bone Deep',
    chip: statusChip(state.status, state.hasUnpublishedChanges ?? false),
    device: 'desktop' as const,
    canUndo: true,
    canRedo: false,
    save: state.save ?? 'hidden',
    saveError: 'The slug is already in use',
    primary: primaryAction({
      status: state.status,
      hasUnpublishedChanges: state.hasUnpublishedChanges ?? false,
      busy,
      ready: true,
    }),
    busy,
    canUnpublish: state.status === 'published',
    onTitle: vi.fn(),
    onDevice: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onRetry: vi.fn(),
    onPreview: vi.fn(),
    onPrimary: vi.fn(),
    onUnpublish: vi.fn(),
  };
  app = mount(TopBar, { target: document.body, props });
  flushSync();
  const buttons = [
    ...document.querySelectorAll<HTMLButtonElement>('.topbar__button'),
  ];
  return { props, primary: buttons[buttons.length - 1] };
}

describe('TopBar', () => {
  it('a draft: Publish, and no Unpublish anywhere', () => {
    const { primary } = render({ status: 'draft' });
    expect(primary.textContent?.trim()).toBe('Publish');
    expect(primary.disabled).toBe(false);
    expect(document.querySelector('.topbar__chip')?.textContent).toContain(
      'Draft'
    );
    expect(document.querySelector('.topbar__more')).toBeNull();
  });

  it('a live page with edits: Publish changes, and Unpublish in the menu', () => {
    const { primary } = render({
      status: 'published',
      hasUnpublishedChanges: true,
    });
    expect(primary.textContent?.trim()).toBe('Publish changes');
    expect(document.querySelector('.topbar__chip')?.textContent).toContain(
      'Live — unpublished changes'
    );
    expect(document.querySelector('.topbar__more')).not.toBeNull();
  });

  it('a live page with nothing to send: a disabled Published', () => {
    const { primary } = render({ status: 'published' });
    expect(primary.textContent?.trim()).toBe('Published');
    expect(primary.disabled).toBe(true);
  });

  it('says Publishing… and waits while it publishes', () => {
    const { primary } = render({ status: 'draft', busy: 'publishing' });
    expect(primary.textContent?.trim()).toBe('Publishing…');
    expect(primary.disabled).toBe(true);
  });

  it('reports the save: Saving…, Saved, and a failure with Retry', () => {
    render({ status: 'draft', save: 'saving' });
    expect(document.querySelector('.topbar__save')?.textContent?.trim()).toBe(
      'Saving…'
    );
    unmount(app);
    render({ status: 'draft', save: 'saved' });
    expect(document.querySelector('.topbar__save')?.textContent?.trim()).toBe(
      'Saved'
    );
    unmount(app);
    const { props } = render({ status: 'draft', save: 'error' });
    const failure = document.querySelector('.topbar__save');
    expect(failure?.textContent).toContain('Couldn’t save');
    expect(failure?.querySelector('[title]')?.getAttribute('title')).toBe(
      'The slug is already in use'
    );
    failure?.querySelector<HTMLButtonElement>('.topbar__retry')?.click();
    expect(props.onRetry).toHaveBeenCalled();
  });

  it('never saves a blank title', () => {
    const { props } = render({ status: 'draft' });
    const input = document.querySelector<HTMLInputElement>('.topbar__title');
    if (!input) throw new Error('title input');
    input.value = '   ';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(props.onTitle).not.toHaveBeenCalled();
    input.value = 'Bone Deep, again';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(props.onTitle).toHaveBeenCalledWith('Bone Deep, again');
  });
});
