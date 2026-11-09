/**
 * Codex-q01h8 under the real Svelte runtime: leaving the brand studio closes
 * the editor. Its preview flipped the org layout's brand attributes, and
 * `clearBrandVars` strips its brand properties. Svelte re-sets a `style:`
 * directive or an attribute only when its value changes, so nothing put them
 * back: the org lost its brand until a reload. The harness registers the
 * layout's own write-back, `writeBackLayoutBrandInputs`, which restores them
 * after the close. Without it the harness shows the bug, so the test cannot
 * pass for the wrong reason. That the layout registers it is held by
 * routes/_org/[slug]/__tests__/layout-brand-inputs-write-back.test.ts.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { BrandEditorState } from '$lib/brand-editor';
import { brandEditor } from '$lib/brand-editor';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import LayoutBrandInputsHarness from './LayoutBrandInputsHarness.test.svelte';

const ORG_ID = '00000000-0000-4000-8000-000000000000';

// An org with no fine-tune overrides: the case that lost its brand. Its
// pending background is null, so the preview also drops data-org-bg.
const saved: BrandEditorState = {
  primaryColor: '#2563EB',
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
};

describe('the org layout after the brand editor closes', () => {
  let component: ReturnType<typeof mount> | null = null;

  beforeEach(() => {
    brandEditor.close();
  });

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    brandEditor.close();
    document.body.innerHTML = '';
  });

  function openAndLeave(writeBack: boolean): HTMLElement {
    component = mount(LayoutBrandInputsHarness, {
      target: document.body,
      props: { writeBack },
    });
    flushSync();
    brandEditor.open(ORG_ID, saved);
    flushSync();
    brandEditor.close();
    flushSync();
    const el = document.querySelector<HTMLElement>('.org-layout');
    if (!el) throw new Error('harness did not render .org-layout');
    return el;
  }

  test('without the write-back, the layout loses its brand properties and data-org-bg (the bug)', () => {
    const el = openAndLeave(false);

    expect(el.style.getPropertyValue('--brand-color')).toBe('');
    expect(el.style.getPropertyValue('--brand-radius')).toBe('');
    expect(el.hasAttribute('data-org-bg')).toBe(false);
  });

  test('with it, every input and attribute is back', () => {
    const el = openAndLeave(true);

    expect(el.style.getPropertyValue('--brand-color')).toBe('#2563EB');
    expect(el.style.getPropertyValue('--brand-density')).toBe('1');
    expect(el.style.getPropertyValue('--brand-radius')).toBe('0.5rem');
    expect(el.hasAttribute('data-org-brand')).toBe(true);
    expect(el.hasAttribute('data-org-bg')).toBe(true);
  });

  // The brand page opens the editor only once its branding query resolves,
  // but closes it on destroy regardless. Leaving before then, or after the
  // query failed, closes an editor that never opened: `isClosed` never
  // changes, so no write-back can run, and nothing may be stripped.
  test('closing an editor that never opened leaves the brand alone', () => {
    component = mount(LayoutBrandInputsHarness, {
      target: document.body,
      props: { writeBack: true },
    });
    flushSync();
    brandEditor.close();
    flushSync();
    const el = document.querySelector<HTMLElement>('.org-layout');
    if (!el) throw new Error('harness did not render .org-layout');

    expect(el.style.getPropertyValue('--brand-color')).toBe('#2563EB');
    expect(el.style.getPropertyValue('--brand-radius')).toBe('0.5rem');
    expect(el.hasAttribute('data-org-brand')).toBe(true);
    expect(el.hasAttribute('data-org-bg')).toBe(true);
  });
});
