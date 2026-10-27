/**
 * ConfirmDialog — the two opt-ins added for the Remove dialog
 * (Codex-2hxff.64), and the default every existing caller relies on.
 *
 * Existing callers (ContentForm, studio categories, studio journeys, the
 * stories) pass async `onConfirm` handlers and expect the dialog to close the
 * moment Confirm is pressed. That must stay true unless a caller opts in with
 * `awaitConfirm`.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import ConfirmDialog from './ConfirmDialog.svelte';

let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

function open(props: Record<string, unknown>) {
  component = mount(ConfirmDialog, {
    target: document.body,
    props: {
      open: true,
      title: 'Delete topic?',
      confirmText: 'Delete',
      ...props,
    },
  });
  flushSync();
}

function button(label: string): HTMLButtonElement | undefined {
  return [
    ...document.querySelectorAll<HTMLButtonElement>('.dialog-content button'),
  ].find((b) => b.textContent?.trim() === label);
}

const isOpen = () => document.querySelector('.dialog-content') !== null;

describe('default (no opt-in)', () => {
  test('closes at once, without waiting for an async onConfirm', async () => {
    const onConfirm = vi.fn(() => new Promise<void>(() => {}));
    open({ onConfirm });

    button('Delete')?.click();
    flushSync();

    expect(onConfirm).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(isOpen()).toBe(false));
  });

  test('both buttons start enabled', () => {
    open({});
    expect(button('Delete')?.disabled).toBe(false);
    expect(button('Cancel')?.disabled).toBe(false);
  });
});

describe('confirmDisabled', () => {
  test('disables Confirm only', () => {
    open({ confirmDisabled: true });
    expect(button('Delete')?.disabled).toBe(true);
    expect(button('Cancel')?.disabled).toBe(false);
  });
});

describe('awaitConfirm', () => {
  test('stays open and busy until onConfirm fulfils, then closes', async () => {
    let finish!: () => void;
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    open({ onConfirm, awaitConfirm: true });

    button('Delete')?.click();
    flushSync();

    expect(isOpen()).toBe(true);
    expect(button('Delete')?.getAttribute('aria-busy')).toBe('true');
    expect(button('Delete')?.disabled).toBe(true);
    expect(button('Cancel')?.disabled).toBe(true);

    finish();
    await vi.waitFor(() => expect(isOpen()).toBe(false));
  });

  test('a synchronous onConfirm still closes at once', async () => {
    open({ onConfirm: vi.fn(), awaitConfirm: true });

    button('Delete')?.click();
    flushSync();

    await vi.waitFor(() => expect(isOpen()).toBe(false));
  });
});
