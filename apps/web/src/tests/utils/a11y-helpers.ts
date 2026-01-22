/**
 * Accessibility Testing Helpers
 *
 * Utilities for verifying a11y compliance in Vitest.
 */

import { expect } from 'vitest';

/**
 * Basic keyboard navigation simulator
 *
 * @param element - The element to interact with
 * @param key - The key to press (default: Tab)
 */
export async function simulateKeyboardNav(
  element: HTMLElement,
  key: string = 'Tab'
) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
  });
  element.dispatchEvent(event);
}

/**
 * Helper to check for screen reader text
 *
 * @param container - The container to search in
 * @param text - The text to look for
 */
export function expectScreenReaderText(container: HTMLElement, text: string) {
  // Look for elements with sr-only class or similar
  const srElements = container.querySelectorAll('.sr-only');
  const found = Array.from(srElements).some((el) =>
    el.textContent?.includes(text)
  );

  if (!found) {
    throw new Error(
      `Screen reader text "${text}" not found in .sr-only elements`
    );
  }
}

/**
 * Placeholder for axe-core analysis
 * NOTE: requires axe-core to be properly configured for Vitest environment
 */
export async function checkA11y(container: HTMLElement) {
  // In a real setup, we would use axe-core here
  // For now, this is a placeholder to establish the pattern
  console.log('A11y check triggered for container', container.tagName);
  return true;
}
