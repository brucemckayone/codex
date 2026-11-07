/**
 * The picker's hover preview against the real `.org-layout` (Codex-q01h8).
 *
 * The brand studio renders the picker before the editor opens, and the page
 * builder renders it over an organisation whose font the layout owns. A
 * picker with no font of its own "reverted" to nothing when its dropdown
 * closed, and stripped the organisation's font until a reload. Each preview
 * now puts back what it found, however it ends. A pick is the owner's to
 * write, and the preview ends before the pick reaches it: an owner writes it
 * in the preview's own spelling, so a preview still open then would put the
 * old font back over it. Which runs first, the picker's close or the store's
 * write, is not the picker's to know, so the owner here writes at once, the
 * worst case. The brand editor's own store is checked too, as integration
 * only: there the close ran before the store's write, so that case passes
 * even without the pick-time end. Opened from the keyboard and closed by a
 * second click: the test DOM cannot drive Melt's pointerdown path, and its
 * Escape does not reach Melt.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import type { BrandEditorState } from '$lib/brand-editor';
import { brandEditor } from '$lib/brand-editor';
import { withFallback } from '$lib/brand-editor/font-fallbacks';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import FontPicker from './FontPicker.svelte';
import BrandEditorTypography from './levels/BrandEditorTypography.svelte';

const ORG_FONT = "'Lobster', 'Lobster-fallback'";
const ORG_ID = '00000000-0000-4000-8000-000000000000';

describe('the font picker leaves the organisation font as it found it', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    brandEditor.close();
    document.body.innerHTML = '';
  });

  function orgLayout(): HTMLElement {
    const layout = document.createElement('div');
    layout.className = 'org-layout';
    layout.style.setProperty('--brand-font-body', ORG_FONT);
    document.body.appendChild(layout);
    return layout;
  }

  function mountOverOrg() {
    const layout = orgLayout();
    component = mount(FontPicker, {
      target: layout,
      props: {
        mode: 'body',
        label: 'Body font',
        value: '',
        onValueChange: vi.fn(),
      },
    });
    flushSync();
    return pickerIn(layout);
  }

  function pickerIn(layout: HTMLElement) {
    const trigger = layout.querySelector<HTMLElement>('[role="combobox"]');
    if (!trigger) throw new Error('rendered no font picker');
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

  /** Hover the first listed font that is none of `except`. */
  function hoverFont(...except: string[]): HTMLElement {
    const option = [
      ...document.querySelectorAll<HTMLElement>('[data-font-family]'),
    ].find((o) => !except.includes(o.dataset.fontFamily ?? ''));
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
    hoverFont();
    expect(font(), 'previewing').not.toBe(ORG_FONT);
    close(trigger);

    expect(font()).toBe(ORG_FONT);
  });

  test('leaving the list mid-preview, still open', () => {
    const { trigger, font } = mountOverOrg();

    open(trigger);
    hoverFont();
    const list = document.querySelector('.font-picker__dropdown');
    if (!list) throw new Error('the open dropdown rendered no list');
    list.dispatchEvent(new PointerEvent('pointerleave'));
    flushSync();

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(font()).toBe(ORG_FONT);
  });

  test('going away mid-preview, as when its panel closes', () => {
    const { trigger, font } = mountOverOrg();

    open(trigger);
    hoverFont();
    if (component) unmount(component);
    component = null;
    flushSync();

    expect(font()).toBe(ORG_FONT);
  });

  test('picking the font it previews, with an owner that writes it at once', () => {
    const layout = orgLayout();
    const props = $state({
      mode: 'body' as const,
      label: 'Body font',
      value: '',
      onValueChange: (family: string) => {
        props.value = family;
        layout.style.setProperty(
          '--brand-font-body',
          withFallback(family, `'${family}'`)
        );
      },
    });
    component = mount(FontPicker, { target: layout, props });
    flushSync();
    const { trigger, font } = pickerIn(layout);

    open(trigger);
    const option = hoverFont('Inter');
    const picked = option.dataset.fontFamily ?? '';
    option.click();
    flushSync();

    expect(font()).toBe(withFallback(picked, `'${picked}'`));
  });

  // Integration only: it passes without the pick-time end (see the header).
  test("picking with the brand editor's store as owner: the pick lands", () => {
    const layout = orgLayout();
    const saved: BrandEditorState = {
      primaryColor: '#2563EB',
      secondaryColor: null,
      accentColor: null,
      backgroundColor: null,
      fontBody: 'Lora',
      fontHeading: null,
      radius: 0.5,
      density: 1,
      logoUrl: null,
      tokenOverrides: {},
      darkOverrides: null,
      darkTokenOverrides: null,
      heroLayout: 'default',
    };
    brandEditor.open(ORG_ID, saved);
    component = mount(BrandEditorTypography, { target: layout });
    flushSync();
    const { trigger, font } = pickerIn(layout);
    expect(font(), 'the editor previews its pending font').toContain("'Lora'");

    open(trigger);
    const option = hoverFont('Lora');
    const picked = option.dataset.fontFamily;
    option.click();
    flushSync();

    expect(brandEditor.pending?.fontBody).toBe(picked);
    expect(font()).toContain(`'${picked}'`);
    expect(font()).not.toContain('Lora');
  });
});
