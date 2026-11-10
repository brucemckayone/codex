/**
 * ContentStatusTabs (Codex-a6ofh.2.6): both lists' status filter. The page
 * owns the address; the filter says which is shown and which was chosen.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import ContentStatusTabs from '../ContentStatusTabs.svelte';

describe('ContentStatusTabs', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('presses the status shown, and only it', () => {
    component = mount(ContentStatusTabs, {
      target: document.body,
      props: { selected: 'draft', onChange: () => {} },
    });
    flushSync();

    const pressed = [
      ...document.querySelectorAll('button[aria-pressed="true"]'),
    ];
    expect(pressed.map((button) => button.textContent?.trim())).toEqual([
      'Drafts',
    ]);
    expect(
      document.querySelectorAll('button[aria-pressed="false"]')
    ).toHaveLength(3);
    expect(
      document.querySelector('[role="group"]')?.getAttribute('aria-label')
    ).toBe('Filter by status');
  });

  test('says which was chosen', () => {
    const onChange = vi.fn();
    component = mount(ContentStatusTabs, {
      target: document.body,
      props: { selected: 'all', onChange },
    });
    flushSync();

    document.querySelector<HTMLElement>('[data-status="published"]')?.click();

    expect(onChange).toHaveBeenCalledWith('published');
  });
});
