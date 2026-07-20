/**
 * BrandEditorLogo behaviour tests (Codex-cijzb · WP-1.6).
 *
 * BrandEditorLogo is the thin store-adapter around the ONE reusable
 * <LogoUpload> affordance. These tests mount the REAL adapter + REAL
 * <LogoUpload> + REAL brand-editor store, mocking only the remote layer, and
 * prove the reconciled single logo mechanism:
 *   - a successful upload pushes the new URL into the store's `pending.logoUrl`
 *     (so the WP-1.4 preview bridge + change-ledger both see it);
 *   - Remove calls `deleteLogo` (server clears R2 + DB) then clears the field;
 *   - a FAILED delete surfaces the error and leaves the logo intact (never a
 *     silent swallow that would desync the store from the DB).
 *
 * The remote is a reactive $state-backed double (the real one needs
 * `$app/server`); <LogoUpload> receives the mocked `uploadLogoForm` and its
 * success `$effect` fires against it just as in production.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { BrandEditorState } from '$lib/brand-editor';
import { brandEditor } from '$lib/brand-editor';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

vi.mock('$paraglide/messages', () => ({
  branding_logo_title: () => 'Logo',
  branding_logo_upload: () => 'Upload Logo',
  branding_logo_delete: () => 'Remove Logo',
  common_loading: () => 'Loading…',
}));

vi.mock(
  '$lib/remote/branding.remote',
  () => import('./__fixtures__/branding-logo.mock.svelte')
);

import {
  deleteCalls,
  reset,
  setDeleteRejection,
  setUploadPending,
  setUploadResult,
} from './__fixtures__/branding-logo.mock.svelte';
import BrandEditorLogo from './BrandEditorLogo.svelte';

const ORG_ID = '00000000-0000-4000-8000-000000000000';
const EXISTING_LOGO = 'https://cdn.test/old-logo.png';

function makeSaved(
  overrides: Partial<BrandEditorState> = {}
): BrandEditorState {
  return {
    primaryColor: '#3B82F6',
    secondaryColor: null,
    accentColor: null,
    backgroundColor: null,
    fontBody: null,
    fontHeading: null,
    radius: 0.5,
    density: 1,
    logoUrl: null,
    tokenOverrides: {},
    darkOverrides: null,
    darkTokenOverrides: null,
    heroLayout: 'default',
    ...overrides,
  };
}

function removeButton(): HTMLButtonElement {
  const button = [...document.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === 'Remove Logo'
  );
  if (!button) throw new Error('Remove Logo button not found');
  return button as HTMLButtonElement;
}

describe('BrandEditorLogo', () => {
  let component: ReturnType<typeof mount> | null = null;

  beforeEach(() => {
    reset();
    brandEditor.close();
  });

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    brandEditor.close();
    reset();
    document.body.innerHTML = '';
  });

  test('a successful upload sets the store pending.logoUrl', () => {
    brandEditor.open(ORG_ID, makeSaved({ logoUrl: null }));
    component = mount(BrandEditorLogo, { target: document.body });
    flushSync();

    // Simulate the multipart upload completing on the server.
    setUploadPending(0);
    setUploadResult({
      success: true,
      data: { logoUrl: 'https://cdn.test/new-logo.png' },
    });
    flushSync();

    expect(brandEditor.pending?.logoUrl).toBe('https://cdn.test/new-logo.png');
  });

  test('Remove deletes on the server then clears the store field', async () => {
    brandEditor.open(ORG_ID, makeSaved({ logoUrl: EXISTING_LOGO }));
    component = mount(BrandEditorLogo, { target: document.body });
    flushSync();

    removeButton().click();

    await vi.waitFor(() => {
      flushSync();
      expect(deleteCalls).toContain(ORG_ID);
      expect(brandEditor.pending?.logoUrl).toBeNull();
    });
  });

  test('a failed delete surfaces the error and keeps the logo', async () => {
    setDeleteRejection('Cannot remove logo right now');
    brandEditor.open(ORG_ID, makeSaved({ logoUrl: EXISTING_LOGO }));
    component = mount(BrandEditorLogo, { target: document.body });
    flushSync();

    removeButton().click();

    await vi.waitFor(() => {
      flushSync();
      const alert = [...document.querySelectorAll('[role="alert"]')].find(
        (el) => el.textContent?.includes('Cannot remove logo right now')
      );
      expect(alert).toBeTruthy();
    });

    // The server rejected, so the store field must NOT have been cleared.
    expect(deleteCalls).toContain(ORG_ID);
    expect(brandEditor.pending?.logoUrl).toBe(EXISTING_LOGO);
  });
});
