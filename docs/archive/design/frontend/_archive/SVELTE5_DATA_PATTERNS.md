# Svelte 5 + SvelteKit Modern Data Fetching Patterns

**Status**: Research
**Last Updated**: 2026-01-09

This document outlines the **modern Svelte 5 approach** to data fetching and state management, incorporating runes, universal reactivity, and SvelteKit 2's latest features.

---

## Executive Summary

**Svelte 5 fundamentally changes the game** with:
1. **Universal Reactivity** via runes (`$state`, `$derived`, `$effect`)
2. **Reactive state in `.svelte.ts` files** (no more stores for most use cases!)
3. **`$app/state`** replacing `$app/stores` for page data
4. **Fine-grained reactivity** that works everywhere

This eliminates the need for complex repository patterns in many cases and enables **simpler, more direct data fetching**.

---

## Core Svelte 5 Runes

### `$state` - Reactive Variables
```typescript
// Works in .svelte AND .svelte.ts files!
let count = $state(0);
let user = $state({ name: 'Alice', age: 30 });

// Deep reactivity for objects/arrays
user.age = 31; // Automatically triggers updates
```

### `$derived` - Computed Values
```typescript
let count = $state(0);
let doubled = $derived(count * 2);

// Complex derivations
let fullName = $derived(`${user.firstName} ${user.lastName}`);
```

### `$effect` - Side Effects (Client-Side Only!)
```typescript
let searchQuery = $state('');

$effect(() => {
  // Runs when searchQuery changes
  const controller = new AbortController();

  fetch(`/api/search?q=${searchQuery}`, { signal: controller.signal })
    .then(res => res.json())
    .then(data => results = data);

  // Cleanup on re-run
  return () => controller.abort();
});
```

**⚠️ Critical**: `$effect` **only runs client-side**, not during SSR!

---

## Universal Reactivity in `.svelte.ts`

**Game-changer**: Reactive state can now live in regular TypeScript files!

```typescript
// $lib/state/search.svelte.ts
export const searchState = $state({
  query: '',
  results: [],
  loading: false
});

export async function performSearch(query: string) {
  searchState.loading = true;
  searchState.query = query;

  const res = await fetch(`/api/search?q=${query}`);
  searchState.results = await res.json();
  searchState.loading = false;
}
```

```svelte
<!-- Any component can import and use it -->
<script lang="ts">
  import { searchState, performSearch } from '$lib/state/search.svelte.ts';
</script>

<input bind:value={searchState.query} on:input={() => performSearch(searchState.query)} />

{#if searchState.loading}
  Loading...
{:else}
  {#each searchState.results as result}
    <div>{result.title}</div>
  {/each}
{/if}
```

**Key Rules**:
- **Wrap primitives in objects**: `$state({ value: '' })` not `$state('')`
- **SSR Caution**: Avoid shared state on server (use `event.locals` instead)

---

## SvelteKit 2 + Svelte 5 Integration

### `$app/state` (New in SvelteKit 2.12)

Replaces `$app/stores` with fine-grained reactivity:

```typescript
import { page } from '$app/state';

// Reactive access to page data
const { data, params, url } = page;

// Updates automatically on navigation
console.log(page.data.user); // From load function
```

**Benefits**:
- Updates to `page.state` don't invalidate `page.data` (and vice versa)
- More efficient re-renders
- Works seamlessly with Svelte 5 runes

### Load Functions (Still Essential!)

**Server `load` (`+page.server.ts`)**:
```typescript
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, fetch }) => {
  // Runs on server only
  const user = await db.getUser(locals.userId);
  return { user };
};
```

**Universal `load` (`+page.ts`)**:
```typescript
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, data }) => {
  // Runs on server (SSR) + client (navigation)
  const posts = await fetch('/api/posts').then(r => r.json());
  return { ...data, posts };
};
```

---

## Modern Data Fetching Patterns

### Pattern 1: Server Load + Client Reactivity (Recommended)

**Best for**: Authenticated pages with interactive features

```typescript
// +page.server.ts
export const load: PageServerLoad = async ({ locals }) => {
  // Initial data (SSR)
  const library = await getLibrary(locals.userId);
  return { library };
};
```

```svelte
<!-- +page.svelte -->
<script lang="ts">
  import { page } from '$app/state';

  // Reactive access to server data
  let library = $derived(page.data.library);

  // Client-side filtering
  let filter = $state('');
  let filtered = $derived(
    library.filter(item => item.title.includes(filter))
  );
</script>

<input bind:value={filter} placeholder="Filter..." />

{#each filtered as item}
  <div>{item.title}</div>
{/each}
```

### Pattern 2: Shared Reactive State (`.svelte.ts`)

**Best for**: Cross-component state (cart, search, filters)

```typescript
// $lib/state/cart.svelte.ts
export const cart = $state({
  items: [],
  total: 0
});

export function addToCart(item) {
  cart.items.push(item);
  cart.total += item.price;
}

export function removeFromCart(id) {
  const index = cart.items.findIndex(i => i.id === id);
  if (index > -1) {
    cart.total -= cart.items[index].price;
    cart.items.splice(index, 1);
  }
}
```

```svelte
<!-- Any component -->
<script lang="ts">
  import { cart, addToCart } from '$lib/state/cart.svelte.ts';
</script>

<button on:click={() => addToCart(product)}>
  Add to Cart ({cart.items.length})
</button>
```

### Pattern 3: Reactive Fetching with `$effect`

**Best for**: User-triggered searches, filters, infinite scroll

```svelte
<script lang="ts">
  let query = $state('');
  let results = $state([]);
  let loading = $state(false);

  $effect(() => {
    if (!query) {
      results = [];
      return;
    }

    loading = true;
    const controller = new AbortController();

    fetch(`/api/search?q=${query}`, { signal: controller.signal })
      .then(r => r.json())
      .then(data => {
        results = data;
        loading = false;
      });

    return () => controller.abort();
  });
</script>

<input bind:value={query} />
{#if loading}Loading...{/if}
{#each results as result}
  <div>{result.title}</div>
{/each}
```

### Pattern 4: Custom Resource Helper

**Best for**: Reusable async data patterns

```typescript
// $lib/utils/resource.svelte.ts
export function createResource<T>(fetcher: () => Promise<T>) {
  let data = $state<T | null>(null);
  let error = $state<Error | null>(null);
  let loading = $state(true);

  $effect(() => {
    loading = true;
    error = null;

    fetcher()
      .then(result => {
        data = result;
        loading = false;
      })
      .catch(err => {
        error = err;
        loading = false;
      });
  });

  return { data, error, loading };
}
```

```svelte
<script lang="ts">
  import { createResource } from '$lib/utils/resource.svelte.ts';

  const userResource = createResource(() =>
    fetch('/api/user').then(r => r.json())
  );
</script>

{#if userResource.loading}
  Loading...
{:else if userResource.error}
  Error: {userResource.error.message}
{:else}
  Hello, {userResource.data.name}!
{/if}
```

---

## Proposed Architecture for Codex

### Layer 1: Cloudflare Workers (Backend)
- **Unchanged**: RESTful APIs, business logic, auth

### Layer 2: SvelteKit Load Functions
- **Server loads** (`+page.server.ts`): Initial data, auth-required
- **Universal loads** (`+page.ts`): Public data, client navigation

### Layer 3: Shared Reactive State (`.svelte.ts`)
- **Global state**: Cart, user preferences, UI state
- **Feature state**: Search, filters, modals
- **No stores needed** for most cases!

### Layer 4: Component-Level Reactivity
- **`$state`**: Local component state
- **`$derived`**: Computed values from `page.data` or shared state
- **`$effect`**: User-triggered fetches, subscriptions

---

## Route-Specific Strategies

### Public Routes (`(public)`)
```typescript
// +page.server.ts - SSR for SEO
export const load: PageServerLoad = async () => {
  const featured = await getContent({ featured: true });
  return { featured };
};
```

```svelte
<!-- +page.svelte -->
<script lang="ts">
  import { page } from '$app/state';
  let featured = $derived(page.data.featured);
</script>
```

### Auth Routes (`(auth)`)
```typescript
// +page.server.ts - Form actions
export const actions = {
  login: async ({ request, cookies }) => {
    const data = await request.formData();
    const { token } = await authApi.login({
      email: data.get('email'),
      password: data.get('password')
    });

    cookies.set('session', token, { httpOnly: true });
    throw redirect(303, '/library');
  }
};
```

### App Routes (`(app)`, `(creator)`, `(admin)`)
**Hybrid**: Server load for initial data + client reactivity

```typescript
// +layout.server.ts - User context
export const load: LayoutServerLoad = async ({ locals }) => {
  return { user: locals.user };
};
```

```svelte
<!-- +page.svelte - Client-side interactions -->
<script lang="ts">
  import { page } from '$app/state';
  import { libraryState } from '$lib/state/library.svelte.ts';

  let user = $derived(page.data.user);

  // Client-side filtering/sorting
  let sortBy = $state('date');
  let sorted = $derived(
    libraryState.items.sort((a, b) =>
      sortBy === 'date' ? b.date - a.date : a.title.localeCompare(b.title)
    )
  );
</script>
```

---

## Key Advantages Over Traditional Patterns

| Traditional | Svelte 5 Modern |
|-------------|-----------------|
| Stores (`writable`, `derived`) | `$state`, `$derived` in `.svelte.ts` |
| Repository classes | Direct fetch in `$effect` or shared state |
| Complex DI/service layers | Simple exported functions |
| `onMount` for fetching | `$effect` with auto-cleanup |
| Prop drilling | Shared `.svelte.ts` state |
| Manual subscriptions | Automatic reactivity |

---

## Migration Checklist

### Phase 1: Foundation
- [x] Understand Svelte 5 runes
- [ ] Migrate from `$app/stores` to `$app/state`
- [ ] Create shared state files (`.svelte.ts`)

### Phase 2: Data Patterns
- [ ] Define server loads for SSR pages
- [ ] Create shared state for cart, search, filters
- [ ] Implement `$effect` for reactive fetching

### Phase 3: Optimization
- [ ] Add `AbortController` to all `$effect` fetches
- [ ] Implement debouncing for search
- [ ] Add error boundaries

---

## Best Practices

1. **Use `load` functions for initial data** (SSR, SEO)
2. **Use `.svelte.ts` for shared state** (replaces most stores)
3. **Use `$effect` for reactive fetching** (with `AbortController`)
4. **Wrap primitives in objects** when exporting `$state`
5. **Avoid shared state on server** (use `event.locals`)
6. **Prefer `$derived` over `$effect`** when possible (SSR-safe)
7. **Use `$app/state`** instead of `$app/stores`

---

## References

- [Svelte 5 Runes](https://svelte.dev/docs/svelte/$state)
- [SvelteKit Load Functions](https://kit.svelte.dev/docs/load)
- [Universal Reactivity](https://svelte.dev/blog/runes)
- [`$app/state` Migration](https://svelte.dev/docs/kit/$app-state)
