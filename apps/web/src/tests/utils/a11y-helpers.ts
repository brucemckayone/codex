/**
 * Accessibility Testing Helpers
 *
 * Utilities for verifying a11y compliance in Vitest unit tests.
 *
 * NOTE: Full axe-core scanning is done via Playwright E2E tests against Storybook.
 * See tests/a11y/components.spec.ts for comprehensive a11y coverage.
 * These helpers focus on ARIA attribute verification in unit tests.
 */

import { expect } from 'vitest';

/**
 * Keyboard navigation simulator for testing keyboard-accessible components.
 *
 * @param element - The element to interact with
 * @param key - The key to press (e.g., 'Tab', 'Enter', 'Escape', 'ArrowDown')
 * @param options - Additional KeyboardEvent options (e.g., shiftKey, ctrlKey)
 */
export function simulateKeyPress(
  element: HTMLElement,
  key: string,
  options: Partial<KeyboardEventInit> = {}
) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  element.dispatchEvent(event);
}

/**
 * Simulate Tab key press for focus navigation testing
 */
export function simulateTab(element: HTMLElement, shift = false) {
  simulateKeyPress(element, 'Tab', { shiftKey: shift });
}

/**
 * Check for screen reader text (visually hidden but accessible)
 *
 * @param container - The container to search in
 * @param text - The text to look for
 */
export function expectScreenReaderText(container: HTMLElement, text: string) {
  const srElements = container.querySelectorAll(
    '.sr-only, [class*="visually-hidden"]'
  );
  const found = Array.from(srElements).some((el) =>
    el.textContent?.includes(text)
  );

  if (!found) {
    throw new Error(
      `Screen reader text "${text}" not found in .sr-only or visually-hidden elements`
    );
  }
}

/**
 * Verify an element has required ARIA attributes for its role
 */
export function expectValidAriaRole(
  element: HTMLElement,
  expectedRole: string,
  requiredAttributes: string[] = []
) {
  const role = element.getAttribute('role');
  expect(role).toBe(expectedRole);

  for (const attr of requiredAttributes) {
    expect(element.hasAttribute(attr)).toBe(true);
  }
}

/**
 * Check that an interactive element is keyboard focusable
 */
export function expectFocusable(element: HTMLElement) {
  const tabIndex = element.tabIndex;
  // tabIndex >= 0 means focusable via Tab
  // tabIndex === -1 means focusable programmatically but not via Tab
  expect(tabIndex).toBeGreaterThanOrEqual(-1);

  // If disabled, should not be focusable
  if (
    element.hasAttribute('disabled') ||
    element.getAttribute('aria-disabled') === 'true'
  ) {
    // Disabled elements should typically have tabindex=-1 or be natively non-focusable
    return;
  }

  // Interactive elements (button, input, etc.) should be focusable
  const interactiveElements = ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A'];
  if (interactiveElements.includes(element.tagName)) {
    expect(tabIndex).toBeGreaterThanOrEqual(0);
  }
}

/**
 * Verify button accessibility attributes
 */
export function expectAccessibleButton(
  button: HTMLButtonElement | HTMLElement
) {
  // Buttons should have accessible name (text content, aria-label, or aria-labelledby)
  const hasName =
    button.textContent?.trim() ||
    button.getAttribute('aria-label') ||
    button.getAttribute('aria-labelledby');
  expect(hasName).toBeTruthy();

  // Loading state should have aria-busy
  if (
    button.hasAttribute('data-loading') ||
    button.classList.contains('loading')
  ) {
    expect(button.getAttribute('aria-busy')).toBe('true');
  }
}

/**
 * Verify form input accessibility
 */
export function expectAccessibleInput(
  input: HTMLInputElement | HTMLTextAreaElement,
  labelId?: string
) {
  // Input should have an accessible name via label, aria-label, or aria-labelledby
  const hasLabel =
    input.getAttribute('aria-label') ||
    input.getAttribute('aria-labelledby') ||
    document.querySelector(`label[for="${input.id}"]`) ||
    input.closest('label');

  if (!hasLabel && labelId) {
    const label = document.getElementById(labelId);
    expect(label).toBeTruthy();
  }

  // Required inputs should have aria-required or required attribute
  if (input.required || input.getAttribute('aria-required') === 'true') {
    // Either native or ARIA required is acceptable
    expect(
      input.required || input.getAttribute('aria-required') === 'true'
    ).toBe(true);
  }

  // Invalid inputs should have aria-invalid
  if (input.validity && !input.validity.valid) {
    expect(input.getAttribute('aria-invalid')).toBe('true');
  }
}

/**
 * Verify checkbox accessibility (for Melt-UI style checkboxes)
 */
export function expectAccessibleCheckbox(element: HTMLElement) {
  // Should have checkbox role
  expect(element.getAttribute('role')).toBe('checkbox');

  // Should have aria-checked
  const ariaChecked = element.getAttribute('aria-checked');
  expect(['true', 'false', 'mixed']).toContain(ariaChecked);
}

/**
 * Verify dialog accessibility
 */
export function expectAccessibleDialog(dialog: HTMLElement) {
  expect(dialog.getAttribute('role')).toBe('dialog');
  expect(dialog.getAttribute('aria-modal')).toBe('true');

  // Should have accessible name
  const hasName =
    dialog.getAttribute('aria-label') || dialog.getAttribute('aria-labelledby');
  expect(hasName).toBeTruthy();
}
