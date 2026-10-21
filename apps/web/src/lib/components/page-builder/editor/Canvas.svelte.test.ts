/**
 * The canvas: selection, insert points, the section toolbar, and the inline
 * edit seam's two guarantees — a focused field is never re-rendered from the
 * store, and blurring it leaves exactly the nodes the store describes.
 */
import { type ComponentProps, tick } from 'svelte';
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

async function render(
  overrides: {
    device?: Device;
    notices?: ComponentProps<typeof Canvas>['notices'];
  } = {},
  initial: { page?: KitPage; contextSettled?: boolean } = {}
) {
  const state = $state({
    page: initial.page ?? (samplePage('bold') as KitPage),
    selectedId: null as string | null,
    contextSettled: initial.contextSettled ?? true,
  });
  const props = {
    get page() {
      return state.page;
    },
    get contextSettled() {
      return state.contextSettled;
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
    // On the section itself, not into its words: the shell inspects it.
    // (A click into the words cannot be drawn here: jsdom has no
    // isContentEditable. e2e/page-kit/editor-tablet.spec.ts holds it.)
    pricing?.click();
    flushSync();
    expect(props.onSelect).toHaveBeenLastCalledWith(
      pricing?.dataset.lpSection,
      'section'
    );
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

  it('pins each notice above the page with its action, dismissible only when it says so', async () => {
    const reload = vi.fn();
    const retry = vi.fn();
    const dismiss = vi.fn();
    await render({
      notices: [
        {
          id: 'stale',
          message: 'This page was saved in another tab.',
          action: { label: 'Reload', run: reload },
        },
        {
          id: 'context',
          message: 'Some course details did not load.',
          action: { label: 'Retry', run: retry },
          onDismiss: dismiss,
        },
      ],
    });
    const shown = [
      ...document.querySelectorAll<HTMLElement>('.canvas__notice'),
    ];
    expect(shown.map((notice) => notice.dataset.notice)).toEqual([
      'stale',
      'context',
    ]);
    // Above the page, never scrolled away with it.
    expect(shown[0].closest('.canvas__scroller')).toBeNull();
    expect(shown[0].getAttribute('role')).toBe('alert');
    expect(shown[0].textContent).toContain(
      'This page was saved in another tab.'
    );

    shown[0]
      .querySelector<HTMLButtonElement>('.canvas__notice-action')
      ?.click();
    expect(reload).toHaveBeenCalledOnce();
    expect(shown[0].querySelector('.canvas__notice-dismiss')).toBeNull();

    shown[1]
      .querySelector<HTMLButtonElement>('.canvas__notice-dismiss')
      ?.click();
    expect(dismiss).toHaveBeenCalledOnce();
    expect(retry).not.toHaveBeenCalled();
  });

  it('has no notice area when there is nothing to say', async () => {
    await render();
    expect(document.querySelector('.canvas__notices')).toBeNull();
  });
});

describe('Canvas: sections out of view skip layout (Codex-61zsk.72)', () => {
  const frames = () =>
    new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );
  const settled = async () => {
    await frames();
    await frames();
    flushSync();
  };
  const isLazy = () =>
    document.querySelector('.canvas__page')?.hasAttribute('data-lazy') ?? false;
  const jump = (id: string) =>
    (
      app as unknown as { scrollToSection: (id: string) => void }
    ).scrollToSection(id);

  /**
   * A scroller 600px tall over a 10,000px page, with the last section where
   * its skipped neighbours' remembered heights put it (`top`, movable).
   */
  function rig() {
    const scroller = document.querySelector<HTMLElement>('.canvas__scroller')!;
    const sections = [
      ...document.querySelectorAll<HTMLElement>('[data-lp-section]'),
    ];
    const target = sections[sections.length - 1];
    const state = { at: 0, top: 2000 };
    Object.defineProperty(scroller, 'scrollTop', {
      configurable: true,
      get: () => state.at,
      set: (value: number) => {
        state.at = value;
      },
    });
    Object.defineProperty(scroller, 'clientHeight', {
      configurable: true,
      value: 600,
    });
    Object.defineProperty(scroller, 'scrollHeight', {
      configurable: true,
      value: 10_000,
    });
    scroller.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    target.getBoundingClientRect = () =>
      ({ top: state.top - state.at }) as DOMRect;
    const aims: number[] = [];
    // Like a real scroller, it cannot go past its last screen.
    scroller.scrollTo = ((options: ScrollToOptions) => {
      aims.push(options.top ?? 0);
      state.at = Math.max(0, Math.min(10_000 - 600, options.top ?? 0));
    }) as typeof scroller.scrollTo;
    return { scroller, sections, target, state, aims };
  }

  it('lays every section out in full first, then lets those out of view skip it', async () => {
    await render();
    expect(isLazy()).toBe(false);
    await settled();
    expect(isLazy()).toBe(true);
  });

  it('does not skip while the page’s reads are loading, only once they answer', async () => {
    const { state } = await render({}, { contextSettled: false });
    await settled();
    expect(isLazy()).toBe(false);

    state.contextSettled = true;
    flushSync();
    await settled();
    expect(isLazy()).toBe(true);
  });

  it('lays out sections that arrive on an empty canvas before skipping any', async () => {
    const full = samplePage('bold') as KitPage;
    const { state } = await render({}, { page: { ...full, sections: [] } });
    await settled();

    state.page = full;
    flushSync();
    expect(document.querySelector('.canvas__page')).not.toBeNull();
    expect(isLazy()).toBe(false);
    await settled();
    expect(isLazy()).toBe(true);
  });

  it('lays everything out again for a new section, and for a new Style', async () => {
    const { state } = await render();
    await settled();
    expect(isLazy()).toBe(true);

    const [first] = state.page.sections;
    state.page = {
      ...state.page,
      sections: [...state.page.sections, { ...first, id: 'a-new-section' }],
    };
    flushSync();
    expect(isLazy()).toBe(false);
    await settled();
    expect(isLazy()).toBe(true);

    const style = state.page.design.style === 'soft' ? 'bold' : 'soft';
    state.page = { ...state.page, design: { ...state.page.design, style } };
    flushSync();
    expect(isLazy()).toBe(false);
  });

  it('aims again once the scroll ends, when stale heights moved the target', async () => {
    await render();
    await settled();
    const { scroller, target, state, aims } = rig();

    jump(target.dataset.lpSection!);
    expect(aims).toEqual([1984]);

    // Drawn on the way down at the new width, the sections above are taller.
    state.top = 2300;
    scroller.dispatchEvent(new Event('scrollend'));
    expect(aims).toEqual([1984, 2284]);
    await frames();
    await frames();
    expect(aims).toEqual([1984, 2284]);
  });

  it('aims again once the scroller is still, with no scrollend', async () => {
    await render();
    await settled();
    const { target, state, aims } = rig();

    jump(target.dataset.lpSection!);
    state.top = 2300;
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(aims).toEqual([1984, 2284]);
  });

  it('gives way to the creator’s own scrolling', async () => {
    await render();
    await settled();
    const { scroller, target, state, aims } = rig();

    jump(target.dataset.lpSection!);
    scroller.dispatchEvent(new Event('wheel'));
    state.top = 2300;
    scroller.dispatchEvent(new Event('scrollend'));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(aims).toEqual([1984]);
  });

  it('gives way to a newer jump, even one already in view', async () => {
    await render();
    await settled();
    const { scroller, sections, target, state, aims } = rig();
    const near = sections[0];
    near.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;

    jump(target.dataset.lpSection!);
    jump(near.dataset.lpSection!);
    state.top = 2300;
    scroller.dispatchEvent(new Event('scrollend'));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(aims).toEqual([1984]);
  });

  it('does not aim at a section that left the page on the way', async () => {
    await render();
    await settled();
    const { scroller, target, aims } = rig();

    jump(target.dataset.lpSection!);
    target.remove();
    // What a browser measures for a node no longer in the document.
    target.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    scroller.dispatchEvent(new Event('scrollend'));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(aims).toEqual([1984]);
  });

  it('settles on the furthest the scroller can go for a short last section', async () => {
    await render();
    await settled();
    const { scroller, target, state, aims } = rig();
    // The last section's top is inside the last screen of the page.
    state.top = 9800;

    jump(target.dataset.lpSection!);
    expect(aims).toEqual([9784]);
    scroller.dispatchEvent(new Event('scrollend'));
    await frames();
    await frames();
    // The scroller stopped at 9,400 (10,000 - 600): that is the landing, not
    // 9,784 again, which it can never reach.
    expect(aims).toEqual([9784]);
  });
});
