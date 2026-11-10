/**
 * Content set from outside is not the creator's input (Codex-a6ofh.2.3):
 * TipTap 3 emits an update for a set unless told not to, and the studio
 * canvas autosaves on one, so a piece opened would read as changed.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const RichTextEditor = (await import('./RichTextEditor.svelte')).default;

let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

const DOC = JSON.stringify({
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Loaded later' }] },
  ],
});

describe('RichTextEditor · content that arrives after mount', () => {
  test('is shown, and never reported as input', () => {
    const oninput = vi.fn();
    const props = $state({ content: '' });
    component = mount(RichTextEditor, {
      target: document.body,
      props: {
        variant: 'canvas',
        ariaLabel: 'Article',
        get content() {
          return props.content;
        },
        oninput,
      },
    });
    flushSync();
    props.content = DOC;
    flushSync();
    expect(document.body.textContent).toContain('Loaded later');
    expect(oninput).not.toHaveBeenCalled();
  });
});

describe('RichTextEditor · canvas', () => {
  test('is named, wears the public page type, and has no toolbar', () => {
    component = mount(RichTextEditor, {
      target: document.body,
      props: { variant: 'canvas', ariaLabel: 'Article', content: DOC },
    });
    flushSync();
    const body = document.querySelector('[contenteditable="true"]');
    expect(body?.getAttribute('aria-label')).toBe('Article');
    expect(body?.getAttribute('role')).toBe('textbox');
    expect(body?.classList.contains('prose-content')).toBe(true);
    expect(document.querySelector('[role="toolbar"]')).toBeNull();
  });
});
