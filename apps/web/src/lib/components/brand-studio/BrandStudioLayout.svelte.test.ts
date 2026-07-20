/**
 * BrandStudioLayout shell render tests (Codex-cijzb WP-1.1).
 *
 * Proves the two-pane workspace shell renders: two labelled regions (control
 * rail + preview canvas), and that the rail/canvas snippets project into the
 * correct regions. Later WPs fill the regions; the shell structure is the
 * contract those WPs build against.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  createRawSnippet,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import BrandStudioLayout from './BrandStudioLayout.svelte';

function railToggle(): HTMLButtonElement | null {
  return document.querySelector('.brand-studio__rail-toggle');
}

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

  test('rail toggle reflects collapsed state and fires onToggleRail', () => {
    const onToggleRail = vi.fn();
    component = mount(BrandStudioLayout, {
      target: document.body,
      props: { railCollapsed: false, onToggleRail },
    });

    // The collapse control lives ON the rail (inside the rail region), not the
    // canvas toolbar — so it can pin an expand affordance when collapsed.
    const toggle = railToggle();
    expect(toggle?.closest('.brand-studio__rail')).toBeTruthy();
    // Expanded: the button offers to hide, aria-expanded=true.
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(toggle?.getAttribute('aria-label')).toBe('Hide controls');
    expect(toggle?.getAttribute('aria-controls')).toBe(
      'brand-studio-rail-body'
    );

    toggle?.click();
    expect(onToggleRail).toHaveBeenCalledTimes(1);
  });

  test('collapsed rail flips the toggle to an expand affordance', () => {
    component = mount(BrandStudioLayout, {
      target: document.body,
      props: { railCollapsed: true, onToggleRail: vi.fn() },
    });

    expect(
      document
        .querySelector('.brand-studio')
        ?.getAttribute('data-rail-collapsed')
    ).toBe('true');
    // The body carries the id the toggle controls — present in the DOM so the
    // strip can re-expand it (hidden via CSS, not removed).
    expect(document.querySelector('#brand-studio-rail-body')).toBeTruthy();
    expect(railToggle()?.getAttribute('aria-expanded')).toBe('false');
    expect(railToggle()?.getAttribute('aria-label')).toBe('Show controls');
  });

  test('omits the rail toggle when no handler is supplied', () => {
    component = mount(BrandStudioLayout, {
      target: document.body,
      props: {},
    });

    expect(railToggle()).toBeNull();
  });
});
