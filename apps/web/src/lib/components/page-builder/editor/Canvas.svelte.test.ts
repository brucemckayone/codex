/**
 * The canvas: selection, insert points, the section toolbar, and the inline
 * edit seam's two guarantees — a focused field is never re-rendered from the
 * store, and blurring it leaves exactly the nodes the store describes.
 */
import { tick } from 'svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { type KitPage, sampleContext, samplePage } from '$lib/page-builder/kit';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import Canvas from './Canvas.svelte';
import type { Device } from './editor-state';

// jsdom has `contenteditable` but not `isContentEditable`.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'isContentEditable', {
    configurable: true,
    get(this: HTMLElement) {
      return this.closest('[contenteditable="true"]') !== null;
    },
  });
});

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
});

async function render(overrides: { device?: Device } = {}) {
  const state = $state({
    page: samplePage('bold') as KitPage,
    selectedId: null as string | null,
  });
  const props = {
    get page() {
      return state.page;
    },
    context: sampleContext({ offer: 'tiers' }),
    device: 'desktop' as Device,
    theme: 'light' as const,
    get selectedId() {
      return state.selectedId;
    },
    onSelect: vi.fn((id: string | null) => {
      state.selectedId = id;
    }),
    onCommit: vi.fn(),
    onInsert: vi.fn(),
    onAction: vi.fn(),
    ...overrides,
  };
  app = mount(Canvas, { target: document.body, props });
  flushSync();
  await tick();
  flushSync();
  return { props, state };
}

describe('Canvas', () => {
  it('offers an insert point before the first section and after every one', async () => {
    const { props, state } = await render();
    const points = [
      ...document.querySelectorAll<HTMLElement>('.canvas__insert'),
    ];
    expect(points).toHaveLength(state.page.sections.length + 1);
    expect(points[0].dataset.after).toBe('');
    expect(points[1].dataset.after).toBe(state.page.sections[0].id);
    points[0].querySelector('button')?.click();
    expect(props.onInsert).toHaveBeenLastCalledWith(null);
    points[1].querySelector('button')?.click();
    expect(props.onInsert).toHaveBeenLastCalledWith(state.page.sections[0].id);
  });

  it('selects the section that was clicked, and shows its toolbar', async () => {
    const { props } = await render();
    const pricing = document.querySelector<HTMLElement>(
      '[data-lp-type="pricing"]'
    );
    pricing?.querySelector('h2')?.click();
    flushSync();
    expect(props.onSelect).toHaveBeenLastCalledWith(pricing?.dataset.lpSection);
    const toolbar = document.querySelector('[role="toolbar"]');
    expect(toolbar?.getAttribute('aria-label')).toBe('Pricing actions');
    toolbar
      ?.querySelector<HTMLButtonElement>('[data-action="duplicate"]')
      ?.click();
    expect(props.onAction).toHaveBeenLastCalledWith(
      'duplicate',
      pricing?.dataset.lpSection
    );
  });

  it('draws the page at the device frame’s real width', async () => {
    await render({ device: 'mobile' });
    const frame = document.querySelector<HTMLElement>('.canvas__frame');
    expect(frame?.dataset.device).toBe('mobile');
    expect(frame?.style.getPropertyValue('--_frame')).toBe('390px');
  });

  it('keeps a focused paragraph field as typed, then renders it once from the store', async () => {
    const { props, state } = await render();
    const hero = state.page.sections.find((s) => s.type === 'hero');
    if (!hero) throw new Error('sample page has a hero');
    // What the store does: take the committed value.
    props.onCommit.mockImplementation(
      (sectionId: string, key: string, value: string) => {
        state.page = {
          ...state.page,
          sections: state.page.sections.map((s) =>
            s.id === sectionId
              ? { ...s, props: { ...s.props, [key]: value } }
              : s
          ),
        };
      }
    );
    const field = document.querySelector<HTMLElement>(
      '[data-lp-type="hero"] [data-field="body"]'
    );
    if (!field) throw new Error('hero body is editable');
    const first = field.querySelector('p')?.textContent ?? '';

    field.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    // The browser's own Enter: a new paragraph node the store never made.
    const typed = document.createElement('p');
    typed.textContent = 'A second paragraph.';
    field.appendChild(typed);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();

    expect(props.onCommit).toHaveBeenCalledWith(
      hero.id,
      'body',
      `${first}\n\nA second paragraph.`
    );
    // Pinned: the store's new value has not been written into the field.
    expect(field.querySelectorAll('p')).toHaveLength(2);
    expect(field.lastElementChild).toBe(typed);

    field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    flushSync();
    const paragraphs = [...field.querySelectorAll('p')].map(
      (p) => p.textContent
    );
    expect(paragraphs).toEqual([first, 'A second paragraph.']);
    // Svelte's own node now, not the browser's stray.
    expect(field.contains(typed)).toBe(false);
  });

  it('refuses a line break in a one-line field', async () => {
    await render();
    const heading = document.querySelector<HTMLElement>(
      '[data-lp-type="hero"] [data-field="heading"]'
    );
    const event = new InputEvent('beforeinput', {
      inputType: 'insertParagraph',
      bubbles: true,
      cancelable: true,
    });
    heading?.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
