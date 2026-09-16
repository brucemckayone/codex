# Reference 03 — Svelte 5 Components

How to author, extend, and compose components in `apps/web/src/lib/components/`.

## 1. The Composition Decision Tree

Before writing anything, ask the tree. Most "new component" instincts are wrong —
extension is cheaper, safer, and more maintainable.

```
Do you need new UI?
│
├─ An existing component + variant prop covers it?
│  → USE IT.
│
├─ An existing component needs a new variant (e.g., Button variant="outline")?
│  → EXTEND — add a new data-variant branch in the existing component
│
├─ Behaviour is already covered by Melt UI (dialog, dropdown, tabs, popover, accordion, tooltip, select, checkbox)?
│  → WRAP Melt UI — see §4
│
├─ You need a specialised wrapper over an existing primitive (e.g., IconButton wraps Button)?
│  → COMPOSE — new component renders the base component
│
├─ You need genuinely novel primitive behaviour AND no Melt builder covers it?
│  → NEW COMPONENT — last resort; justify in the PR description
```

**Heuristic:** if you're about to write a new component that imports an existing one, consider
whether a variant on the existing one is lighter. Composition wins when the wrapper adds
structure; a variant wins when it's purely visual tweaking.

## 2. Canonical File Shape

```svelte
<!--
  @component ComponentName
  
  One-sentence description.
  
  @prop {...} [propName='default'] - purpose
  @prop {Snippet} children - content
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  
  interface Props extends HTMLButtonAttributes {
    variant?: 'primary' | 'secondary' | 'ghost';
    size?: 'sm' | 'md' | 'lg';
    loading?: boolean;
    children: Snippet;
  }
  
  const {
    variant = 'primary',
    size = 'md',
    loading = false,
    disabled = false,
    children,
    class: className,
    ...restProps
  }: Props = $props();
</script>

<button
  class="button {className ?? ''}"
  data-variant={variant}
  data-size={size}
  disabled={disabled || loading}
  aria-busy={loading}
  {...restProps}
>
  {@render children()}
</button>

<style>
  .button { /* scoped tokens */ }
  .button[data-variant="primary"] { /* variant */ }
  .button[data-size="md"] { /* size */ }
  .button:focus-visible { /* token focus */ }
</style>
```

Reference: `apps/web/src/lib/components/ui/Button/Button.svelte` is the canonical example.

## 3. Svelte 5 Rune Patterns

This codebase is **Svelte 5.55 end-to-end** — no `export let`, no Svelte 4 stores for new code.

### `$props()` with `interface Props`

```ts
interface Props extends HTMLButtonAttributes {  // Extend HTML element types when wrapping native
  variant?: 'primary' | 'secondary';
  children: Snippet;                            // Slot content
}

const { variant = 'primary', children, ...rest }: Props = $props();
```

- Always a named `interface Props` — never inline destructured types
- Destructure `class: className` to avoid the reserved word
- Spread `...restProps` to forward native HTML attributes
- Extend `HTMLButtonAttributes` / `HTMLInputAttributes` / `HTMLDivElement`+`HTMLAttributes<HTMLDivElement>` / etc.

### `$state`, `$derived`, `$effect`

```ts
let open = $state(false);                     // Reactive primitive

const id = $derived(`modal-${open ? 'open' : 'closed'}`);    // Simple computed

const timeRemaining = $derived.by(() => {     // Complex computed — use .by for multiple statements
  if (!progress || isCompleted) return null;
  const remaining = progress.duration - progress.position;
  return formatDurationHuman(remaining);
});

$effect(() => {                               // Side effect
  if (open) document.body.classList.add('modal-open');
  return () => document.body.classList.remove('modal-open');
});
```

Rules:
- `$state()` for reactive primitives; `$state.raw()` only when mutations shouldn't trigger reactivity
- `$derived()` for one-liners; `$derived.by(() => { ... })` for multi-statement logic
- `$effect()` replaces `onMount()` for most reactive setup — cleaner, auto-tracks deps
- `onMount()` still correct for browser-only, one-shot setup (DOM measurement, external lib init)
- **Never destructure `$derived()` results** — loses reactivity. Use `query.data` or `const { data } = $derived(query)`

### `$bindable()` — two-way binding

```ts
interface Props {
  value?: string;
  onValueChange?: (v: string) => void;
}

let { value = $bindable(''), onValueChange }: Props = $props();

// Consumer can use: <Input bind:value={name} />
```

- Required for any prop the parent wants to `bind:` to
- Always supply a default (`$bindable('')`) — an unbound consumer still needs a value

### Module-level state (`.svelte.ts` files)

Use a `.svelte.ts` file when you need module-scoped reactive state shared across components
(e.g., the brand editor store at `lib/brand-editor/brand-editor-store.svelte.ts`):

```ts
// brand-editor-store.svelte.ts
let pending = $state<BrandEditorState | null>(null);

export const brandEditor = {
  get pending() { return pending; },
  open(saved: BrandEditorState) { pending = { ...saved }; },
  close() { pending = null; },
  updateField<K extends keyof BrandEditorState>(k: K, v: BrandEditorState[K]) {
    if (pending) pending[k] = v;
  },
};
```

Non-reactive helper functions belong in plain `.ts` files — `.svelte.ts` is specifically for
files that use runes.

### Snippets (the `<slot>` replacement)

```svelte
<!-- Component -->
<script lang="ts">
  interface Props {
    children: Snippet;                        // Required content slot
    header?: Snippet;                         // Optional named slot
    actions?: Snippet<[boolean]>;             // Parametrized slot
  }
  const { children, header, actions }: Props = $props();
</script>

<section>
  {#if header}{@render header()}{/if}
  <div>{@render children()}</div>
  {#if actions}{@render actions(isLoading)}{/if}
</section>

<!-- Consumer -->
<Card>
  {#snippet header()}<h2>Title</h2>{/snippet}
  {#snippet actions(loading)}<Button {loading}>Go</Button>{/snippet}
  Body content
</Card>
```

- `Snippet` (from `'svelte'`) for untyped children; `Snippet<[T1, T2]>` for typed parameters
- Always invoke with `{@render slot?.()}` (optional chaining) for optional snippets

## 4. Melt UI Wrapping Pattern

Melt UI provides headless behaviour builders. Wrap them into branded components. Canonical
structure:

```svelte
<!-- Dialog.svelte (root) -->
<script lang="ts">
  import { createDialog, type CreateDialogProps } from '@melt-ui/svelte';
  import { setContext, untrack } from 'svelte';
  
  type Props = Omit<CreateDialogProps, 'open' | 'onOpenChange'> & {
    children?: Snippet;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  };
  
  let { open = $bindable(false), onOpenChange, children, ...meltProps }: Props = $props();
  
  const dialog = createDialog({ ...untrack(() => meltProps) });     // untrack prevents reactivity loops
  const {
    elements: { trigger, overlay, content, title, close },
    states: { open: openStore },
  } = dialog;
  
  // Prop → Melt
  $effect(() => { openStore.set(open); });
  
  // Melt → prop (separate effect to avoid loops)
  $effect(() => { open = $openStore; onOpenChange?.($openStore); });
  
  setContext('DIALOG', dialog);
</script>

{@render children?.()}
```

Rules:
- Wrap `createDialog({...})` arg with `untrack(() => props)` to capture initial values without re-creating the builder
- Use **separate `$effect` rules** for prop→store and store→prop sync to prevent infinite loops
- Export Melt elements via `setContext` — sub-components (`DialogContent`, etc.) call `getContext<ReturnType<typeof createDialog>>('DIALOG')`
- Never re-export Melt builders directly — always wrap so consumers see Codex props, not Melt internals

Currently wrapped: `Button`, `Input`, `Checkbox`, `Select`, `Tabs` (+ `TabsList`/`TabsContent`/`TabsTrigger`), `Dialog` (+ sub-components), `Accordion`, `Tooltip`, `DropdownMenu`, `Popover`. See `lib/components/ui/index.ts` for the barrel.

## 5. Scoped Styles + Data Attributes

```css
/* Scoped — safe */
.button { /* base */ }

/* Size via attribute */
.button[data-size="sm"] { height: var(--space-8); }
.button[data-size="md"] { height: var(--space-10); }

/* Variant via attribute */
.button[data-variant="primary"] { background: var(--color-interactive); }
.button[data-variant="secondary"] { background: var(--color-surface); }

/* Melt UI state via :global() */
.checkbox-root:global([data-state="checked"]) { background: var(--color-interactive); }

/* Focus token */
.button:focus-visible {
  outline: var(--border-width-thick) solid var(--color-focus);
  outline-offset: 2px;
}
```

<!-- added from iter-15: inline style="animation: …" bypasses scoped-style discipline -->
**Prefer class-based animation triggers over inline `style="animation: …"`.** Reveal/hide
animations belong in scoped CSS keyed by a `data-*` attribute or class — not `style` attributes.
Inline `style` breaks token-linting, can't reference `@media (prefers-reduced-motion)`, and is
invisible to Vitest / Playwright selectors that watch class state.

```svelte
<!-- WRONG — inline style bypasses scoped-CSS discipline -->
{#if revealed}
  <section style="animation: slideIn var(--duration-normal) var(--ease-out);">…</section>
{/if}

<!-- CORRECT — data-attribute triggers a scoped rule -->
<section class="reveal" data-revealed={revealed}>…</section>

<style>
  .reveal[data-revealed='true'] { animation: slideIn var(--duration-normal) var(--ease-out); }
  @media (prefers-reduced-motion: reduce) {
    .reveal[data-revealed='true'] { animation: none; }
  }
</style>
```

See `01-tokens.md` and `02-css-architecture.md` §7 for the full rationale.

## 6. Forwarding — `class`, `...restProps`, events

### The `{className ?? ''}` trap

Even careful authors forget this one. Without the `?? ''` guard, a consumer that doesn't
pass `class` leaks the literal string `undefined` into the DOM:

```svelte
<!-- WRONG — renders <div class="dialog-body undefined"> -->
<div class="dialog-body {className}">

<!-- CORRECT -->
<div class="dialog-body {className ?? ''}">
```

This is purely cosmetic (class selectors still match `.dialog-body`), but it shows up in
DevTools, breaks snapshot tests, and creates confusion. Always use the guard.

```svelte
<script lang="ts">
  interface Props extends HTMLButtonAttributes {
    variant?: 'primary' | 'secondary';
  }
  const { variant = 'primary', class: className, ...restProps }: Props = $props();
</script>

<button
  class="button {className ?? ''}"
  data-variant={variant}
  {...restProps}                              <!-- Forwards onclick, onfocus, etc. -->
>
  <slot />
</button>
```

- Consumer can attach `onclick`, `onmouseover`, `aria-*`, `data-*` — all forwarded via `...restProps`
- For Svelte 5, prefer `onclick={...}` DOM-native attributes over the old `on:click` directive (the codebase uses either, but native is the forward direction)

## 7. Event Handler Naming

- Inline for simple: `onclick={() => toggleOpen()}`
- Extracted for complex: `onclick={handleSubmit}` — use `handle*` prefix (never `on*` for handler names; `on*` is the attribute)
- Never bind `this` explicitly — arrow functions + lexical `this` is the pattern

## 8. Testing Components

Every public component under `lib/components/ui/` should have a `.svelte.test.ts` sibling.
See [08-testing.md](08-testing.md) for the full pattern.

## 9. Skeleton Contract

When a component loads async, its skeleton state **must match the loaded component's
dimensions exactly** or you'll ship a visible layout shift when the content resolves
(CLS regression — see [06-performance.md §2](06-performance.md#2-cls-prevention-checklist)).

Two valid patterns, one preferred:

### ✅ Preferred — inline `{#if loading}` branch inside the component

```svelte
<!-- ContentCard.svelte -->
<article class="cc" data-variant={variant}>
  {#if loading}
    <div class="cc__thumb cc__thumb--skeleton"></div>
    <div class="cc__body">
      <div class="cc__title cc__title--skeleton"></div>
    </div>
  {:else}
    <div class="cc__thumb"><img .../></div>
    <div class="cc__body">
      <h3 class="cc__title">{title}</h3>
    </div>
  {/if}
</article>
```

Dimensions match by construction — the skeleton uses the same classes as the loaded markup,
just with placeholder fills. Works seamlessly with `@container` queries since the outer
article is identical in both states.

### ⚠ Acceptable — separate skeleton component with a shared CSS class

Only justified when the skeleton is reused across multiple consumers (grid row, list row,
detail page). Requires a **shared mixin class** that both the skeleton and the loaded
component apply for their outer structure:

```svelte
<!-- SkeletonContentCard.svelte + ContentCard.svelte both use .cc-shell -->
<article class="cc-shell">...</article>
```

The skill's iter-03 audit caught a `SkeletonContentCard.svelte` that drifted from
`ContentCard.svelte` on 5 dimensions (`border-radius`, outer padding, thumb radius,
container-query adaptation, body gap) — exactly the class of bug this rule prevents.

### Rules

- **Never** let a separate skeleton file diverge from its counterpart's dimensions
- **Never** use tokens in the skeleton that aren't available in the loaded component's render context (e.g. `--space-1-5` outside `[data-org-brand]`)
- **Never** animate the skeleton shimmer without a `prefers-reduced-motion: reduce` guard — see canonical form below
- **Always** verify the swap with Chrome DevTools MCP Lighthouse — CLS score is the final arbiter

<!-- added from iter-16: rule existed but recurred in MemberTable + RevenueChart. Canonical example makes it harder to miss. -->
**Canonical skeleton animation + reduced-motion guard** — `animation: pulse 1.5s infinite` declared on an `.skeleton-bar` is NOT auto-neutralised by `motion.css` because the keyframe iteration count is `infinite`. Token-level duration collapse makes each frame run in 0.01ms, but the animation still loops continuously, producing imperceptible flicker that can trigger vestibular issues. Always co-locate the guard:

```css
.skeleton-bar {
  background: var(--color-surface-secondary);
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

@media (prefers-reduced-motion: reduce) {
  .skeleton-bar { animation: none; }
}
```

Infinite-iteration animations (spinners, shimmers, pulses, progress indicators) are the primary recurrence class — iter-14 CheckoutSuccess spinner, iter-16 MemberTable + RevenueChart skeletons. Check every `animation: * infinite` for a co-located `@media (prefers-reduced-motion: reduce)` neutraliser.

## 10. Compound Components (When Justified)

Use `Dialog.Root` + `Dialog.Content` + `Dialog.Title` pattern only for primitives that are
*genuinely* composable — where consumers need fine-grained slot control. Overusing compound
components balloons the API surface.

Currently used by: `Dialog`, `Tabs`, `Accordion` (and only these). Everything else is a
single-component wrapper with snippets for flexibility.

Pattern:
```svelte
<!-- Consumer -->
<Dialog.Root bind:open>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>Title</Dialog.Title>
    </Dialog.Header>
    <Dialog.Body>...</Dialog.Body>
  </Dialog.Content>
</Dialog.Root>
```

The exporting module (`lib/components/ui/Dialog/index.ts`) re-exports each sub-component as a
namespaced property: `export { default as Root } from './Dialog.svelte'`.

## 11. Gotchas / Anti-patterns

- **Don't** use `export let` — Svelte 5 only. The linter should catch this.
- **Don't** mutate a `$props()` object — it's readonly. For two-way, use `$bindable()` or mirror into `$state`.
- **Don't** run async work inside `$derived` — `$derived` must be pure + synchronous. Use `$effect` for async, or a tanstack-db `useLiveQuery`.
- **Don't** use class concatenation for variants (`class:btn-primary={variant === 'primary'}`) — use `data-variant`. Easier to style, easier to test, no CSS specificity races.
- **Don't** re-export Melt builders directly — always wrap. Consumers should never import from `@melt-ui/svelte`.
- **Don't** default a prop to a mutable object literal (`propName = {}` as a prop default). Initialise inside `$state()` in the script body.
- **Don't** destructure `$derived()` results (`const { data } = derivedQuery`) — it loses reactivity. Access via `query.data` or `const { data } = $derived(query)`.
- **Don't** use `$app/stores` (`$page`, `$navigating`) — use `$app/state` (`page`, `navigating`). The CLAUDE.md rule confirms this.
- **Don't** import `onMount` when `$effect` does the job. `$effect` re-runs on deps; `onMount` fires once.
- **Don't** set `role="button"` on a `<div>` — use `<button>`. A11y reference: [05-accessibility.md](05-accessibility.md).
- **Don't** forget `{@render children?.()}` — without the optional chain, an empty consumer crashes.
- **Don't** write a new component without running Svelte MCP's `svelte-autofixer` on it before closing. See [09-mcp-verification.md](09-mcp-verification.md).

## 12. When to Re-Verify This Reference

- `apps/web/CLAUDE.md` — rune + prop rules (authoritative)
- `apps/web/src/lib/components/ui/Button/Button.svelte` — canonical component shape
- `apps/web/src/lib/components/ui/Dialog/Dialog.svelte` — canonical Melt UI wrap
- `apps/web/src/lib/components/ui/index.ts` — current component inventory
- Svelte 5 release notes (via Svelte MCP `list-sections`) — new runes or behaviours

If this reference disagrees with current code, **the code wins**.
