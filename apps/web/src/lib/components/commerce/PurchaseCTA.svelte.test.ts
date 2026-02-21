import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  mount,
  textSnippet,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import PurchaseCTA from './PurchaseCTA.svelte';

// Mock paraglide messages module
vi.mock('$paraglide/messages', () => ({
  commerce_free: () => 'Free',
  commerce_purchased: () => 'Purchased',
  commerce_watch_now: () => 'Watch Now',
  commerce_guarantee: () => '30-day money-back guarantee',
  commerce_buy_now: () => 'Buy Now',
  commerce_redirecting: () => 'Redirecting to checkout...',
  commerce_checkout_failed: () => 'Checkout failed',
}));

describe('PurchaseCTA', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  const CONTENT_ID = '123e4567-e89b-12d3-a456-426614174000';

  describe('State: Paid Content (default)', () => {
    test('displays PriceDisplay with given price', () => {
      component = mount(PurchaseCTA, {
        target: document.body,
        props: {
          contentId: CONTENT_ID,
          priceCents: 999,
        },
      });

      const priceDisplay = document.body.querySelector('.price-display');
      expect(priceDisplay).toBeTruthy();
      expect(priceDisplay?.textContent).toBe('£9.99');
    });

    test('displays PurchaseButton with correct contentId', () => {
      component = mount(PurchaseCTA, {
        target: document.body,
        props: {
          contentId: CONTENT_ID,
          priceCents: 1999,
        },
      });

      const purchaseButton = document.body.querySelector('.purchase-button');
      expect(purchaseButton).toBeTruthy();
    });

    test('displays guarantee text', () => {
      component = mount(PurchaseCTA, {
        target: document.body,
        props: {
          contentId: CONTENT_ID,
          priceCents: 999,
        },
      });

      const guaranteeText = document.body.querySelector(
        '.purchase-cta-guarantee'
      );
      expect(guaranteeText).toBeTruthy();
      expect(guaranteeText?.textContent).toBe('30-day money-back guarantee');
    });

    test('has purchase-cta-paid class on inner container', () => {
      component = mount(PurchaseCTA, {
        target: document.body,
        props: {
          contentId: CONTENT_ID,
          priceCents: 999,
        },
      });

      const paidContainer = document.body.querySelector('.purchase-cta-paid');
      expect(paidContainer).toBeTruthy();
      expect(document.body.querySelector('.purchase-cta-owned')).toBeNull();
      expect(document.body.querySelector('.purchase-cta-free')).toBeNull();
    });
  });

  describe('State: Purchased (isPurchased=true)', () => {
    test('displays "Purchased" Badge with variant="success"', () => {
      component = mount(PurchaseCTA, {
        target: document.body,
        props: {
          contentId: CONTENT_ID,
          priceCents: 999,
          isPurchased: true,
        },
      });

      const badge = document.body.querySelector('.badge');
      expect(badge).toBeTruthy();
      expect(badge?.getAttribute('data-variant')).toBe('success');
      expect(badge?.textContent).toContain('Purchased');
    });

    test('displays "Watch Now" button', () => {
      component = mount(PurchaseCTA, {
        target: document.body,
        props: {
          contentId: CONTENT_ID,
          priceCents: 999,
          isPurchased: true,
          watchUrl: '/watch/123',
        },
      });

      const watchButton = document.body.querySelector('.purchase-cta-watch');
      expect(watchButton).toBeTruthy();
      expect(watchButton?.textContent).toContain('Watch Now');
    });

    test('does NOT display PriceDisplay', () => {
      component = mount(PurchaseCTA, {
        target: document.body,
        props: {
          contentId: CONTENT_ID,
          priceCents: 999,
          isPurchased: true,
        },
      });

      const priceDisplay = document.body.querySelector('.price-display');
      expect(priceDisplay).toBeNull();
    });

    test('does NOT display PurchaseButton', () => {
      component = mount(PurchaseCTA, {
        target: document.body,
        props: {
          contentId: CONTENT_ID,
          priceCents: 999,
          isPurchased: true,
        },
      });

      const purchaseButton = document.body.querySelector('.purchase-button');
      expect(purchaseButton).toBeNull();
    });

    test('does NOT display guarantee text', () => {
      component = mount(PurchaseCTA, {
        target: document.body,
        props: {
          contentId: CONTENT_ID,
          priceCents: 999,
          isPurchased: true,
        },
      });

      const guaranteeText = document.body.querySelector(
        '.purchase-cta-guarantee'
      );
      expect(guaranteeText).toBeNull();
    });

    test('has purchase-cta-owned class on inner container', () => {
      component = mount(PurchaseCTA, {
        target: document.body,
        props: {
          contentId: CONTENT_ID,
          priceCents: 999,
          isPurchased: true,
        },
      });

      const ownedContainer = document.body.querySelector('.purchase-cta-owned');
      expect(ownedContainer).toBeTruthy();
      expect(document.body.querySelector('.purchase-cta-paid')).toBeNull();
      expect(document.body.querySelector('.purchase-cta-free')).toBeNull();
    });
  });

  describe('State: Free Content (priceCents=0 or null)', () => {
    test('displays "Free" Badge with variant="neutral" when priceCents=0', () => {
      component = mount(PurchaseCTA, {
        target: document.body,
        props: {
          contentId: CONTENT_ID,
          priceCents: 0,
        },
      });

      const badge = document.body.querySelector('.badge');
      expect(badge).toBeTruthy();
      expect(badge?.getAttribute('data-variant')).toBe('neutral');
      expect(badge?.textContent).toContain('Free');
    });

    test('displays "Free" Badge with variant="neutral" when priceCents=null', () => {
      component = mount(PurchaseCTA, {
        target: document.body,
        props: {
          contentId: CONTENT_ID,
          priceCents: null,
        },
      });

      const badge = document.body.querySelector('.badge');
      expect(badge).toBeTruthy();
      expect(badge?.getAttribute('data-variant')).toBe('neutral');
      expect(badge?.textContent).toContain('Free');
    });

    test('displays "Watch Now" button for free content', () => {
      component = mount(PurchaseCTA, {
        target: document.body,
        props: {
          contentId: CONTENT_ID,
          priceCents: 0,
          watchUrl: '/watch/free-content',
        },
      });

      const watchButton = document.body.querySelector('.purchase-cta-watch');
      expect(watchButton).toBeTruthy();
      expect(watchButton?.textContent).toContain('Watch Now');
    });

    test('does NOT display PriceDisplay for free content', () => {
      component = mount(PurchaseCTA, {
        target: document.body,
        props: {
          contentId: CONTENT_ID,
          priceCents: 0,
        },
      });

      const priceDisplay = document.body.querySelector('.price-display');
      expect(priceDisplay).toBeNull();
    });

    test('does NOT display PurchaseButton for free content', () => {
      component = mount(PurchaseCTA, {
        target: document.body,
        props: {
          contentId: CONTENT_ID,
          priceCents: 0,
        },
      });

      const purchaseButton = document.body.querySelector('.purchase-button');
      expect(purchaseButton).toBeNull();
    });

    test('has purchase-cta-free class on inner container', () => {
      component = mount(PurchaseCTA, {
        target: document.body,
        props: {
          contentId: CONTENT_ID,
          priceCents: 0,
        },
      });

      const freeContainer = document.body.querySelector('.purchase-cta-free');
      expect(freeContainer).toBeTruthy();
      expect(document.body.querySelector('.purchase-cta-paid')).toBeNull();
      expect(document.body.querySelector('.purchase-cta-owned')).toBeNull();
    });
  });

  describe('Size Variants', () => {
    test('has correct size class for sm', () => {
      component = mount(PurchaseCTA, {
        target: document.body,
        props: {
          contentId: CONTENT_ID,
          priceCents: 999,
          size: 'sm',
        },
      });

      const container = document.body.querySelector('.purchase-cta');
      expect(container?.classList.contains('purchase-cta--sm')).toBe(true);
      expect(container?.classList.contains('purchase-cta--md')).toBe(false);
      expect(container?.classList.contains('purchase-cta--lg')).toBe(false);
    });

    test('has correct size class for md (default)', () => {
      component = mount(PurchaseCTA, {
        target: document.body,
        props: {
          contentId: CONTENT_ID,
          priceCents: 999,
        },
      });

      const container = document.body.querySelector('.purchase-cta');
      expect(container?.classList.contains('purchase-cta--sm')).toBe(false);
      expect(container?.classList.contains('purchase-cta--md')).toBe(true);
      expect(container?.classList.contains('purchase-cta--lg')).toBe(false);
    });

    test('has correct size class for lg', () => {
      component = mount(PurchaseCTA, {
        target: document.body,
        props: {
          contentId: CONTENT_ID,
          priceCents: 999,
          size: 'lg',
        },
      });

      const container = document.body.querySelector('.purchase-cta');
      expect(container?.classList.contains('purchase-cta--sm')).toBe(false);
      expect(container?.classList.contains('purchase-cta--md')).toBe(false);
      expect(container?.classList.contains('purchase-cta--lg')).toBe(true);
    });

    test('passes size to watch button data-size attribute', () => {
      component = mount(PurchaseCTA, {
        target: document.body,
        props: {
          contentId: CONTENT_ID,
          priceCents: 0,
          size: 'lg',
        },
      });

      const watchButton = document.body.querySelector('.purchase-cta-watch');
      expect(watchButton?.getAttribute('data-size')).toBe('lg');
    });
  });

  describe('Children Snippet', () => {
    test('renders children snippet when provided', () => {
      component = mount(PurchaseCTA, {
        target: document.body,
        props: {
          contentId: CONTENT_ID,
          priceCents: 999,
          children: textSnippet('Bonus content included!'),
        },
      });

      const childrenContainer = document.body.querySelector(
        '.purchase-cta-children'
      );
      expect(childrenContainer).toBeTruthy();
      expect(childrenContainer?.textContent).toContain(
        'Bonus content included!'
      );
    });

    test('does not render children container when no children provided', () => {
      component = mount(PurchaseCTA, {
        target: document.body,
        props: {
          contentId: CONTENT_ID,
          priceCents: 999,
        },
      });

      const childrenContainer = document.body.querySelector(
        '.purchase-cta-children'
      );
      expect(childrenContainer).toBeNull();
    });
  });

  describe('Watch Button Click Behavior', () => {
    test('navigates to watchUrl when clicked for purchased content', () => {
      const mockHref = vi.fn();
      Object.defineProperty(window, 'location', {
        value: { href: '' },
        writable: true,
      });

      component = mount(PurchaseCTA, {
        target: document.body,
        props: {
          contentId: CONTENT_ID,
          priceCents: 999,
          isPurchased: true,
          watchUrl: '/watch/my-content',
        },
      });

      const watchButton = document.body.querySelector(
        '.purchase-cta-watch'
      ) as HTMLButtonElement;
      watchButton?.click();

      expect(window.location.href).toBe('/watch/my-content');
    });

    test('navigates to watchUrl when clicked for free content', () => {
      Object.defineProperty(window, 'location', {
        value: { href: '' },
        writable: true,
      });

      component = mount(PurchaseCTA, {
        target: document.body,
        props: {
          contentId: CONTENT_ID,
          priceCents: 0,
          watchUrl: '/watch/free-content',
        },
      });

      const watchButton = document.body.querySelector(
        '.purchase-cta-watch'
      ) as HTMLButtonElement;
      watchButton?.click();

      expect(window.location.href).toBe('/watch/free-content');
    });
  });

  describe('Component Structure', () => {
    test('renders as div element with purchase-cta class', () => {
      component = mount(PurchaseCTA, {
        target: document.body,
        props: {
          contentId: CONTENT_ID,
          priceCents: 999,
        },
      });

      const container = document.body.querySelector('.purchase-cta');
      expect(container?.tagName.toLowerCase()).toBe('div');
      expect(container?.classList.contains('purchase-cta')).toBe(true);
    });

    test('merges custom class names with default classes', () => {
      component = mount(PurchaseCTA, {
        target: document.body,
        props: {
          contentId: CONTENT_ID,
          priceCents: 999,
          class: 'custom-class another-class',
        },
      });

      const container = document.body.querySelector('.purchase-cta');
      expect(container?.classList.contains('purchase-cta')).toBe(true);
      expect(container?.classList.contains('custom-class')).toBe(true);
      expect(container?.classList.contains('another-class')).toBe(true);
    });

    test('forwards additional HTML attributes to container', () => {
      component = mount(PurchaseCTA, {
        target: document.body,
        props: {
          contentId: CONTENT_ID,
          priceCents: 999,
          'data-testid': 'purchase-cta-123',
          id: 'my-purchase-cta',
        },
      });

      const container = document.body.querySelector('.purchase-cta');
      expect(container?.getAttribute('data-testid')).toBe('purchase-cta-123');
      expect(container?.getAttribute('id')).toBe('my-purchase-cta');
    });
  });
});
