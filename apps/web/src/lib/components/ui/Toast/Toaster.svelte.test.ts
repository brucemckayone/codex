import { afterEach, describe, expect, test } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import Toaster from './Toaster.svelte';
import {
  type ToastData,
  type ToastVariant,
  toast,
  toaster,
} from './toast-store';

/**
 * Toaster and toast-store unit tests.
 *
 * Toaster renders the global toast-store via Melt UI's createToaster. Tests
 * cover (a) the store helpers (toast.success/error/warning/info/add) and
 * (b) end-to-end flow: adding a toast through the helper causes Toaster to
 * render a DOM element with the expected ARIA attributes and content. The
 * store is module-singleton, so each test clears any residual toasts in
 * afterEach to prevent cross-test leakage.
 */

/** Clear all toasts from the singleton store between tests. */
function clearToasts() {
  type ToastEntry = { id: string };
  let entries: ToastEntry[] = [];
  const unsub = (
    toaster.toasts as unknown as {
      subscribe: (fn: (v: ToastEntry[]) => void) => () => void;
    }
  ).subscribe((v) => {
    entries = v;
  });
  unsub();
  for (const entry of entries) toaster.remove(entry.id);
}

describe('Toaster component', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    clearToasts();
    document.body.innerHTML = '';
  });

  test('renders an empty toaster container when no toasts are active', () => {
    component = mount(Toaster, { target: document.body, props: {} });
    flushSync();

    const container = document.querySelector('.toaster');
    expect(container).toBeTruthy();
    expect(container?.querySelectorAll('.toast').length).toBe(0);
  });

  test('renders a toast with title and description when toast.success is called', () => {
    component = mount(Toaster, { target: document.body, props: {} });
    flushSync();

    toast.success('Saved!', 'All changes stored.');
    flushSync();

    const toastEl = document.querySelector('.toast');
    expect(toastEl).toBeTruthy();
    expect(toastEl?.textContent).toContain('Saved!');
    expect(toastEl?.textContent).toContain('All changes stored.');
  });

  test('toast element has role="alert" for assistive-tech announcements', () => {
    component = mount(Toaster, { target: document.body, props: {} });
    flushSync();

    toast.info('Heads up', 'You have 3 unread messages');
    flushSync();

    const toastEl = document.querySelector('.toast');
    expect(toastEl?.getAttribute('role')).toBe('alert');
    expect(toastEl?.getAttribute('aria-live')).toBe('assertive');
  });

  test('toast title and description are linked via aria-labelledby/aria-describedby', () => {
    component = mount(Toaster, { target: document.body, props: {} });
    flushSync();

    toast.warning('Watch out', 'Unsaved changes will be lost.');
    flushSync();

    const toastEl = document.querySelector('.toast');
    const labelledBy = toastEl?.getAttribute('aria-labelledby');
    const describedBy = toastEl?.getAttribute('aria-describedby');
    expect(labelledBy).toBeTruthy();
    expect(describedBy).toBeTruthy();

    const title = document.getElementById(labelledBy!);
    const description = document.getElementById(describedBy!);
    expect(title?.textContent).toContain('Watch out');
    expect(description?.textContent).toContain('Unsaved changes will be lost.');
  });

  test('close button has aria-label="Close" for screen readers', () => {
    component = mount(Toaster, { target: document.body, props: {} });
    flushSync();

    toast.error('Oops', 'Something went wrong');
    flushSync();

    const close = document.querySelector('.toast-close');
    expect(close?.getAttribute('aria-label')).toBe('Close');
    expect(close?.tagName.toLowerCase()).toBe('button');
  });

  test('data-variant attribute reflects the toast variant', () => {
    component = mount(Toaster, { target: document.body, props: {} });
    flushSync();

    toast.success('Done');
    flushSync();

    const toastEl = document.querySelector('.toast');
    expect(toastEl?.getAttribute('data-variant')).toBe('success');
  });

  test('multiple toasts stack as separate elements in the toaster container', () => {
    component = mount(Toaster, { target: document.body, props: {} });
    flushSync();

    toast.success('First');
    toast.warning('Second');
    toast.error('Third');
    flushSync();

    const toasts = document.querySelectorAll('.toast');
    expect(toasts.length).toBe(3);
  });

  test('programmatic toaster.remove drops the toast from the store', () => {
    component = mount(Toaster, { target: document.body, props: {} });
    flushSync();

    toast.info('Dismiss me');
    flushSync();

    // Full close-button pointer flow is covered by E2E; here we verify the
    // end-to-end store drop via the public remove helper. (The DOM node is
    // kept briefly by Svelte's outro transition; the store is the contract.)
    type Entry = { id: string };
    const readEntries = () => {
      let entries: Entry[] = [];
      const unsub = (
        toaster.toasts as unknown as {
          subscribe: (fn: (v: Entry[]) => void) => () => void;
        }
      ).subscribe((v) => {
        entries = v;
      });
      unsub();
      return entries;
    };

    const before = readEntries();
    expect(before.length).toBe(1);

    toaster.remove(before[0].id);

    const after = readEntries();
    expect(after.length).toBe(0);
  });
});

describe('toast-store', () => {
  afterEach(() => {
    clearToasts();
  });

  test('toaster object exports required properties', () => {
    expect(toaster).toBeDefined();
    expect(toaster.toasts).toBeDefined();
    expect(toaster.elements).toBeDefined();
    expect(toaster.elements.content).toBeDefined();
    expect(toaster.elements.title).toBeDefined();
    expect(toaster.elements.description).toBeDefined();
    expect(toaster.elements.close).toBeDefined();
    expect(typeof toaster.remove).toBe('function');
  });

  test('toast helper exports all variant methods', () => {
    expect(typeof toast.add).toBe('function');
    expect(typeof toast.success).toBe('function');
    expect(typeof toast.error).toBe('function');
    expect(typeof toast.warning).toBe('function');
    expect(typeof toast.info).toBe('function');
  });

  test('toast.add appends a toast to the toaster store', () => {
    const data: ToastData = { title: 'Hello', variant: 'neutral' };
    toast.add(data);

    let entries: Array<{ data: ToastData }> = [];
    const unsub = (
      toaster.toasts as unknown as {
        subscribe: (fn: (v: Array<{ data: ToastData }>) => void) => () => void;
      }
    ).subscribe((v) => {
      entries = v;
    });
    unsub();

    expect(entries.length).toBe(1);
    expect(entries[0].data.title).toBe('Hello');
    expect(entries[0].data.variant).toBe('neutral');
  });

  test('variant helpers set the correct variant on the toast data', () => {
    toast.success('s');
    toast.error('e');
    toast.warning('w');
    toast.info('i');

    let entries: Array<{ data: ToastData }> = [];
    const unsub = (
      toaster.toasts as unknown as {
        subscribe: (fn: (v: Array<{ data: ToastData }>) => void) => () => void;
      }
    ).subscribe((v) => {
      entries = v;
    });
    unsub();

    const variants = entries.map((e) => e.data.variant);
    expect(variants).toContain('success');
    expect(variants).toContain('error');
    expect(variants).toContain('warning');
    expect(variants).toContain('neutral');
  });

  test('toaster.remove removes a specific toast by id', () => {
    toast.info('First');
    toast.info('Second');

    type Entry = { id: string };
    let entries: Entry[] = [];
    const unsub = (
      toaster.toasts as unknown as {
        subscribe: (fn: (v: Entry[]) => void) => () => void;
      }
    ).subscribe((v) => {
      entries = v;
    });
    unsub();

    expect(entries.length).toBe(2);
    toaster.remove(entries[0].id);

    const unsub2 = (
      toaster.toasts as unknown as {
        subscribe: (fn: (v: Entry[]) => void) => () => void;
      }
    ).subscribe((v) => {
      entries = v;
    });
    unsub2();

    expect(entries.length).toBe(1);
  });

  test('ToastVariant type accepts all four variants', () => {
    const variants: ToastVariant[] = ['neutral', 'success', 'warning', 'error'];
    expect(variants).toHaveLength(4);
  });
});

describe('Toaster integration', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    clearToasts();
    document.body.innerHTML = '';
  });

  test('toasts state is a subscribable Svelte store', () => {
    expect(typeof toaster.toasts.subscribe).toBe('function');
  });

  test('store update flows into rendered DOM', () => {
    component = mount(Toaster, { target: document.body, props: {} });
    flushSync();

    expect(document.querySelectorAll('.toast').length).toBe(0);
    toast.success('Flows!');
    flushSync();
    expect(document.querySelectorAll('.toast').length).toBe(1);
  });
});
