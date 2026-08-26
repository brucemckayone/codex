/**
 * Rail store-integration component tests (Codex-cijzb · WP-1.5).
 *
 * These prove the store-facing behaviours end-to-end against jsdom-safe pieces:
 *   - a REUSED field component (BrandEditorShape) writes the store's pending;
 *   - the change-ledger's per-field Reset reverts only its field;
 *   - the editing-theme + contrast readout flags a low-contrast pair.
 *
 * No module mocks needed — none of these three touch Melt, canvas, or a remote
 * form. The store is the module-level singleton, reset via close()/open().
 */
import { afterEach, describe, expect, test } from 'vitest';
import type { BrandEditorState } from '$lib/brand-editor';
import { brandEditor } from '$lib/brand-editor';
import BrandEditorShape from '$lib/components/brand-editor/levels/BrandEditorShape.svelte';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import ChangeLedger from './ChangeLedger.svelte';
import EditingThemeContrast from './EditingThemeContrast.svelte';

const ORG_ID = '00000000-0000-4000-8000-000000000000';

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

describe('reused field → store pending', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    brandEditor.close();
    document.body.innerHTML = '';
  });

  test('editing the reused radius slider updates the store pending', () => {
    brandEditor.close();
    brandEditor.open(ORG_ID, makeSaved({ radius: 0.5 }));

    component = mount(BrandEditorShape, { target: document.body });
    flushSync();

    const slider = document.querySelector<HTMLInputElement>('#radius-slider');
    if (!slider) throw new Error('radius slider not found');
    slider.value = '1.2';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();

    expect(brandEditor.pending?.radius).toBeCloseTo(1.2, 5);
  });
});

describe('ChangeLedger per-field reset', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    brandEditor.close();
    document.body.innerHTML = '';
  });

  test('resets only the chosen field, leaving other edits intact', () => {
    brandEditor.close();
    brandEditor.open(ORG_ID, makeSaved({ radius: 0.5, density: 1 }));
    // Two independent edits.
    brandEditor.updateField('radius', 1.5);
    brandEditor.updateField('density', 1.2);

    component = mount(ChangeLedger, { target: document.body });
    flushSync();

    // Expand the ledger and confirm both changes are listed.
    document.querySelector<HTMLButtonElement>('.ledger__summary')?.click();
    flushSync();
    const labels = Array.from(document.querySelectorAll('.ledger__label')).map(
      (el) => el.textContent?.trim()
    );
    expect(labels).toEqual(
      expect.arrayContaining(['Corner radius', 'Density'])
    );

    // Reset ONLY the "Corner radius" row.
    const rows = Array.from(document.querySelectorAll('.ledger__item'));
    const radiusRow = rows.find(
      (row) =>
        row.querySelector('.ledger__label')?.textContent?.trim() ===
        'Corner radius'
    );
    radiusRow?.querySelector<HTMLButtonElement>('.ledger__reset')?.click();
    flushSync();

    // radius reverted to saved; density edit preserved.
    expect(brandEditor.pending?.radius).toBe(0.5);
    expect(brandEditor.pending?.density).toBe(1.2);

    // Ledger now lists a single remaining change.
    expect(document.querySelectorAll('.ledger__item')).toHaveLength(1);
  });
});

describe('EditingThemeContrast', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    brandEditor.close();
    document.body.innerHTML = '';
  });

  test('flags a low-contrast brand colour (mid-grey fails AA)', () => {
    brandEditor.close();
    brandEditor.open(ORG_ID, makeSaved({ primaryColor: '#808080' }));

    component = mount(EditingThemeContrast, { target: document.body });
    flushSync();

    const readout = document.querySelector('.contrast');
    expect(readout?.getAttribute('data-passes-aa')).toBe('false');
    expect(readout?.classList.contains('contrast--warn')).toBe(true);
    expect(
      document.querySelector('.contrast__badge')?.textContent?.trim()
    ).toBe('!');
  });

  test('passes a strong dark brand colour', () => {
    brandEditor.close();
    brandEditor.open(ORG_ID, makeSaved({ primaryColor: '#1D4ED8' }));

    component = mount(EditingThemeContrast, { target: document.body });
    flushSync();

    const readout = document.querySelector('.contrast');
    expect(readout?.getAttribute('data-passes-aa')).toBe('true');
    expect(readout?.classList.contains('contrast--warn')).toBe(false);
    expect(
      document.querySelector('.contrast__badge')?.textContent?.trim()
    ).toBe('AA');
  });

  test('the Dark toggle switches the store editing theme', () => {
    brandEditor.close();
    brandEditor.open(ORG_ID, makeSaved());
    expect(brandEditor.editingTheme).toBe('light');

    component = mount(EditingThemeContrast, { target: document.body });
    flushSync();

    const darkBtn = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.seg__btn')
    ).find((btn) => btn.textContent?.includes('Dark'));
    darkBtn?.click();
    flushSync();

    expect(brandEditor.editingTheme).toBe('dark');
  });
});
