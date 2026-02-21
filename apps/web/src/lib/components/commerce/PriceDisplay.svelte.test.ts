import { afterEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount } from '$tests/utils/component-test-utils.svelte';
import PriceDisplay from './PriceDisplay.svelte';

// Mock paraglide messages module
vi.mock('$paraglide/messages', () => ({
  commerce_free: () => 'Free',
}));

describe('PriceDisplay', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  describe('Success Paths', () => {
    test('renders "Free" text when priceCents is null', () => {
      component = mount(PriceDisplay, {
        target: document.body,
        props: { priceCents: null },
      });

      const span = document.body.querySelector('.price-display');
      expect(span).toBeTruthy();
      expect(span?.textContent).toBe('Free');
    });

    test('renders "Free" text when priceCents is 0', () => {
      component = mount(PriceDisplay, {
        target: document.body,
        props: { priceCents: 0 },
      });

      const span = document.body.querySelector('.price-display');
      expect(span).toBeTruthy();
      expect(span?.textContent).toBe('Free');
    });

    test('renders formatted price for valid cent values (999 -> "£9.99")', () => {
      component = mount(PriceDisplay, {
        target: document.body,
        props: { priceCents: 999 },
      });

      const span = document.body.querySelector('.price-display');
      expect(span).toBeTruthy();
      expect(span?.textContent).toBe('£9.99');
    });

    test('renders formatted price for large values (99999 -> "£999.99")', () => {
      component = mount(PriceDisplay, {
        target: document.body,
        props: { priceCents: 99999 },
      });

      const span = document.body.querySelector('.price-display');
      expect(span).toBeTruthy();
      expect(span?.textContent).toBe('£999.99');
    });

    test('applies correct CSS class for size="sm"', () => {
      component = mount(PriceDisplay, {
        target: document.body,
        props: { priceCents: 1000, size: 'sm' },
      });

      const span = document.body.querySelector('.price-display');
      expect(span?.classList.contains('price-display--sm')).toBe(true);
      expect(span?.classList.contains('price-display--md')).toBe(false);
      expect(span?.classList.contains('price-display--lg')).toBe(false);
    });

    test('applies correct CSS class for size="md" - default', () => {
      component = mount(PriceDisplay, {
        target: document.body,
        props: { priceCents: 1000 },
      });

      const span = document.body.querySelector('.price-display');
      expect(span?.classList.contains('price-display--sm')).toBe(false);
      expect(span?.classList.contains('price-display--md')).toBe(true);
      expect(span?.classList.contains('price-display--lg')).toBe(false);
    });

    test('applies correct CSS class for size="lg"', () => {
      component = mount(PriceDisplay, {
        target: document.body,
        props: { priceCents: 1000, size: 'lg' },
      });

      const span = document.body.querySelector('.price-display');
      expect(span?.classList.contains('price-display--sm')).toBe(false);
      expect(span?.classList.contains('price-display--md')).toBe(false);
      expect(span?.classList.contains('price-display--lg')).toBe(true);
    });

    test('forwards additional HTML attributes to the span element', () => {
      component = mount(PriceDisplay, {
        target: document.body,
        props: {
          priceCents: 1000,
          'data-testid': 'price-123',
          id: 'my-price',
          'aria-label': 'Product price',
        },
      });

      const span = document.body.querySelector('.price-display');
      expect(span?.getAttribute('data-testid')).toBe('price-123');
      expect(span?.getAttribute('id')).toBe('my-price');
      expect(span?.getAttribute('aria-label')).toBe('Product price');
    });

    test('merges custom class names with default classes', () => {
      component = mount(PriceDisplay, {
        target: document.body,
        props: {
          priceCents: 1000,
          class: 'custom-price-class another-class',
        },
      });

      const span = document.body.querySelector('.price-display');
      expect(span?.classList.contains('price-display')).toBe(true);
      expect(span?.classList.contains('price-display--md')).toBe(true);
      expect(span?.classList.contains('custom-price-class')).toBe(true);
      expect(span?.classList.contains('another-class')).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    test('handles negative prices (formats with minus sign)', () => {
      component = mount(PriceDisplay, {
        target: document.body,
        props: { priceCents: -500 },
      });

      const span = document.body.querySelector('.price-display');
      expect(span).toBeTruthy();
      expect(span?.textContent).toBe('-£5.00');
    });
  });

  describe('Component Structure', () => {
    test('renders as span element', () => {
      component = mount(PriceDisplay, {
        target: document.body,
        props: { priceCents: 1000 },
      });

      const element = document.body.querySelector('.price-display');
      expect(element?.tagName.toLowerCase()).toBe('span');
    });

    test('always includes base price-display class', () => {
      component = mount(PriceDisplay, {
        target: document.body,
        props: { priceCents: 1000, size: 'lg' },
      });

      const span = document.body.querySelector('.price-display');
      expect(span?.classList.contains('price-display')).toBe(true);
    });
  });
});
