/**
 * One page-brand font over the organisation's (Codex-q01h8).
 *
 * With no page font the picker shows the organisation's own family: the first
 * family of what the org layout writes, which ends in its metric fallback.
 * And the picker's hover preview leaves the organisation's font as it found
 * it, now that each preview puts back what it found. Opened from the keyboard
 * and closed by a second click: the test DOM cannot drive Melt's pointerdown
 * path.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import BrandFontField from './BrandFontField.svelte';

// As the org layout writes it: withFallback(face, `'${face}'`).
const ORG_FONT = "'Source Sans 3', 'Source Sans 3-fallback'";

describe('BrandFontField over the organisation font', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  function mountOverOrg(onChange = vi.fn()) {
    const layout = document.createElement('div');
    layout.className = 'org-layout';
    layout.style.setProperty('--brand-font-body', ORG_FONT);
    document.body.appendChild(layout);
    component = mount(BrandFontField, {
      target: layout,
      props: { mode: 'body', label: 'Body font', value: undefined, onChange },
    });
    flushSync();
    const trigger = layout.querySelector<HTMLElement>('[role="combobox"]');
    if (!trigger) throw new Error('BrandFontField rendered no picker');
    return { layout, trigger };
  }

  test('shows the organisation family, not its fallback, when the page has none', () => {
    const onChange = vi.fn();
    const { trigger } = mountOverOrg(onChange);

    expect(trigger.textContent).toContain('Source Sans 3');
    expect(trigger.textContent).not.toContain('fallback');
    // The category tag renders only for a family the catalog knows.
    expect(trigger.querySelector('.font-picker__tag')).not.toBeNull();
    // The picker echoes the family it shows; that is not an override.
    expect(onChange).not.toHaveBeenCalled();
  });

  test('a hover preview leaves the organisation font as it found it', () => {
    const { layout, trigger } = mountOverOrg();

    trigger.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        bubbles: true,
        cancelable: true,
      })
    );
    flushSync();
    const option = document.querySelector<HTMLElement>('[data-font-family]');
    if (!option) throw new Error('the open dropdown listed no font');
    option.dispatchEvent(new PointerEvent('pointerenter'));
    flushSync();
    expect(layout.style.getPropertyValue('--brand-font-body')).not.toBe(
      ORG_FONT
    );
    trigger.click();
    flushSync();

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(layout.style.getPropertyValue('--brand-font-body')).toBe(ORG_FONT);
  });
});
