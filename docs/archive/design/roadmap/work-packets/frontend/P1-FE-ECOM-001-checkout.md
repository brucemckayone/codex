# P1-FE-ECOM-001: Checkout

**Priority**: P1
**Status**: 🚧 Not Started
**Estimated Effort**: 2-3 days
**Beads Task**: Codex-vw8.8

---

## Table of Contents

- [Overview](#overview)
- [System Context](#system-context)
- [Checkout Flow](#checkout-flow)
- [Components](#components)
- [Success & Error Pages](#success--error-pages)
- [Remote Functions](#remote-functions)
- [Dependencies](#dependencies)
- [Implementation Checklist](#implementation-checklist)
- [Testing Strategy](#testing-strategy)

---

## Overview

This work packet implements the purchase flow using Stripe Checkout. When a user clicks "Buy", we create a Stripe Checkout session on the server and redirect them to Stripe's hosted payment page. After payment, Stripe redirects back to our success/cancel pages.

Key features:
- **Stripe Checkout redirect**: PCI-compliant payment collection
- **Server-side session creation**: Secure checkout initialization
- **Success page**: Purchase confirmation with content access
- **Cancel page**: User-friendly cancellation handling
- **Optimistic UI**: Show loading state during redirect

---

## System Context

### Upstream Dependencies

| System | What We Consume |
|--------|-----------------|
| **Ecom-API** (port 42072) | Checkout session creation |
| **P1-FE-CONTENT-001** | PurchaseCTA component integration |
| **P1-FE-FOUNDATION-002** | Button, Badge components |

### Downstream Consumers

| System | What We Provide |
|--------|-----------------|
| **P1-FE-ACCESS-001** | Purchase triggers access grant |
| **P1-FE-CONTENT-001** | After purchase, user has full access |

### Checkout Flow

```
Content Page (no access)
    │
    ▼ User clicks "Buy Now"
    │
PurchaseButton component
    │
    ▼ POST to /api/checkout/session (via Remote Function)
    │
Ecom-API Worker
    ├── Validate content price
    ├── Create Stripe Checkout Session
    └── Return session URL
    │
    ▼ Redirect to Stripe Checkout
    │
Stripe Hosted Page
    ├── User enters payment details
    └── Stripe processes payment
    │
    ├─── Success → Redirect to /purchase/success?session_id=xxx
    │                    │
    │                    ▼ Verify session, show confirmation
    │
    └─── Cancel → Redirect to /purchase/cancel
                      │
                      ▼ Show cancellation message
```

---

## Checkout Flow

### Route Structure

```
src/routes/(platform)/purchase/
├── success/
│   ├── +page.svelte       # Success confirmation
│   └── +page.server.ts    # Verify session, get content
└── cancel/
    ├── +page.svelte       # Cancellation message
    └── +page.server.ts

src/lib/components/commerce/
├── PurchaseButton.svelte  # Buy button with checkout
├── PriceDisplay.svelte    # Formatted price
└── PurchaseSuccess.svelte # Success card
```

### PurchaseButton.svelte

```svelte
<!-- src/lib/components/commerce/PurchaseButton.svelte -->
<script lang="ts">
  import { createCheckoutSession } from './checkout.remote';
  import Button from '$lib/components/ui/Button/Button.svelte';
  import * as m from '$paraglide/messages';

  interface Props {
    content: {
      id: string;
      title: string;
      price: number;
      currency: string;
    };
    variant?: 'default' | 'prominent';
  }

  let { content, variant = 'default' }: Props = $props();

  let loading = $state(false);
  let error = $state<string | null>(null);

  async function handleClick() {
    loading = true;
    error = null;

    try {
      const result = await createCheckoutSession({
        contentId: content.id,
        successUrl: `${window.location.origin}/purchase/success?content=${content.id}`,
        cancelUrl: window.location.href
      });

      if (result.url) {
        // Redirect to Stripe
        window.location.href = result.url;
      } else {
        error = m.checkout_error_generic();
        loading = false;
      }
    } catch (e) {
      error = m.checkout_error_generic();
      loading = false;
    }
  }

  function formatPrice(amount: number, currency: string): string {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency
    }).format(amount / 100);
  }
</script>

<div class="purchase-button" class:prominent={variant === 'prominent'}>
  <Button
    onclick={handleClick}
    {loading}
    disabled={loading}
    size={variant === 'prominent' ? 'lg' : 'md'}
  >
    {#if loading}
      {m.checkout_redirecting()}
    {:else}
      {m.checkout_buy_for({ price: formatPrice(content.price, content.currency) })}
    {/if}
  </Button>

  {#if error}
    <p class="error">{error}</p>
  {/if}
</div>

<style>
  .purchase-button {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .purchase-button.prominent {
    padding: var(--space-4);
    background: var(--color-surface);
    border-radius: var(--radius-lg);
    text-align: center;
  }

  .error {
    color: var(--color-error);
    font-size: var(--text-sm);
  }
</style>
```

### PurchaseCTA.svelte

```svelte
<!-- src/lib/components/commerce/PurchaseCTA.svelte -->
<script lang="ts">
  import PurchaseButton from './PurchaseButton.svelte';
  import PriceDisplay from './PriceDisplay.svelte';
  import Badge from '$lib/components/ui/Badge/Badge.svelte';
  import * as m from '$paraglide/messages';

  interface Props {
    content: {
      id: string;
      title: string;
      price: number;
      currency: string;
    };
    variant?: 'default' | 'prominent';
  }

  let { content, variant = 'default' }: Props = $props();

  const isFree = content.price === 0;
</script>

<div class="purchase-cta" class:prominent={variant === 'prominent'}>
  {#if isFree}
    <Badge variant="success">{m.purchase_free()}</Badge>
    <p class="hint">{m.purchase_free_signin_hint()}</p>
  {:else}
    <PriceDisplay price={content.price} currency={content.currency} />
    <PurchaseButton {content} {variant} />
    <p class="guarantee">{m.purchase_guarantee()}</p>
  {/if}
</div>

<style>
  .purchase-cta {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .purchase-cta.prominent {
    padding: var(--space-6);
    background: var(--color-surface);
    border-radius: var(--radius-lg);
    border: 1px solid var(--color-border);
  }

  .hint, .guarantee {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }
</style>
```

### PriceDisplay.svelte

```svelte
<!-- src/lib/components/commerce/PriceDisplay.svelte -->
<script lang="ts">
  interface Props {
    price: number;
    currency: string;
    size?: 'sm' | 'md' | 'lg';
  }

  let { price, currency, size = 'md' }: Props = $props();

  const formatted = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency
  }).format(price / 100);
</script>

<span class="price" data-size={size}>{formatted}</span>

<style>
  .price {
    font-weight: var(--font-bold);
    color: var(--color-text);
  }

  .price[data-size="sm"] {
    font-size: var(--text-base);
  }

  .price[data-size="md"] {
    font-size: var(--text-xl);
  }

  .price[data-size="lg"] {
    font-size: var(--text-3xl);
  }
</style>
```

---

## Success & Error Pages

### /purchase/success/+page.server.ts

```typescript
import { redirect, error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { createServerApi } from '$lib/server/api';

export const load: PageServerLoad = async ({ url, locals, platform, cookies }) => {
  // Must be authenticated
  if (!locals.user) {
    redirect(302, '/login?redirect=/library');
  }

  const sessionId = url.searchParams.get('session_id');
  const contentId = url.searchParams.get('content');

  if (!sessionId && !contentId) {
    redirect(302, '/library');
  }

  const api = createServerApi(platform);
  const sessionCookie = cookies.get('codex-session');

  // Verify the session if provided
  if (sessionId) {
    try {
      const session = await api.fetch<CheckoutSession>(
        'ecom',
        `/api/checkout/sessions/${sessionId}`,
        sessionCookie
      );

      if (session.status !== 'complete') {
        // Payment not complete - redirect to library
        redirect(302, '/library');
      }

      // Get the purchased content
      const content = await api.fetch<PurchasedContent>(
        'content',
        `/api/content/${session.contentId}`,
        sessionCookie
      );

      return {
        success: true,
        content,
        purchasedAt: session.completedAt
      };
    } catch (e) {
      // Session verification failed
      console.error('Session verification failed:', e);
      redirect(302, '/library');
    }
  }

  // Fallback: just get the content info
  if (contentId) {
    try {
      const content = await api.fetch<PurchasedContent>(
        'content',
        `/api/content/${contentId}`,
        sessionCookie
      );

      return {
        success: true,
        content,
        purchasedAt: new Date().toISOString()
      };
    } catch (e) {
      redirect(302, '/library');
    }
  }

  redirect(302, '/library');
};

interface CheckoutSession {
  id: string;
  status: 'pending' | 'complete' | 'expired';
  contentId: string;
  completedAt: string | null;
}

interface PurchasedContent {
  id: string;
  title: string;
  slug: string;
  thumbnailUrl: string;
  organization: {
    slug: string;
    name: string;
  };
}
```

### /purchase/success/+page.svelte

```svelte
<script lang="ts">
  import Button from '$lib/components/ui/Button/Button.svelte';
  import * as m from '$paraglide/messages';

  let { data } = $props();
  const { content } = data;

  const contentUrl = `https://${content.organization.slug}.revelations.studio/content/${content.slug}`;
</script>

<svelte:head>
  <title>{m.purchase_success_title()} | Revelations</title>
</svelte:head>

<main class="success-page">
  <div class="success-card">
    <div class="success-icon">✓</div>

    <h1>{m.purchase_success_title()}</h1>
    <p class="subtitle">{m.purchase_success_subtitle()}</p>

    <div class="content-preview">
      <img src={content.thumbnailUrl} alt={content.title} />
      <div class="content-info">
        <h2>{content.title}</h2>
        <p>{content.organization.name}</p>
      </div>
    </div>

    <div class="actions">
      <Button href={contentUrl} variant="primary" size="lg">
        {m.purchase_watch_now()}
      </Button>

      <Button href="/library" variant="secondary">
        {m.purchase_go_to_library()}
      </Button>
    </div>
  </div>
</main>

<style>
  .success-page {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-6);
    background: var(--color-background);
  }

  .success-card {
    max-width: 480px;
    width: 100%;
    background: var(--color-surface);
    border-radius: var(--radius-xl);
    padding: var(--space-8);
    text-align: center;
    box-shadow: var(--shadow-lg);
  }

  .success-icon {
    width: 64px;
    height: 64px;
    border-radius: var(--radius-full);
    background: var(--color-success);
    color: white;
    font-size: var(--text-3xl);
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto var(--space-4);
  }

  h1 {
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    margin-bottom: var(--space-2);
  }

  .subtitle {
    color: var(--color-text-secondary);
    margin-bottom: var(--space-6);
  }

  .content-preview {
    display: flex;
    gap: var(--space-4);
    padding: var(--space-4);
    background: var(--color-surface-secondary);
    border-radius: var(--radius-lg);
    text-align: left;
    margin-bottom: var(--space-6);
  }

  .content-preview img {
    width: 120px;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    border-radius: var(--radius-md);
  }

  .content-info h2 {
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    margin-bottom: var(--space-1);
  }

  .content-info p {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .actions {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
</style>
```

### /purchase/cancel/+page.svelte

```svelte
<script lang="ts">
  import Button from '$lib/components/ui/Button/Button.svelte';
  import * as m from '$paraglide/messages';
</script>

<svelte:head>
  <title>{m.purchase_cancelled_title()} | Revelations</title>
</svelte:head>

<main class="cancel-page">
  <div class="cancel-card">
    <h1>{m.purchase_cancelled_title()}</h1>
    <p>{m.purchase_cancelled_message()}</p>

    <div class="actions">
      <Button onclick={() => history.back()} variant="primary">
        {m.purchase_try_again()}
      </Button>

      <Button href="/" variant="secondary">
        {m.common_back_home()}
      </Button>
    </div>
  </div>
</main>

<style>
  .cancel-page {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-6);
    background: var(--color-background);
  }

  .cancel-card {
    max-width: 400px;
    width: 100%;
    background: var(--color-surface);
    border-radius: var(--radius-xl);
    padding: var(--space-8);
    text-align: center;
  }

  h1 {
    font-size: var(--text-xl);
    margin-bottom: var(--space-2);
  }

  p {
    color: var(--color-text-secondary);
    margin-bottom: var(--space-6);
  }

  .actions {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
</style>
```

---

## Remote Functions

### checkout.remote.ts

```typescript
// src/lib/components/commerce/checkout.remote.ts
import { command } from '$app/server';
import * as v from 'valibot';
import { createServerApi } from '$lib/server/api';

const checkoutSchema = v.object({
  contentId: v.string(),
  successUrl: v.string(),
  cancelUrl: v.string()
});

export const createCheckoutSession = command(
  checkoutSchema,
  async ({ contentId, successUrl, cancelUrl }, { platform, cookies }) => {
    const api = createServerApi(platform);
    const sessionCookie = cookies.get('codex-session');

    if (!sessionCookie) {
      throw new Error('Authentication required');
    }

    const result = await api.fetch<{ url: string }>(
      'ecom',
      '/api/checkout/session',
      sessionCookie,
      {
        method: 'POST',
        body: JSON.stringify({
          contentId,
          successUrl,
          cancelUrl
        })
      }
    );

    return { url: result.url };
  }
);
```

---

## i18n Messages

```json
{
  "checkout_buy_for": "Buy for {price}",
  "checkout_redirecting": "Redirecting to checkout...",
  "checkout_error_generic": "Something went wrong. Please try again.",

  "purchase_free": "Free",
  "purchase_free_signin_hint": "Sign in to access this content",
  "purchase_guarantee": "30-day money-back guarantee",
  "purchase_owned": "You own this",

  "purchase_success_title": "Purchase Complete!",
  "purchase_success_subtitle": "You now have full access to this content.",
  "purchase_watch_now": "Watch Now",
  "purchase_go_to_library": "Go to Library",

  "purchase_cancelled_title": "Payment Cancelled",
  "purchase_cancelled_message": "Your payment was cancelled. You haven't been charged.",
  "purchase_try_again": "Try Again",

  "common_back_home": "Back to Home"
}
```

---

## Dependencies

### Required

| Dependency | Status | Description |
|------------|--------|-------------|
| Ecom-API | ✅ | Checkout session creation |
| P1-FE-FOUNDATION-002 | ✅ | Button, Badge |
| P1-FE-CONTENT-001 | ✅ | Content page integration |

---

## Implementation Checklist

- [ ] **Purchase Components**
  - [ ] PurchaseButton with checkout flow
  - [ ] PurchaseCTA (combines price + button)
  - [ ] PriceDisplay (formatted price)

- [ ] **Checkout Remote Function**
  - [ ] createCheckoutSession command
  - [ ] Error handling

- [ ] **Success Page**
  - [ ] Route creation
  - [ ] Session verification
  - [ ] Content info display
  - [ ] Watch now action

- [ ] **Cancel Page**
  - [ ] Route creation
  - [ ] Back navigation

- [ ] **Integration**
  - [ ] Add to content detail page
  - [ ] Add to preview player overlay

- [ ] **Testing**
  - [ ] Unit tests for components
  - [ ] E2E checkout flow test

---

## Testing Strategy

### Unit Tests

```typescript
describe('PurchaseButton', () => {
  it('formats price correctly');
  it('shows loading state during checkout');
  it('handles errors gracefully');
});

describe('PriceDisplay', () => {
  it('formats USD correctly');
  it('formats EUR correctly');
  it('handles zero price');
});
```

### E2E Tests

```typescript
test('complete purchase flow', async ({ page }) => {
  // Note: Use Stripe test mode
  await page.goto('/content/test-content');
  await page.click('button:has-text("Buy for")');
  // Stripe redirect...
  // Mock success callback
  await page.goto('/purchase/success?session_id=test_session');
  await expect(page.getByText('Purchase Complete')).toBeVisible();
});
```

---

## Notes

### Security Considerations

1. **Server-side session creation**: Never expose Stripe keys to client
2. **Session verification**: Always verify webhook before granting access
3. **Idempotency**: Handle duplicate webhooks gracefully

### Stripe Test Mode

For development and testing:
- Use Stripe test mode API keys
- Test card: `4242 4242 4242 4242`
- Any future date, any CVC

### Future Enhancements

- Coupon/discount code support
- Multiple quantity (credits)
- Subscription checkout
- Apple Pay / Google Pay

---

**Last Updated**: 2026-01-12
**Template Version**: 1.0
