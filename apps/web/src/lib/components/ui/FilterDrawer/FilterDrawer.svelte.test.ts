import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  screen,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import FilterDrawerHarness from './FilterDrawerHarness.test.svelte';

/**
 * FilterDrawer unit tests.
 *
 * Covers the generic shell behaviours that are nontrivial:
 *   • Header active-count badge gated on activeCount > 0 with "9+" cap.
 *   • Desktop write-through: setFilter / setSort flush immediately.
 *   • Mobile staged commit: setFilter / setSort buffer; Apply flushes;
 *     close-without-Apply (Cancel) discards staged.
 *   • Idempotent onOpenChange echo (Melt re-emits current state during
 *     controlled-state mount).
 *   • Clear-all: desktop calls onClearAll; mobile resets staged locally
 *     and does NOT call onClearAll.
 *
 * Drawer responsiveness is gated on window.matchMedia('(max-width: 40rem)').
 * jsdom returns matches=false by default → desktop. We stub matchMedia in
 * the mobile suite to flip the path.
 */

// ── matchMedia helper ─────────────────────────────────────────────────
type MqlListener = (e: { matches: boolean }) => void;

interface MqlStub {
  matches: boolean;
  media: string;
  addEventListener: (type: 'change', cb: MqlListener) => void;
  removeEventListener: (type: 'change', cb: MqlListener) => void;
  addListener: (cb: MqlListener) => void;
  removeListener: (cb: MqlListener) => void;
  dispatchEvent: (e: Event) => boolean;
  onchange: null | MqlListener;
}

function stubMatchMedia(initialMatches: boolean) {
  const listeners = new Set<MqlListener>();
  const mql: MqlStub = {
    matches: initialMatches,
    media: '(max-width: 40rem)',
    addEventListener: (_type, cb) => listeners.add(cb),
    removeEventListener: (_type, cb) => listeners.delete(cb),
    addListener: (cb) => listeners.add(cb),
    removeListener: (cb) => listeners.delete(cb),
    dispatchEvent: () => true,
    onchange: null,
  };
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn(() => mql),
  });
  return {
    mql,
    setMatches(next: boolean) {
      mql.matches = next;
      for (const cb of listeners) cb({ matches: next });
    },
  };
}

describe('FilterDrawer — desktop (default jsdom matchMedia)', () => {
  let component: ReturnType<typeof mount> | null = null;

  beforeEach(() => {
    // Default desktop: max-width: 40rem does NOT match.
    stubMatchMedia(false);
  });

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  // ── Badge rendering ─────────────────────────────────────────────────
  test('no badge rendered when activeCount is omitted (defaults to 0)', () => {
    component = mount(FilterDrawerHarness, {
      target: document.body,
      props: { open: true },
    });
    flushSync();

    expect(document.querySelector('.filter-drawer__badge')).toBeNull();
  });

  test('no badge rendered when activeCount is 0 (explicit)', () => {
    component = mount(FilterDrawerHarness, {
      target: document.body,
      props: { open: true, activeCount: 0 },
    });
    flushSync();

    expect(document.querySelector('.filter-drawer__badge')).toBeNull();
  });

  test('badge renders exact number when activeCount in 1..9', () => {
    for (const n of [1, 3, 9]) {
      component = mount(FilterDrawerHarness, {
        target: document.body,
        props: { open: true, activeCount: n },
      });
      flushSync();

      const badge = document.querySelector('.filter-drawer__badge');
      expect(badge?.textContent?.trim()).toBe(String(n));
      expect(badge?.getAttribute('aria-label')).toBe(`${n} active`);

      unmount(component);
      component = null;
      document.body.innerHTML = '';
    }
  });

  test('badge clamps to "9+" when activeCount > 9', () => {
    component = mount(FilterDrawerHarness, {
      target: document.body,
      props: { open: true, activeCount: 15 },
    });
    flushSync();

    const badge = document.querySelector('.filter-drawer__badge');
    expect(badge?.textContent?.trim()).toBe('9+');
    // aria-label still carries the true count.
    expect(badge?.getAttribute('aria-label')).toBe('15 active');
  });

  // ── Section context (view state mirrors live filters on desktop) ────
  test('section snippet receives live filters on desktop', () => {
    component = mount(FilterDrawerHarness, {
      target: document.body,
      props: {
        open: true,
        filters: { type: 'audio', featured: true },
        sort: 'oldest',
      },
    });
    flushSync();

    expect(screen.getByTestId('view-type')?.textContent).toBe('audio');
    expect(screen.getByTestId('view-featured')?.textContent).toBe('true');
    expect(screen.getByTestId('view-sort')?.textContent).toBe('oldest');
    expect(screen.getByTestId('view-is-mobile')?.textContent).toBe('false');
  });

  // ── Desktop write-through ───────────────────────────────────────────
  test('setFilter on desktop calls onFilterChange immediately', () => {
    const onFilterChange = vi.fn();
    component = mount(FilterDrawerHarness, {
      target: document.body,
      props: {
        open: true,
        filters: { type: '', featured: false },
        onFilterChange,
      },
    });
    flushSync();

    (screen.getByTestId('set-type-video') as HTMLButtonElement).click();
    flushSync();

    expect(onFilterChange).toHaveBeenCalledTimes(1);
    expect(onFilterChange).toHaveBeenCalledWith({
      type: 'video',
      featured: false,
    });
  });

  test('setSort on desktop calls onSortChange immediately', () => {
    const onSortChange = vi.fn();
    component = mount(FilterDrawerHarness, {
      target: document.body,
      props: {
        open: true,
        sort: 'newest',
        onSortChange,
      },
    });
    flushSync();

    (screen.getByTestId('set-sort-oldest') as HTMLButtonElement).click();
    flushSync();

    expect(onSortChange).toHaveBeenCalledTimes(1);
    expect(onSortChange).toHaveBeenCalledWith('oldest');
  });

  // ── Desktop Clear-all → onClearAll ───────────────────────────────────
  test('Clear button on desktop delegates to onClearAll', () => {
    const onClearAll = vi.fn();
    component = mount(FilterDrawerHarness, {
      target: document.body,
      props: { open: true, onClearAll },
    });
    flushSync();

    const clear = document.querySelector<HTMLButtonElement>(
      '.filter-drawer__clear'
    );
    expect(clear).toBeTruthy();
    clear?.click();
    flushSync();

    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  // ── Desktop primary action: Done — closes without flushing ──────────
  test('primary button on desktop reads "Done" and calls onOpenChange(false)', () => {
    const onOpenChange = vi.fn();
    const onFilterChange = vi.fn();
    const onSortChange = vi.fn();
    component = mount(FilterDrawerHarness, {
      target: document.body,
      props: {
        open: true,
        doneLabel: 'Done',
        applyLabel: 'Apply',
        onOpenChange,
        onFilterChange,
        onSortChange,
      },
    });
    flushSync();

    const primary = document.querySelector<HTMLButtonElement>(
      '.filter-drawer__btn--primary'
    );
    expect(primary?.textContent?.trim()).toBe('Done');
    primary?.click();
    flushSync();

    expect(onOpenChange).toHaveBeenCalledWith(false);
    // Desktop Done never flushes (parent already has live values).
    expect(onFilterChange).not.toHaveBeenCalled();
    expect(onSortChange).not.toHaveBeenCalled();
  });

  // ── Melt echo guard ─────────────────────────────────────────────────
  test('handleOpenChange ignores echo of the current open value (Melt echo guard)', () => {
    const onOpenChange = vi.fn();
    component = mount(FilterDrawerHarness, {
      target: document.body,
      props: { open: true, onOpenChange },
    });
    flushSync();

    // Mount-time syncs to Melt UI typically echo onOpenChange(true) → with
    // open already true, the shell should swallow it. We assert that the
    // shell did NOT bounce onOpenChange(true) back to the parent.
    const echoedTrue = onOpenChange.mock.calls.filter(
      (call) => call[0] === true
    );
    expect(echoedTrue.length).toBe(0);
  });
});

describe('FilterDrawer — mobile (matchMedia matches)', () => {
  let component: ReturnType<typeof mount> | null = null;
  let _mq: ReturnType<typeof stubMatchMedia>;

  beforeEach(() => {
    _mq = stubMatchMedia(true);
  });

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('section snippet receives staged state on mobile', () => {
    component = mount(FilterDrawerHarness, {
      target: document.body,
      props: {
        open: true,
        filters: { type: 'video', featured: false },
        sort: 'newest',
      },
    });
    flushSync();

    expect(screen.getByTestId('view-is-mobile')?.textContent).toBe('true');
    // Initially staged is seeded from filters/sort → mirrors live values.
    expect(screen.getByTestId('view-type')?.textContent).toBe('video');
    expect(screen.getByTestId('view-sort')?.textContent).toBe('newest');
  });

  test('setFilter on mobile DOES NOT call onFilterChange (staged only)', () => {
    const onFilterChange = vi.fn();
    component = mount(FilterDrawerHarness, {
      target: document.body,
      props: {
        open: true,
        filters: { type: '', featured: false },
        onFilterChange,
      },
    });
    flushSync();

    (screen.getByTestId('set-type-video') as HTMLButtonElement).click();
    flushSync();

    expect(onFilterChange).not.toHaveBeenCalled();
    // Staged updated — view-type reflects new staged value.
    expect(screen.getByTestId('view-type')?.textContent).toBe('video');
  });

  test('setSort on mobile DOES NOT call onSortChange (staged only)', () => {
    const onSortChange = vi.fn();
    component = mount(FilterDrawerHarness, {
      target: document.body,
      props: {
        open: true,
        sort: 'newest',
        onSortChange,
      },
    });
    flushSync();

    (screen.getByTestId('set-sort-oldest') as HTMLButtonElement).click();
    flushSync();

    expect(onSortChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('view-sort')?.textContent).toBe('oldest');
  });

  test('Apply on mobile flushes staged → onFilterChange / onSortChange and closes', () => {
    const onFilterChange = vi.fn();
    const onSortChange = vi.fn();
    const onOpenChange = vi.fn();

    component = mount(FilterDrawerHarness, {
      target: document.body,
      props: {
        open: true,
        filters: { type: '', featured: false },
        sort: 'newest',
        onFilterChange,
        onSortChange,
        onOpenChange,
        applyLabel: 'Apply',
      },
    });
    flushSync();

    // Stage some pending edits.
    (screen.getByTestId('set-type-video') as HTMLButtonElement).click();
    (screen.getByTestId('set-sort-oldest') as HTMLButtonElement).click();
    flushSync();

    const primary = document.querySelector<HTMLButtonElement>(
      '.filter-drawer__btn--primary'
    );
    expect(primary?.textContent?.trim()).toBe('Apply');

    primary?.click();
    flushSync();

    expect(onFilterChange).toHaveBeenCalledTimes(1);
    expect(onFilterChange).toHaveBeenCalledWith({
      type: 'video',
      featured: false,
    });
    expect(onSortChange).toHaveBeenCalledTimes(1);
    expect(onSortChange).toHaveBeenCalledWith('oldest');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test('Apply on mobile is idempotent — no flush when staged === live', () => {
    const onFilterChange = vi.fn();
    const onSortChange = vi.fn();
    const onOpenChange = vi.fn();

    component = mount(FilterDrawerHarness, {
      target: document.body,
      props: {
        open: true,
        filters: { type: 'video', featured: true },
        sort: 'oldest',
        onFilterChange,
        onSortChange,
        onOpenChange,
      },
    });
    flushSync();

    document
      .querySelector<HTMLButtonElement>('.filter-drawer__btn--primary')
      ?.click();
    flushSync();

    expect(onFilterChange).not.toHaveBeenCalled();
    expect(onSortChange).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test('Cancel path: closing without Apply does NOT flush staged', () => {
    const onFilterChange = vi.fn();
    const onSortChange = vi.fn();
    const onOpenChange = vi.fn();

    component = mount(FilterDrawerHarness, {
      target: document.body,
      props: {
        open: true,
        filters: { type: '', featured: false },
        sort: 'newest',
        onFilterChange,
        onSortChange,
        onOpenChange,
      },
    });
    flushSync();

    // Stage edits.
    (screen.getByTestId('set-type-video') as HTMLButtonElement).click();
    (screen.getByTestId('set-sort-oldest') as HTMLButtonElement).click();
    flushSync();

    // Simulate the dialog being closed via X / Esc / overlay (Melt fires
    // onOpenChange(false) on the Dialog, which the shell wraps via
    // handleOpenChange — we trigger it by clicking the dialog close button.
    const closeBtn = document.querySelector<HTMLButtonElement>('.dialog-close');
    closeBtn?.click();
    flushSync();

    // Staged edits never reached the parent.
    expect(onFilterChange).not.toHaveBeenCalled();
    expect(onSortChange).not.toHaveBeenCalled();
    // Parent informed of close.
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test('Clear-all on mobile resets staged locally without calling onClearAll', () => {
    const onClearAll = vi.fn();
    const onFilterChange = vi.fn();
    const onSortChange = vi.fn();

    component = mount(FilterDrawerHarness, {
      target: document.body,
      props: {
        open: true,
        filters: { type: '', featured: false },
        sort: 'newest',
        defaultFilters: { type: '', featured: false },
        defaultSort: 'newest',
        onClearAll,
        onFilterChange,
        onSortChange,
      },
    });
    flushSync();

    // Stage some pending edits.
    (screen.getByTestId('set-type-video') as HTMLButtonElement).click();
    (screen.getByTestId('set-sort-oldest') as HTMLButtonElement).click();
    flushSync();

    expect(screen.getByTestId('view-type')?.textContent).toBe('video');
    expect(screen.getByTestId('view-sort')?.textContent).toBe('oldest');

    document.querySelector<HTMLButtonElement>('.filter-drawer__clear')?.click();
    flushSync();

    // Mobile Clear DOES NOT delegate to the parent.
    expect(onClearAll).not.toHaveBeenCalled();
    expect(onFilterChange).not.toHaveBeenCalled();
    expect(onSortChange).not.toHaveBeenCalled();
    // Staged was reset to defaults.
    expect(screen.getByTestId('view-type')?.textContent).toBe('');
    expect(screen.getByTestId('view-sort')?.textContent).toBe('newest');
  });

  test('primary button reads "Apply" on mobile', () => {
    component = mount(FilterDrawerHarness, {
      target: document.body,
      props: { open: true, applyLabel: 'Apply', doneLabel: 'Done' },
    });
    flushSync();

    const primary = document.querySelector<HTMLButtonElement>(
      '.filter-drawer__btn--primary'
    );
    expect(primary?.textContent?.trim()).toBe('Apply');
  });
});
