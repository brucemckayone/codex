/**
 * BrandStudioLayout shell render tests (Codex-cijzb WP-1.1).
 *
 * Proves the two-pane workspace shell renders: two labelled regions (control
 * rail + preview canvas), and that the rail/canvas snippets project into the
 * correct regions. Later WPs fill the regions; the shell structure is the
 * contract those WPs build against.
 */
import { afterEach, describe, expect, test } from 'vitest';
import {
  createRawSnippet,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import BrandStudioLayout from './BrandStudioLayout.svelte';

describe('BrandStudioLayout', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('renders the rail and canvas regions with their snippet content', () => {
    const rail = createRawSnippet(() => ({
      render: () => '<span data-testid="rail-slot">rail</span>',
    }));
    const canvas = createRawSnippet(() => ({
      render: () => '<span data-testid="canvas-slot">canvas</span>',
    }));

    component = mount(BrandStudioLayout, {
      target: document.body,
      props: { rail, canvas },
    });

    expect(document.querySelector('.brand-studio')).toBeTruthy();
    expect(
      document.querySelector('.brand-studio__rail[aria-label="Brand controls"]')
    ).toBeTruthy();
    expect(
      document.querySelector(
        '.brand-studio__canvas[aria-label="Brand preview"]'
      )
    ).toBeTruthy();

    // Snippets project into the correct regions.
    const railSlot = document.querySelector('[data-testid="rail-slot"]');
    const canvasSlot = document.querySelector('[data-testid="canvas-slot"]');
    expect(railSlot?.closest('.brand-studio__rail')).toBeTruthy();
    expect(canvasSlot?.closest('.brand-studio__canvas')).toBeTruthy();
  });

  test('renders both regions even without snippet content', () => {
    component = mount(BrandStudioLayout, {
      target: document.body,
      props: {},
    });

    expect(document.querySelectorAll('.brand-studio > section')).toHaveLength(
      2
    );
  });
});
