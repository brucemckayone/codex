/**
 * Studio → Branding: the page's part in keeping unsaved work (Codex-0keaj).
 *
 * The store keeps the tab's unsaved brand for a reload, restoring it only over
 * the brand it was edited from. The page owns two moments the store cannot
 * see: what a Save actually sent (an edit made while it was in flight must
 * stay unsaved), and a confirmed "Discard?" on leaving, which is the only
 * leave that throws the draft away.
 *
 * Mounts the real `+page.svelte` with the real store. `$app/*` and the remote
 * modules are mocked; the rail and Guided view are a stub whose one button
 * runs the page's Save, and the canvas is inert.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

vi.mock('$app/navigation', () => ({
  beforeNavigate: vi.fn(),
  invalidate: vi.fn(async () => {}),
}));
vi.mock(
  '$app/state',
  () => import('$lib/components/support/__fixtures__/app-state.mock.svelte')
);
vi.mock(
  '$lib/remote/branding.remote',
  () =>
    import(
      '$lib/components/brand-studio/__fixtures__/branding-remote.mock.svelte'
    )
);
vi.mock('$lib/remote/content.remote', () => ({
  getPublicContent: () => ({
    current: { items: [] },
    error: undefined,
    loading: false,
  }),
}));
vi.mock(
  '$lib/components/brand-studio/BrandStudioRail.svelte',
  () => import('./SaveRailStub.test.svelte')
);
vi.mock(
  '$lib/components/brand-studio/guided/BrandStudioGuided.svelte',
  () => import('./SaveRailStub.test.svelte')
);
vi.mock(
  '$lib/components/brand-studio/BrandStudioCanvas.svelte',
  () => import('$lib/components/brand-studio/rail/StubField.test.svelte')
);

import { beforeNavigate } from '$app/navigation';
import { brandEditor } from '$lib/brand-editor';
import {
  BRANDING,
  brandingRemote,
  reset,
  updateBrandingCommand,
} from '$lib/components/brand-studio/__fixtures__/branding-remote.mock.svelte';
import { setPage } from '$lib/components/support/__fixtures__/app-state.mock.svelte';
import BrandPage from '../+page.svelte';

const KEY = 'codex:brand-editor';
const ORG = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Studio Alpha',
  slug: 'studio-alpha',
  description: null,
};

let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  reset();
  sessionStorage.clear();
  setPage('http://studio-alpha.lvh.me:3000/studio/brand');
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

/** The page with its brand loaded and one unsaved edit. */
function mountEdited() {
  component = mount(BrandPage, {
    target: document.body,
    // The page reads only `org` from its data.
    props: { data: { org: ORG } } as never,
  });
  flushSync();
  brandingRemote().land(BRANDING);
  flushSync();
  brandEditor.updateField('primaryColor', '#111111');
  flushSync();
  expect(sessionStorage.getItem(KEY)).not.toBeNull();
}

const settle = async () => {
  for (let turn = 0; turn < 3; turn++) {
    await new Promise((r) => setTimeout(r, 0));
  }
  flushSync();
};

/** The page's leave guard, as it registered it with beforeNavigate. */
type Navigation = { type?: string; cancel: () => void };

function leaveGuard(): (navigation: Navigation) => void {
  const guard = vi.mocked(beforeNavigate).mock.calls.at(-1)?.[0];
  expect(guard).toBeDefined();
  return guard as unknown as (navigation: Navigation) => void;
}

describe('Save', () => {
  test('sends what is on screen; an edit made while it is in flight stays unsaved', async () => {
    let land: (value: unknown) => void = () => {};
    updateBrandingCommand.mockImplementation(
      () =>
        new Promise((resolve) => {
          land = resolve;
        })
    );
    mountEdited();

    document
      .querySelector<HTMLButtonElement>('[data-testid="stub-save"]')
      ?.click();
    // A slider moves while the save is on its way.
    brandEditor.updateField('radius', 1.5);
    land({});
    await settle();

    expect(updateBrandingCommand).toHaveBeenCalledWith(
      expect.objectContaining({ primaryColorHex: '#111111', radiusValue: 0.5 })
    );
    expect(brandEditor.saved?.primaryColor).toBe('#111111');
    expect(brandEditor.saved?.radius).toBe(0.5);
    expect(brandEditor.isDirty).toBe(true);
    expect(sessionStorage.getItem(KEY)).not.toBeNull();
  });
});

describe('leaving with unsaved changes', () => {
  test('a confirmed Discard throws the draft away', () => {
    mountEdited();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const cancel = vi.fn();

    leaveGuard()({ cancel });
    flushSync();

    expect(cancel).not.toHaveBeenCalled();
    expect(brandEditor.isDirty).toBe(false);
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  test('a reload leaves the asking to the browser and keeps the draft', () => {
    mountEdited();
    // Were the browser to show it, OK would throw the draft away.
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const cancel = vi.fn();

    leaveGuard()({ type: 'leave', cancel });
    flushSync();

    expect(ask).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalled();
    expect(sessionStorage.getItem(KEY)).not.toBeNull();
  });

  test('declining stays on the page with the draft kept', () => {
    mountEdited();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const cancel = vi.fn();

    leaveGuard()({ cancel });
    flushSync();

    expect(cancel).toHaveBeenCalled();
    expect(brandEditor.pending?.primaryColor).toBe('#111111');
    expect(sessionStorage.getItem(KEY)).not.toBeNull();
  });
});
