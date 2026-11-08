/**
 * Studio → Branding: the rail is live only once the editor holds a brand
 * (Codex-zskbp).
 *
 * The page opens the brand-editor store when `getBrandingSettings` resolves.
 * Until then the store has no brand and drops every edit, yet the full rail
 * rendered: a pending or failed read looked like a working editor whose
 * controls changed nothing and whose Save never lit up. Now the rail says it
 * is loading (skeleton rows) or that it couldn't load (with Retry), and the
 * mode switch, controls and Save appear only once the editor opens.
 *
 * Mounts the real `+page.svelte`. `$app/*` and the remote modules are mocked,
 * and the branding read is a double of kit's query, so a Retry hands the page
 * a new query as kit does. The rail, the Guided view and the canvas are inert
 * stubs (their own suites cover them), so `.brand-mode`, which the page
 * renders around the rail, marks an open editor, and the one stub left while
 * it is closed is the canvas.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as m from '$paraglide/messages';
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
  () => import('$lib/components/brand-studio/rail/StubField.test.svelte')
);
vi.mock(
  '$lib/components/brand-studio/guided/BrandStudioGuided.svelte',
  () => import('$lib/components/brand-studio/rail/StubField.test.svelte')
);
vi.mock(
  '$lib/components/brand-studio/BrandStudioCanvas.svelte',
  () => import('$lib/components/brand-studio/rail/StubField.test.svelte')
);

import { brandEditor } from '$lib/brand-editor';
import {
  BRANDING,
  brandingRemote,
  reset,
} from '$lib/components/brand-studio/__fixtures__/branding-remote.mock.svelte';
import {
  flattenControls,
  RAIL_GROUPS,
} from '$lib/components/brand-studio/rail/rail-model';
import { setPage } from '$lib/components/support/__fixtures__/app-state.mock.svelte';
import { logger } from '$lib/observability';
import BrandPage from '../+page.svelte';

const ORG = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Studio Alpha',
  slug: 'studio-alpha',
  description: null,
};

let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  reset();
  setPage('http://studio-alpha.lvh.me:3000/studio/brand');
  vi.spyOn(logger, 'error').mockImplementation(() => {});
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function mountPage() {
  component = mount(BrandPage, {
    target: document.body,
    // The page reads only `org` from its data.
    props: { data: { org: ORG } } as never,
  });
  flushSync();
}

function mountFailed() {
  mountPage();
  brandingRemote().fail();
  flushSync();
}

const q = (selector: string) => document.querySelector(selector);
const pendingRail = () => q('[data-testid="brand-rail-pending"]');
const editor = () => q('.brand-mode');
const stubs = () => document.querySelectorAll('[data-testid="stub-field"]');
const loadError = () => q('[data-testid="brand-load-error"]');
const retryButton = () =>
  loadError()?.querySelector('button') as HTMLButtonElement | null;
/** Lets reads settle and a Retry run on from them, focus moves included. */
const settle = async () => {
  for (let turn = 0; turn < 3; turn++) {
    await new Promise((r) => setTimeout(r, 0));
  }
  flushSync();
};

/** Presses Retry; the page is handed a new branding query, still loading. */
async function pressRetry() {
  const refreshed = brandingRemote().held();
  retryButton()?.focus();
  retryButton()?.click();
  await settle();
  expect(brandingRemote().held()).not.toBe(refreshed);
}

describe('while the branding read is pending', () => {
  test('the rail says it is loading, in skeleton rows shaped like the rail, and offers no editor', () => {
    mountPage();

    const rail = pendingRail();
    expect(rail?.querySelector('h1')?.textContent).toBe(m.branding_title());
    expect(rail?.querySelector('[role="status"]')?.textContent).toBe(
      m.branding_loading()
    );
    // The search box, one label per group, one row per control; all hidden.
    const skeleton = rail?.querySelector('[aria-hidden="true"]');
    expect(skeleton?.querySelectorAll('.skeleton').length).toBe(
      1 + RAIL_GROUPS.length + flattenControls().length
    );

    expect(editor()).toBeNull();
    expect(loadError()).toBeNull();
    expect(brandEditor.pending).toBeNull();
    // The canvas stays: it shows the saved brand either way.
    expect(stubs()).toHaveLength(1);
  });
});

describe('once the branding read lands', () => {
  test('the editor opens with that brand, in place of the pending rail', () => {
    mountPage();
    brandingRemote().land(BRANDING);
    flushSync();

    expect(editor()).not.toBeNull();
    expect(pendingRail()).toBeNull();
    expect(loadError()).toBeNull();
    expect(brandEditor.pending?.primaryColor).toBe(BRANDING.primaryColorHex);
    // The rail (or Guided) beside the canvas.
    expect(stubs()).toHaveLength(2);
  });

  test('the rail waits for the store, not the read: no editor until it opens', () => {
    vi.spyOn(brandEditor, 'open').mockImplementation(() => {});
    mountPage();
    brandingRemote().land(BRANDING);
    flushSync();

    expect(editor()).toBeNull();
    expect(pendingRail()).not.toBeNull();
  });
});

describe('a failed branding read', () => {
  test('says it could not load, with Retry, and offers no editor', () => {
    mountFailed();

    const alert = loadError();
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(alert?.textContent).toContain(m.branding_load_failed());
    expect(retryButton()?.textContent?.trim()).toBe(
      m.money_setup_load_failed_retry()
    );

    // The title stays; nothing says it is still loading.
    const rail = pendingRail();
    expect(rail?.querySelector('h1')?.textContent).toBe(m.branding_title());
    expect(rail?.querySelector('[role="status"]')).toBeNull();
    expect(rail?.querySelector('.skeleton')).toBeNull();

    expect(editor()).toBeNull();
    expect(brandEditor.pending).toBeNull();
    expect(stubs()).toHaveLength(1);
  });

  test('is logged with its reason', () => {
    mountFailed();

    expect(logger.error).toHaveBeenCalledWith(
      'studio/brand: branding failed to load',
      { organizationId: ORG.id, reason: 'Internal Error' }
    );
  });
});

describe('Retry', () => {
  test('keeps the failed rail and the focused Retry while the new query loads', async () => {
    mountFailed();
    await pressRetry();

    const rail = pendingRail();
    expect(rail?.querySelector('.skeleton')).toBeNull();
    expect(rail?.querySelector('[role="status"]')).toBeNull();
    expect(retryButton()?.textContent?.trim()).toBe(
      m.money_setup_load_failed_retrying()
    );
    expect(document.activeElement).toBe(retryButton());
    expect(editor()).toBeNull();
  });

  test('a read that loads opens the editor and says so', async () => {
    mountFailed();
    await pressRetry();

    brandingRemote().land(BRANDING);
    await settle();

    expect(loadError()).toBeNull();
    expect(pendingRail()).toBeNull();
    expect(editor()).not.toBeNull();
    expect(brandEditor.pending?.primaryColor).toBe(BRANDING.primaryColorHex);
    // The alert unmounted with the focused Retry inside it, so focus moves to
    // the status line that says the brand loaded.
    const loaded = [...document.querySelectorAll('[role="status"]')].find(
      (node) => node.textContent?.trim() === m.branding_load_retry_ok()
    );
    expect(loaded).toBeDefined();
    expect(document.activeElement).toBe(loaded);
  });

  test('a read that fails again says so, keeps the editor closed and focuses the alert', async () => {
    mountFailed();
    await pressRetry();

    brandingRemote().fail();
    await settle();

    expect(loadError()?.textContent).toContain(m.branding_load_failed_again());
    expect(pendingRail()?.querySelector('.skeleton')).toBeNull();
    expect(editor()).toBeNull();
    expect(brandEditor.pending).toBeNull();
    expect(document.activeElement?.classList.contains('load-failed')).toBe(
      true
    );
  });
});
