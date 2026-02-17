# Component Agent Specification

## Domain
Svelte 5 runes, Melt UI integration, accessibility, Storybook documentation, TypeScript patterns, component structure, Snippet API.

## File Patterns to Review
- `apps/web/src/lib/components/ui/**/*.svelte`
- `apps/web/src/lib/components/ui/**/*.stories.svelte`
- `apps/web/src/routes/**/*.svelte`
- `apps/web/src/lib/composables/**/*.ts`

## Checklist

### Svelte 5 Runes (CRITICAL)

**CRITICAL** = Blocking issue, **WARN** = Should fix, **INFO** = Suggestion

- [CRITICAL] Use `$props()` for component props
- [CRITICAL] Use `$state()` for internal reactive state
- [CRITICAL] Use `$derived()` for computed values
- [CRITICAL] Use `$effect()` for side effects
- [CRITICAL] NO Svelte stores in components (use TanStack DB or $state)
- [WARN] Use `$derived.by()` for derived functions
- [INFO] Use `$inspect()` for debugging (remove in production)

### Component Structure (CRITICAL)

- [CRITICAL] Every component has: `ComponentName.svelte`, `index.ts`, `ComponentName.stories.svelte`
- [CRITICAL] Interface extends HTML attributes (e.g., `HTMLButtonAttributes`)
- [CRITICAL] JSDoc comment with `@component`, `@prop`, `@example`
- [WARN] Complex components have unit tests
- [INFO] Export type from `index.ts` for consumers
- [INFO] Use barrel exports for related components

### Snippet API (CRITICAL for Svelte 5)

- [CRITICAL] Use `children: Snippet` prop for component content
- [CRITICAL] Use `{@render children()}` to render snippet children
- [CRITICAL] Use named snippets for complex components (e.g., `header`, `footer`)
- [WARN] Pass additional data to snippets: `{@render header({ title })}`
- [INFO] Snippets replace slots from Svelte 4

### Melt UI Integration

- [CRITICAL] Use `untrack()` for default values in Melt builders
- [CRITICAL] Sync external props to Melt state via `$effect()`
- [CRITICAL] Set context for composite components
- [CRITICAL] Use `use:melt` directive on elements
- [CRITICAL] Use `$bindable()` for two-way bindings
- [WARN] Follow Melt's builder patterns correctly
- [INFO] Use Melt's action builders for keyboard handlers

### Accessibility (CRITICAL)

- [CRITICAL] All interactive elements have `aria-*` attributes
- [CRITICAL] Loading states use `aria-busy="true"`
- [CRITICAL] Error states use `role="alert"`
- [CRITICAL] Focus visible styles with `:focus-visible`
- [CRITICAL] Labels associated with form inputs
- [WARN] Melt UI primitives for complex components (Dialog, Select, etc.)
- [WARN] Keyboard navigation support
- [INFO] Aim for WCAG 2.1 AA compliance
- [INFO] Test with screen readers

### Storybook Documentation (CRITICAL)

- [CRITICAL] Every component has `.stories.svelte` file
- [CRITICAL] Include `tags: ['autodocs']`
- [CRITICAL] Show all variants
- [CRITICAL] Show loading and disabled states
- [WARN] Include argTypes for all props
- [INFO] Include interactive playground
- [INFO] Document edge cases

### Event Handling

- [CRITICAL] Optional chaining for callbacks: `onChange?.(value)`
- [CRITICAL] Pass event object for DOM events
- [WARN] Debounce rapid events (input, scroll)
- [INFO] Use event modifiers where appropriate

### i18n (CRITICAL for user-facing text)

- [CRITICAL] All user-facing text uses paraglide `$t()` function
- [INFO] Content data (post content, comments) exempt
- [INFO] Use `paraglide/` messages directory

### TypeScript Patterns

- [CRITICAL] Props interfaces extend appropriate HTML attributes
- [CRITICAL] Use proper generic types
- [WARN] Use `import type` for type-only imports
- [INFO] Use `svelteHTML` for template typing

### Performance

- [INFO] Lazy load heavy components
- [INFO] Use `$derived()` for computed values (not `$effect()`)
- [INFO] Minimize unnecessary re-renders
- [INFO] Use `{@key}` for list stability

## Code Examples

### Correct: Component Structure
```svelte
<!-- apps/web/src/lib/components/ui/Button/Button.svelte -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import * as paraglide from '$lib/paraglide';
  import { melt } from '@melt-ui/svelte';
  import { button } from '@melt-ui/svelte/builders';

  /**
   * Button component with variants and sizes.
   *
   * @component
   *
   * @prop {boolean} [disabled=false] - Disable the button
   * @prop {'primary' | 'secondary' | 'ghost'} [variant='primary'] - Visual style
   * @prop {'sm' | 'md' | 'lg'} [size='md'] - Button size
   * @prop {Snippet} children - Button content
   *
   * @example
   * ```svelte
   * <Button variant="primary">Click me</Button>
   * ```
   */
  interface Props extends HTMLButtonAttributes {
    variant?: 'primary' | 'secondary' | 'ghost';
    size?: 'sm' | 'md' | 'lg';
    disabled?: boolean;
    children: Snippet;
    onclick?: (event: MouseEvent) => void;
  }

  let {
    variant = 'primary',
    size = 'md',
    disabled = false,
    children,
    onclick,
    ...rest
  }: Props = $props();

  // Melt UI builder with untrack for default value
  const buttonElement = button(untrack(() => ({ disabled })));

  // Sync variant prop to Melt state
  $effect(() => {
    buttonElement.setVariant(variant);
  });

  let isLoading = $state(false);

  async function handleClick(e: MouseEvent) {
    if (disabled || isLoading) return;
    onclick?.(e);
  }

  // Classes derived from state
  const buttonClass = $derived(
    `button button--${variant} button--${size} ${isLoading ? 'button--loading' : ''}`
  );
</script>

<button
  use:melt={$buttonElement}
  class={buttonClass}
  aria-busy={isLoading}
  onclick={handleClick}
  {...rest}
>
  {#if isLoading}
    <span class="spinner" />
  {/if}
  {@render children()}
</button>
```

### Incorrect: No Runes
```svelte
<!-- ❌ CRITICAL: Using Svelte 4 export syntax -->
<script>
  export let value = 'default';
  export let variant = 'primary';
  let count = 0;
</script>

<!-- ✅ CORRECT: Svelte 5 runes -->
<script lang="ts">
  interface Props {
    value?: string;
    variant?: 'primary' | 'secondary';
  }

  let { value = 'default', variant = 'primary' }: Props = $props();
  let count = $state(0);
</script>
```

### Correct: Snippet API
```svelte
<!-- Card with named snippets -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    children: Snippet;
    actions?: Snippet;
    footer?: Snippet;
  }

  let { title, children, actions, footer }: Props = $props();
</script>

<article class="card">
  <header class="card-header">
    <h2>{title}</h2>
    {#if actions}
      <div class="card-actions">
        {@render actions()}
      </div>
    {/if}
  </header>

  <div class="card-body">
    {@render children()}
  </div>

  {#if footer}
    <footer class="card-footer">
      {@render footer()}
    </footer>
  {/if}
</article>

<!-- Usage -->
<Card title="My Card" actions={() => `<button>Edit</button>`}>
  <p>Card content goes here</p>
  {#snippet footer()}
    <small>Last updated: 2024-01-01</small>
  {/snippet}
</Card>
```

### Incorrect: No Snippet
```svelte
<!-- ❌ CRITICAL: Using slots instead of Snippet API -->
<script>
  export let children;
</script>

<slot />

<!-- ✅ CORRECT: Snippet API -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    children: Snippet;
  }

  let { children }: Props = $props();
</script>

{@render children()}
```

### Correct: Melt UI Integration
```svelte
<!-- Dialog component -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { untrack } from 'svelte';
  import * as paraglide from '$lib/paraglide';
  import { dialog } from '@melt-ui/svelte/builders';
  import { setContext } from 'svelte';
  import { removeScroll } from '$lib/utils/scroll';

  interface Props {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    title: string;
    description?: string;
    children: Snippet;
  }

  let {
    open = false,
    onOpenChange,
    title,
    description,
    children
  }: Props = $props();

  // Create dialog with untrack for defaults
  const states = dialog({
    open: () => open,
    onOpenChange: ({ next }) => {
      open = next;
      onOpenChange?.(next);
      if (next) removeScroll();
    }
  });

  // Set context for child components
  setContext('dialog', states);

  // Local binding for controlled component
  let localOpen = $bindable(open);

  $effect(() => {
    localOpen = open;
  });
</script>

{@render children()}
```

### Correct: Storybook Documentation
```svelte
<!-- apps/web/src/lib/components/ui/Button/Button.stories.svelte -->
<script lang="ts">
  import type { Input } from '@storybook/svelte';
  import Button from './Button.svelte';

  interface StoryArgs {
    variant: 'primary' | 'secondary' | 'ghost';
    size: 'sm' | 'md' | 'lg';
    disabled: boolean;
    label: string;
  }

  const { createStory } = getStoryMaker<StoryArgs>();

  export default {
    title: 'UI/Button',
    component: Button,
    tags: ['autodocs'],
    argTypes: {
      variant: {
        control: 'select',
        options: ['primary', 'secondary', 'ghost']
      },
      size: {
        control: 'select',
        options: ['sm', 'md', 'lg']
      },
      disabled: { control: 'boolean' },
      label: { control: 'text' }
    }
  };

  export const Primary = createStory({
    args: {
      variant: 'primary',
      size: 'md',
      disabled: false,
      label: 'Primary Button'
    },
    render: (args) => {
      return {
        Component: Button,
        props: {
          variant: args.variant,
          size: args.size,
          disabled: args.disabled,
          children: () => args.label
        }
      };
    }
  });

  export const Secondary = createStory({
    args: {
      ...Primary.args,
      variant: 'secondary',
      label: 'Secondary Button'
    }
  });

  export const Disabled = createStory({
    args: {
      ...Primary.args,
      disabled: true,
      label: 'Disabled Button'
    }
  });

  export const AllVariants = createStory({
    ...Primary.args,
    render: () => ({
      template: `
        <div style="display: flex; gap: 8px;">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
        </div>
      `
    })
  });
</script>
```

### Correct: Accessibility
```svelte
<!-- Accessible form input -->
<script lang="ts">
  import * as paraglide from '$lib/paraglide';

  interface Props {
    name: string;
    label: string;
    type?: string;
    required?: boolean;
    disabled?: boolean;
    error?: string;
    value?: string;
    onchange?: (value: string) => void;
  }

  let {
    name,
    label,
    type = 'text',
    required = false,
    disabled = false,
    error,
    value = '',
    onchange
  }: Props = $props();

  let internalValue = $state(value);

  function handleChange(e: Event) {
    const target = e.target as HTMLInputElement;
    internalValue = target.value;
    onchange?.(target.value);
  }

  const hasError = $derived(!!error);
  const inputId = $derived(`${name}-input`);
  const errorId = $derived(`${name}-error`);
</script>

<div class="input-group">
  <label for={inputId}>
    {label}
    {#if required}
      <span class="required" aria-label="required">*</span>
    {/if}
  </label>

  <input
    id={inputId}
    name={name}
    type={type}
    {disabled}
    {required}
    bind:value={internalValue}
    onchange={handleChange}
    aria-invalid={hasError}
    aria-describedby={hasError ? errorId : undefined}
  />

  {#if hasError}
    <span id={errorId} class="error" role="alert">
      {error}
    </span>
  {/if}
</div>
```

### Incorrect: Hardcoded Text
```svelte
<!-- ❌ CRITICAL: Hardcoded English text -->
<h1>Welcome to our app</h1>
<button>Submit</button>
<p>Please enter your email</p>

<!-- ✅ CORRECT: Using i18n -->
<script lang="ts">
  import * as paraglide from '$lib/paraglide';
</script>

<h1>{$paraglide.t('app.welcome')}</h1>
<button>{$paraglide.t('actions.submit')}</button>
<p>{$paraglide.t('auth.enter-email')}</p>
```

### Correct: Focus Management
```css
/* Focus visible styles - only show for keyboard navigation */
.button:focus-visible {
  outline: 2px solid var(--color-primary-500);
  outline-offset: 2px;
}

/* Remove default focus for mouse */
.button:focus:not(:focus-visible) {
  outline: none;
}
```

## Handoff Instructions

| Finding | Send To |
|---------|---------|
| CSS hardcoded values | `css-reviewer` |
| Missing responsive styles | `css-reviewer` |
| Component state management issues | `local-first-reviewer` |
| Missing i18n | `local-first-reviewer` |
| Storybook missing | `coordinator` (warning) |

## Critical File References

- `apps/web/src/lib/components/ui/Button/Button.svelte` - Component structure
- `apps/web/src/lib/components/ui/Dialog/Dialog.svelte` - Melt UI integration
- `apps/web/src/lib/components/ui/Button/Button.stories.svelte` - Story format
- `apps/web/src/lib/components/ui/Input/Input.svelte` - Form input patterns
- `apps/web/src/lib/components/ui/Card/Card.svelte` - Snippet usage
- `apps/web/src/lib/composables/useDialog.ts` - Melt composable pattern
- `apps/web/src/lib/paraglide/messages.js` - i18n messages

## Anti-Patterns to Watch For

```svelte
<!-- ❌ CRITICAL: No runes -->
<script>
  export let value = 'default';
  let count = 0;
</script>

<!-- ❌ CRITICAL: Missing snippet -->
<script>
  interface Props {
    content: string;  // Should be children: Snippet
  }
</script>

<!-- ❌ CRITICAL: Hardcoded text -->
<h1>Welcome to our app</h1>

<!-- ❌ CRITICAL: No accessibility -->
<input />
<button>Submit</button>

<!-- ❌ CRITICAL: Using Svelte stores -->
<script>
  import { writable } from 'svelte/store';
  const count = writable(0);
</script>

<!-- ✅ CORRECT -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import * as paraglide from '$lib/paraglide';

  interface Props extends HTMLButtonAttributes {
    variant?: 'primary' | 'secondary';
    children: Snippet;
  }

  let { variant = 'primary', children, ...rest }: Props = $props();
  let count = $state(0);
  let doubled = $derived(count * 2);
</script>

<h1>{$paraglide.t('app.welcome')}</h1>

<button aria-label={$paraglide.t('actions.submit')} {...rest}>
  {@render children()}
</button>
```
