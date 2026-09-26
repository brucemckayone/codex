import type { PageBuilderState, PageSection } from '@codex/shared-types';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sampleContext } from '$lib/page-builder/kit';
import { upgradePage } from '$lib/page-builder/kit/model/upgrade';
import { pageBuilder } from '$lib/page-builder/page-builder-store.svelte';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import Inspector from './Inspector.svelte';

const PAGE_ID = '00000000-0000-4000-8000-0000000000a8';

let app: ReturnType<typeof mount> | null = null;

/** Everything is on screen: the thumbnails render as soon as they mount. */
class OnScreen {
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe(target: Element): void {
    this.callback(
      [{ isIntersecting: true, target } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver
    );
  }
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', OnScreen);
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (app) unmount(app);
  app = null;
  pageBuilder.close();
  sessionStorage.clear();
  document.body.innerHTML = '';
});

function render(
  sections: PageSection[],
  selectedId: string | null = sections[0]?.id ?? null
) {
  pageBuilder.open(PAGE_ID, {
    pageType: 'course',
    slug: 'quiet-hours',
    title: 'Quiet Hours',
    status: 'draft',
    subjectType: 'course',
    subjectId: 'course-1',
    brandOverrides: null,
    design: { style: 'bold' },
    sections,
  } as PageBuilderState);
  pageBuilder.selectSection(selectedId);
  const props = {
    get page() {
      const pending = pageBuilder.pending;
      return upgradePage({
        design: pending?.design,
        sections: pending?.sections,
      });
    },
    get selectedId() {
      return pageBuilder.selectedSectionId;
    },
    context: sampleContext(),
    onDuplicate: vi.fn(),
    onToggle: vi.fn(),
    onDelete: vi.fn(),
    onChangeStyle: vi.fn(),
  };
  app = mount(Inspector, { target: document.body, props });
  flushSync();
  return props;
}

function stored(id: string): PageSection {
  const section = pageBuilder.pending?.sections.find((s) => s.id === id);
  if (!section) throw new Error(`no section ${id}`);
  return section;
}

function el<T extends Element = HTMLElement>(selector: string): T {
  const found = document.body.querySelector<T>(selector);
  if (!found) throw new Error(`nothing matches ${selector}`);
  return found;
}

function click(selector: string): void {
  el<HTMLElement>(selector).click();
  flushSync();
}

function type(
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string
): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

function key(target: Element, name: string): void {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key: name, bubbles: true })
  );
  flushSync();
}

/** A control's input, found by its visible label. */
function field(label: string): HTMLInputElement {
  const labelEl = [...document.querySelectorAll('label')].find(
    (l) => l.textContent?.trim() === label
  );
  const input = labelEl?.htmlFor
    ? document.getElementById(labelEl.htmlFor)
    : null;
  if (
    !(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)
  ) {
    throw new Error(`no field labelled ${label}`);
  }
  return input as HTMLInputElement;
}

describe('Inspector — section', () => {
  it('draws each layout as a real render and writes the one chosen', () => {
    render([
      { id: 'h', type: 'hero', enabled: true, props: { heading: 'Rest well' } },
    ]);
    const layouts = [
      ...document.querySelectorAll<HTMLButtonElement>('.layout'),
    ];
    expect(layouts.map((b) => b.dataset.layout)).toEqual([
      'statement',
      'split',
      'cover',
      'centered',
    ]);
    // The thumbnail is the kit's own markup, with the section's own words.
    expect(
      el('.layout[data-layout="cover"] .lp-section').dataset.lpLayout
    ).toBe('cover');
    expect(el('.layout[data-layout="cover"] .mini').textContent).toContain(
      'Rest well'
    );
    // Bold opens on a statement hero: that is the Style's default.
    expect(
      el('.layout[data-layout="statement"] .layout__default')
    ).toBeTruthy();
    expect(
      el('.layout[data-layout="statement"]').getAttribute('aria-pressed')
    ).toBe('true');

    click('.layout[data-layout="split"]');
    expect(stored('h').variant).toBe('split');
    expect(
      el('.layout[data-layout="split"]').getAttribute('aria-pressed')
    ).toBe('true');
  });

  it('writes the swatch chosen and clears it back to the Style default', () => {
    render([{ id: 'h', type: 'hero', enabled: true, props: {} }]);
    // Bold's hero is a brand band, so the brand swatch is the default and current.
    const brand = el('.swatch[data-scheme="brand"]');
    expect(brand.getAttribute('aria-pressed')).toBe('true');
    expect(brand.getAttribute('aria-label')).toContain('default');
    expect(
      el('.swatch[data-scheme="contrast"] [data-lp-scheme="contrast"]')
    ).toBeTruthy();
    expect(document.querySelector('.swatches__reset')).toBeNull();

    click('.swatch[data-scheme="contrast"]');
    expect(stored('h').design).toEqual({ scheme: 'contrast' });
    expect(
      el('.swatch[data-scheme="contrast"]').getAttribute('aria-pressed')
    ).toBe('true');

    click('.swatches__reset');
    expect(stored('h').design).toBeUndefined();
    expect(
      el('.swatch[data-scheme="brand"]').getAttribute('aria-pressed')
    ).toBe('true');
  });

  it('marks as default the scheme the section would really get, band rules included', () => {
    // Bold: a contrast "problem" band, then a "before and after" whose Style
    // default is ALSO contrast — so on the page it steps back to the page colour.
    render(
      [
        { id: 'p', type: 'problem', enabled: true, props: {} },
        { id: 't', type: 'transformation', enabled: true, props: {} },
      ],
      't'
    );
    expect(el('.swatch[data-scheme="base"]').getAttribute('aria-pressed')).toBe(
      'true'
    );
    expect(
      el('.swatch[data-scheme="base"]').getAttribute('aria-label')
    ).toContain('default');
  });

  it('shows the resolved spacing: a compact layout sits small until chosen', () => {
    render([
      { id: 'c', type: 'cta', enabled: true, variant: 'compact', props: {} },
    ]);
    expect(el('[data-spacing="compact"]').getAttribute('aria-pressed')).toBe(
      'true'
    );
    expect(el('.spacing__note').textContent).toContain('Small');

    click('[data-spacing="spacious"]');
    expect(stored('c').design).toEqual({ spacing: 'spacious' });
    expect(el('[data-spacing="spacious"]').getAttribute('aria-pressed')).toBe(
      'true'
    );

    click('.spacing__reset');
    expect(stored('c').design).toBeUndefined();
    expect(el('[data-spacing="compact"]').getAttribute('aria-pressed')).toBe(
      'true'
    );
  });

  it('reads and writes text, counting against the limit; blank removes the key', () => {
    render([
      { id: 'h', type: 'hero', enabled: true, props: { heading: 'Rest well' } },
    ]);
    const headline = field('Headline');
    expect(headline.value).toBe('Rest well');
    expect(headline.maxLength).toBe(120);

    type(headline, 'Sleep deeply');
    expect(stored('h').props.heading).toBe('Sleep deeply');
    expect(
      document.getElementById(headline.getAttribute('aria-describedby') ?? '')
        ?.textContent
    ).toContain('12 / 120');

    type(headline, '   ');
    expect(Object.hasOwn(stored('h').props, 'heading')).toBe(false);
  });

  it('refuses an unsafe link out loud', () => {
    render([{ id: 'h', type: 'hero', enabled: true, props: {} }]);
    const link = field('Second button link');
    type(link, 'javascript:alert(1)');
    expect(link.getAttribute('aria-invalid')).toBe('true');
    expect(document.body.textContent).toContain('can’t be used on your page');

    type(link, '#curriculum');
    expect(link.hasAttribute('aria-invalid')).toBe(false);
    expect(stored('h').props.secondaryHref).toBe('#curriculum');
  });

  it('turns a toggle on and back off (off = absent)', () => {
    render([{ id: 's', type: 'stats', enabled: true, props: {} }]);
    const toggle = el<HTMLButtonElement>('.field--toggle [role="switch"]');
    toggle.click();
    flushSync();
    expect(stored('s').props.live).toBe(true);
    toggle.click();
    flushSync();
    expect(Object.hasOwn(stored('s').props, 'live')).toBe(false);
  });

  it('lists: adds, edits, reorders from the keyboard and removes lines', async () => {
    render([
      {
        id: 'p',
        type: 'problem',
        enabled: true,
        props: { points: ['First', 'Second'] },
      },
    ]);
    const inputs = () => [
      ...document.querySelectorAll<HTMLInputElement>('.list__input'),
    ];
    expect(inputs().map((i) => i.value)).toEqual(['First', 'Second']);

    click('.list .rows__add');
    await tick();
    expect(stored('p').props.points).toEqual(['First', 'Second', '']);
    expect(document.activeElement).toBe(inputs()[2]);
    type(inputs()[2], 'Third');
    expect(stored('p').props.points).toEqual(['First', 'Second', 'Third']);

    key(document.querySelectorAll('.list .rows__grip')[0], 'ArrowDown');
    expect(stored('p').props.points).toEqual(['Second', 'First', 'Third']);
    expect(document.body.textContent).toContain('moved to position 2 of 3');

    document
      .querySelectorAll<HTMLButtonElement>('.list .rows__remove')[1]
      .click();
    flushSync();
    expect(stored('p').props.points).toEqual(['Second', 'Third']);
  });

  it('lists stop adding at their maximum', () => {
    const points = ['1', '2', '3', '4', '5', '6'];
    render([{ id: 'p', type: 'problem', enabled: true, props: { points } }]);
    expect(el<HTMLButtonElement>('.list .rows__add').disabled).toBe(true);
    expect(el('.rows__full').textContent).toContain('6');
  });

  it('items: add opens a row to type into; rows reorder and remove', () => {
    render([
      {
        id: 'b',
        type: 'benefits',
        enabled: true,
        props: { items: [{ title: 'One' }, { title: 'Two' }] },
      },
    ]);
    const titles = () =>
      [...document.querySelectorAll('.item__title')].map((t) =>
        t.textContent?.trim()
      );
    expect(titles()).toEqual(['One', 'Two']);

    click('.items .rows__add');
    expect(stored('b').props.items).toEqual([
      { title: 'One' },
      { title: 'Two' },
      {},
    ]);
    const open = document.querySelectorAll('.item')[2];
    expect(
      open.querySelector('.item__toggle')?.getAttribute('aria-expanded')
    ).toBe('true');
    const input = open.querySelector<HTMLInputElement>('input');
    if (!input) throw new Error('no input in the new row');
    type(input, 'Three');
    expect(stored('b').props.items).toEqual([
      { title: 'One' },
      { title: 'Two' },
      { title: 'Three' },
    ]);

    key(document.querySelectorAll('.items .rows__grip')[2], 'ArrowUp');
    expect(titles()).toEqual(['One', 'Three', 'Two']);

    document
      .querySelectorAll<HTMLButtonElement>('.items .rows__remove')[0]
      .click();
    flushSync();
    expect(stored('b').props.items).toEqual([
      { title: 'Three' },
      { title: 'Two' },
    ]);
  });

  it('renames the section for the outline, and clears back to its type', () => {
    render([{ id: 'f', type: 'faq', enabled: true, props: {} }]);
    const name = field('Name in the list');
    type(name, 'Worries');
    expect(stored('f').name).toBe('Worries');
    type(name, '');
    expect(Object.hasOwn(stored('f'), 'name')).toBe(false);
  });

  it('hands duplicate, hide and delete to the shell', () => {
    const props = render([{ id: 'f', type: 'faq', enabled: true, props: {} }]);
    const actions = [
      ...document.querySelectorAll<HTMLButtonElement>(
        '.section-inspector__action'
      ),
    ];
    for (const action of actions) action.click();
    expect(props.onDuplicate).toHaveBeenCalledWith('f');
    expect(props.onToggle).toHaveBeenCalledWith('f');
    expect(props.onDelete).toHaveBeenCalledWith('f');
  });
});

describe('Inspector — page', () => {
  it('shows the page Style, the section count and a way to the Style tab', () => {
    const props = render(
      [
        { id: 'h', type: 'hero', enabled: true, props: {} },
        { id: 'f', type: 'faq', enabled: false, props: {} },
      ],
      null
    );
    expect(el('.page-inspector__style').textContent).toBe('Bold');
    expect(el('.page-inspector__facts').textContent).toContain('2');
    click('.page-inspector__button');
    expect(props.onChangeStyle).toHaveBeenCalled();
  });
});
