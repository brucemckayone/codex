/**
 * Component Testing Utilities for Svelte 5
 *
 * Uses Svelte's native imperative API (mount/unmount) instead of @testing-library/svelte.
 * This avoids issues with runes in uncompiled node_modules packages.
 *
 * @example
 * ```ts
 * import { mount, unmount, createRawSnippet } from 'svelte';
 * import { textSnippet } from '$tests/utils/component-test-utils.svelte';
 * import Button from './Button.svelte';
 *
 * test('renders button', () => {
 *   const component = mount(Button, {
 *     target: document.body,
 *     props: { children: textSnippet('Click me') }
 *   });
 *   // ... assertions
 *   unmount(component);
 * });
 * ```
 */

import { createRawSnippet } from 'svelte';

/**
 * Create a simple text snippet for component testing.
 * Useful for components that expect a `children` snippet prop.
 *
 * @param text - The text content to render
 * @returns A Snippet that renders the text wrapped in a span
 */
export function textSnippet(text: string) {
  return createRawSnippet(() => ({
    render: () => `<span>${text}</span>`,
  }));
}

/**
 * Create a raw HTML snippet for component testing.
 * Use with caution - HTML is not escaped.
 *
 * @param html - The HTML string to render
 * @returns A Snippet that renders the HTML directly
 */
export function htmlSnippet(html: string) {
  return createRawSnippet(() => ({
    render: () => html,
  }));
}

/**
 * Wait for a specific duration (promisified)
 */
export const wait = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Query helpers for common DOM operations in tests.
 * These provide a simpler API than raw querySelector.
 */
export const screen = {
  /** Get element by role attribute or semantic role */
  getByRole: (role: string, options?: { name?: string | RegExp }) => {
    const selector = `[role="${role}"], ${role}`;
    const elements = document.body.querySelectorAll(selector);

    // Also check semantic elements (button, link, etc.)
    const semanticMap: Record<string, string> = {
      button: 'button, [type="button"], [type="submit"]',
      link: 'a[href]',
      textbox: 'input[type="text"], input:not([type]), textarea',
      checkbox: 'input[type="checkbox"]',
      heading: 'h1, h2, h3, h4, h5, h6',
    };

    const semanticSelector = semanticMap[role];
    const allElements = semanticSelector
      ? [...elements, ...document.body.querySelectorAll(semanticSelector)]
      : [...elements];

    if (options?.name) {
      const nameFilter =
        typeof options.name === 'string'
          ? (el: Element) =>
              el.textContent?.includes(options.name as string) ||
              el.getAttribute('aria-label')?.includes(options.name as string)
          : (el: Element) =>
              (options.name as RegExp).test(el.textContent || '') ||
              (options.name as RegExp).test(
                el.getAttribute('aria-label') || ''
              );
      return allElements.find(nameFilter) || null;
    }

    return allElements[0] || null;
  },

  /** Get element by test ID data attribute */
  getByTestId: (testId: string) =>
    document.body.querySelector(`[data-testid="${testId}"]`),

  /** Get element by text content */
  getByText: (text: string | RegExp) => {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT
    );
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const matches =
        typeof text === 'string'
          ? node.textContent?.includes(text)
          : text.test(node.textContent || '');
      if (matches && node.parentElement) {
        return node.parentElement;
      }
    }
    return null;
  },
};

// Re-export Svelte's imperative API for convenience
export { createRawSnippet, flushSync, mount, unmount } from 'svelte';
