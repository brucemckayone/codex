/**
 * The picker's hover preview against the real `.org-layout` (Codex-q01h8).
 *
 * The brand studio renders the picker before the editor opens, and the page
 * builder renders it over an organisation whose font the layout owns. A
 * picker with no font of its own "reverted" to nothing when its dropdown
 * closed, and stripped the organisation's font until a reload. Each preview
 * now puts back what it found. Nothing here owns the font, so a pick leaves
 * the organisation's: the owner (the editor's preview, the page) writes it.
 * Opened from the keyboard and closed by a second click: the test DOM
 * cannot drive Melt's pointerdown path, and its Escape does not reach Melt.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import FontPicker from './FontPicker.svelte';

const ORG_FONT = "'Lobster', 'Lobster-fallback'";

describe('the font picker leaves the organisation font as it found it', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  function mountOverOrg(onValueChange = vi.fn()) {
    const layout = document.createElement('div');
    layout.className = 'org-layout';
    layout.style.setProperty('--brand-font-body', ORG_FONT);
    document.body.appendChild(layout);
    component = mount(FontPicker, {
      target: layout,
      props: { mode: 'body', label: 'Body font', value: '', onValueChange },
    });
    flushSync();
    const trigger = layout.querySelector<HTMLElement>('[role="combobox"]');
    if (!trigger) throw new Error('FontPicker rendered no trigger');
    const font = () => layout.style.getPropertyValue('--brand-font-body');
    return { trigger, font };
  }

  function press(target: EventTarget, key: string): void {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    );
    flushSync();
  }

  function open(trigger: HTMLElement): void {
    press(trigger, 'ArrowDown');
    expect(trigger.getAttribute('aria-expanded'), 'opened').toBe('true');
  }

  function close(trigger: HTMLElement): void {
    trigger.click();
    flushSync();
    expect(trigger.getAttribute('aria-expanded'), 'closed').toBe('false');
  }

  function hoverFirstFont(): HTMLElement {
    const option = document.querySelector<HTMLElement>('[data-font-family]');
    if (!option) throw new Error('the open dropdown listed no font');
    option.dispatchEvent(new PointerEvent('pointerenter'));
    flushSync();
    return option;
  }

  test('opening and closing it, with no font of its own', () => {
    const { trigger, font } = mountOverOrg();

    open(trigger);
    close(trigger);

    expect(font()).toBe(ORG_FONT);
  });

  test('closing it after a hover preview', () => {
    const { trigger, font } = mountOverOrg();

    open(trigger);
    hoverFirstFont();
    expect(font(), 'previewing').not.toBe(ORG_FONT);
    close(trigger);

    expect(font()).toBe(ORG_FONT);
  });

  test('picking the font it previews', () => {
    const onValueChange = vi.fn();
    const { trigger, font } = mountOverOrg(onValueChange);

    open(trigger);
    const option = hoverFirstFont();
    option.click();
    flushSync();

    expect(onValueChange).toHaveBeenCalledWith(option.dataset.fontFamily);
    expect(font()).toBe(ORG_FONT);
  });
});
