# Reference 08 — Testing

Unit tests, visual regression, and a11y tests specific to the Codex web app.

## 1. Testing Stack

| Layer | Tool | Location |
|---|---|---|
| Unit (components) | Vitest + custom mount helper | `apps/web/src/lib/**/*.svelte.test.ts` |
| Visual regression | Playwright + Storybook | `apps/web/tests/visual/` |
| A11y (automated) | Playwright + axe | `apps/web/tests/a11y/` |
| E2E | Playwright | `apps/web/tests/e2e/` |

Run via `pnpm test` (unit), `pnpm test:visual` (Storybook snapshots), `pnpm test:a11y` (axe),
`pnpm test:e2e` (E2E).

## 2. Unit Tests — The Custom Mount Helper

Vitest + native Svelte imperative API (not `@testing-library/svelte`) — chosen to avoid
runes-compatibility issues in uncompiled `node_modules`.

The helper lives at `apps/web/src/tests/utils/component-test-utils.svelte.ts`:

```ts
import { mount, unmount, textSnippet } from '$tests/utils/component-test-utils.svelte';
```

- `mount(Component, { target, props })` — returns an instance
- `unmount(instance)` — cleans up; always call in `afterEach`
- `textSnippet("…")` — creates a `Snippet` that renders a `<span>` with the given text
- `screen` — `@testing-library`-style query helpers backed by `document.body`:
  - `screen.getByRole(role, { name? })` — matches by ARIA / semantic role (`button`, `link`,
    `textbox`, `checkbox`, `heading`, plus any `[role="…"]`); optional `name` filters by
    visible text or `aria-label` (string includes or RegExp). Returns the first match or `null`.
  - `screen.getByTestId(id)` — matches `[data-testid="…"]`. Use sparingly — prefer `getByRole`
    when a semantic role exists.
  - `screen.getByText(text)` — walks text nodes and returns the parent element of the first
    match (string includes or RegExp).
  Canonical examples:
  - `apps/web/src/lib/components/ui/Button/Button.svelte.test.ts` — `getByRole('button', { name })`
  - `apps/web/src/lib/components/subscription/SubscribeButton.svelte.test.ts` — `getByTestId(…)`
  Plain `document.body.querySelector(...)` is still fine for low-level attribute / structural
  assertions; `screen` exists for cases where a semantic-role assertion is the contract you want
  to lock in (a11y-flavoured tests).

**Anti-patterns (do not reintroduce):**
- A `wait(ms: number) => Promise<void>` helper used to live alongside these utilities and was
  pruned in commit `a76a21ea` (Codex-9wsfr). Real timers cause flakes; use
  `vi.useFakeTimers()` + `await vi.advanceTimersByTimeAsync()` instead.
- An `htmlSnippet(html: string)` helper was pruned in the same commit because it had zero
  consumers and `createRawSnippet` (re-exported from svelte) covers the same need with
  sanitisation considered at the call site. If you need a raw-HTML snippet, build it inline
  with `createRawSnippet(() => ({ render: () => '<…>' }))`.

### Canonical test

```ts
import { afterEach, describe, expect, test } from 'vitest';
import { flushSync } from 'svelte';
import { mount, unmount, textSnippet } from '$tests/utils/component-test-utils.svelte';
import Button from './Button.svelte';

describe('Button', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) unmount(component);
    document.body.innerHTML = '';
  });

  test('renders children text', () => {
    component = mount(Button, {
      target: document.body,
      props: { children: textSnippet('Click me') },
    });

    const button = document.body.querySelector('button');
    expect(button).toBeTruthy();
    expect(button?.textContent).toContain('Click me');
  });

  test('applies data-variant attribute', () => {
    component = mount(Button, {
      target: document.body,
      props: { variant: 'destructive', children: textSnippet('Delete') },
    });
    expect(document.body.querySelector('button')?.getAttribute('data-variant')).toBe('destructive');
  });

  test('disabled state', () => {
    component = mount(Button, {
      target: document.body,
      props: { disabled: true, children: textSnippet('Disabled') },
    });
    expect(document.body.querySelector<HTMLButtonElement>('button')?.disabled).toBe(true);
  });

  test('loading state sets aria-busy', () => {
    component = mount(Button, {
      target: document.body,
      props: { loading: true, children: textSnippet('Loading') },
    });
    expect(document.body.querySelector('button')?.getAttribute('aria-busy')).toBe('true');
  });

  test('click handler', () => {
    let clicked = false;
    component = mount(Button, {
      target: document.body,
      props: { onclick: () => (clicked = true), children: textSnippet('Click') },
    });
    document.body.querySelector<HTMLButtonElement>('button')?.click();
    flushSync();
    expect(clicked).toBe(true);
  });
});
```

## 3. Testing Components That Need Parent Context

Some components (Melt UI sub-components like `DialogContent`, `TabsContent`, compound-component children) **require a parent context** to render. You have two options:

### Option A — Mount the parent with a children snippet (PREFERRED)

Svelte 5's snippet system makes test wrappers largely redundant. Render the child through the parent's `children` snippet:

```ts
import { createRawSnippet } from 'svelte';
import Dialog from './Dialog.svelte';
import DialogContent from './DialogContent.svelte';

test('DialogContent renders inside Dialog', () => {
  component = mount(Dialog, {
    target: document.body,
    props: {
      open: true,
      children: createRawSnippet(() => ({
        render: () => `<div data-testid="body">visible</div>`
      })),
    },
  });
  flushSync();
  expect(document.body.querySelector('[data-testid="body"]')).toBeTruthy();
});
```

### Option B — `TestWrapper.svelte` (removed)

A previous `TestWrapper.svelte` existed under `apps/web/src/tests/utils/` but was
deleted in the 2026-04-22 fallow audit (commit `e53978a5`). It used the deprecated
`<svelte:component this={...}>` syntax and had zero consumers. Use Option A.

### What NOT to do

```ts
// ANTI-PATTERN — existence-only test, proves nothing about behaviour
describe('DialogContent', () => {
  test('is defined', () => {
    expect(DialogContent).toBeDefined();     // coverage inflation
  });
});
```

Iter-05 caught several of these in Dialog + ErrorBoundary tests; they're being replaced. See anti-patterns in §11.

## 4. A11y Testing — Two Tiers

**There is no `axeCheck()` helper.** (Iter-05 corrected a skill-drift error here — the previous version of this reference cited a fictional API.) A11y is split into two tiers:

### Tier 1 — Inline ARIA attribute assertions

There is **no dedicated a11y helper module**. A previous `a11y-helpers.ts` was
deleted in the 2026-04-22 fallow audit (commit `e53978a5`) because its composite
matchers (`expectAccessibleButton`, `expectAccessibleInput`, etc.) had zero
real-world consumers — every test used plain `getAttribute('aria-*')` checks.

Assert ARIA contract directly against the DOM you mounted:

```ts
test('button announces loading state', () => {
  component = mount(Button, {
    target: document.body,
    props: { loading: true, children: textSnippet('Submit') },
  });
  const btn = document.body.querySelector('button')!;
  expect(btn).toBeTruthy();
  expect(btn.getAttribute('aria-busy')).toBe('true');
  expect(btn.getAttribute('aria-label') ?? btn.textContent).toContain('Submit');
  expect(btn.getAttribute('aria-hidden')).not.toBe('true');
});
```

```ts
test('input error wires aria-invalid + aria-describedby', () => {
  component = mount(Input, {
    target: document.body,
    props: { id: 'email', error: 'Required', 'aria-describedby': 'email-error' },
  });
  const input = document.body.querySelector('input')!;
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(input.getAttribute('aria-describedby')).toBe('email-error');
});
```

Keyboard behaviour — dispatch native events directly, no helper wrapper:

```ts
const input = document.body.querySelector('input')!;
input.focus();
input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
flushSync();
```

**What to check on a new component** (at least one assertion per applicable row):

| Attribute / behaviour | When it applies |
|---|---|
| `aria-label` or visible text | Any interactive control |
| `aria-busy="true"` | Async / loading state |
| `aria-invalid="true"` + `aria-describedby` | Form field error state |
| `aria-expanded` / `aria-controls` | Disclosure, menu, combobox |
| `aria-checked` / `aria-selected` | Checkbox, switch, tab, option |
| `role="dialog"` + `aria-modal="true"` + `aria-labelledby` | Custom dialog (non-Melt) |
| `tabindex` not `-1`, `aria-hidden` not `true` | Focusable interactive element |
| `document.activeElement` after Tab / focus call | Keyboard reachability |

Existing sample tests worth pattern-matching:

- `apps/web/src/lib/components/ui/Button/Button.svelte.test.ts` — `aria-busy`
- `apps/web/src/lib/components/ui/Input/Input.svelte.test.ts` — `aria-describedby`, `aria-label`
- `apps/web/src/lib/components/ui/Switch/Switch.svelte.test.ts` — `aria-checked`
- `apps/web/src/lib/components/ui/Tabs/Tabs.svelte.test.ts` — `aria-selected`

If you find yourself writing the same composite check 3+ times, that's the
signal to extract a helper in `$tests/utils/component-test-utils.svelte.ts` —
not to resurrect the deleted module.

### Tier 2 — Full axe-core audits via Playwright + Storybook

Full semantic a11y audits run as E2E tests at `apps/web/tests/a11y/components.spec.ts` using `@axe-core/playwright` against the Storybook build. Run via `pnpm test:a11y`. Stories cover each component variant × theme; axe runs against the rendered story.

**Rule**: new components ship with (a) at least one ARIA composite check in their unit test + (b) a Storybook story so the E2E axe audit can reach them.

### NOT documented / out of scope

Vitest-time axe checks on JSDOM are not used — JSDOM's layout/accessibility tree is incomplete, so axe produces false negatives. All axe lives in Playwright where a real browser renders the tree.

## 5. What to Test

| Concern | Test what |
|---|---|
| Variants | Each `data-variant` value sets the attribute and the expected styling class |
| Sizes | Each `data-size` value sets the attribute |
| States | `disabled`, `loading`, `open`, etc. render the expected attributes (`aria-busy`, `disabled`, `data-state`) |
| Props forwarding | `class` prop merges, `...restProps` spreads to root |
| Children slots | `children` (and named snippets) render in the right positions |
| Event handlers | `onclick` (etc.) fire with `flushSync()` |
| Keyboard | Tab order, Enter/Space/Escape behaviour for custom interactive primitives |
| Bindable values | `bind:value` round-trips input changes |
| A11y | At least one inline ARIA attribute assertion (Tier 1 — see §4) + a Storybook story so the Playwright axe audit (Tier 2) reaches it |

## 6. What NOT to Test

- **Melt UI internals.** Don't test that clicking a trigger opens the dialog — Melt tests that. Test that *your wrapper* connects the prop to the Melt open state.
  - ✅ OK: assert on `data-state="open"`, `data-state="checked"` — those are **documented Melt contracts** the wrapper forwards.
  - ❌ NOT OK: assert on `data-melt-*` attributes — those are Melt **internals** that can rename between versions without notice. Iter-05 caught these in Accordion + Tabs tests (being removed).
- **Existence-only tests.** `expect(Component).toBeDefined()` proves the import worked; it does not prove behaviour. Either exercise the component or delete the test.
- **Token values.** Don't assert `expect(computedStyle.padding).toBe('8px')`. Tokens can change; behaviour shouldn't.
- **Visual appearance.** Use Playwright visual regression for that, not unit tests.
- **Framework internals.** Don't test that `$derived` is reactive — Svelte tests that.
- **Third-party library outputs.** Trust them; mock them when boundary-testing.

## 7. Visual Regression — Playwright + Storybook

Components that have meaningful visual variants deserve Storybook stories in
`apps/web/src/lib/components/**/ComponentName.stories.svelte`. Playwright snapshots each
story at breakpoints and per-theme.

```
# Run Storybook, capture baseline
pnpm test:visual

# Update baseline after intentional visual change
pnpm test:visual --update-snapshots
```

Rules:
- Stories cover every variant × every theme × canonical breakpoints (mobile, desktop)
- Disable animation in snapshot stories (`body { animation-duration: 0ms !important; }`) to avoid flaky captures
- Baseline updates require a PR reviewer to visually confirm — never auto-accept

## 8. E2E Tests

Only for user journeys that span multiple routes or involve auth/payment. Most UI changes
don't need new E2E coverage — unit + visual is usually enough.

## 9. Testing Patterns for Specific Component Types

### Melt UI Wrapper

Focus on the contract between your wrapper and Melt:

```ts
test('opens when prop flips true', async () => {
  let open = $state(false);
  component = mount(Dialog, { target: document.body, props: { get open() { return open }, set open(v) { open = v } } });
  open = true;
  flushSync();
  expect(document.body.querySelector('[data-melt-dialog-content]')).toBeTruthy();
});
```

### Form Component

- Label association
- Error state (`aria-invalid`)
- Submit fires with correct value
- `required` rejects empty submit

### Interactive Primitive (custom, not Melt)

- Full keyboard matrix (Tab, Enter, Space, Escape, arrows as relevant) — dispatch
  `new KeyboardEvent('keydown', { key, bubbles: true })` on the focused element
- Focus visibility on tab entry — assert `document.activeElement` after a focus call
- Inline ARIA contract assertions (`role`, `aria-*` attributes — see §4 Tier 1)
- Full axe audit via Playwright story (Tier 2 per §4)

## 10. Running a Single Test File

```
pnpm test apps/web/src/lib/components/ui/Button/Button.svelte.test.ts
```

Watch mode: `pnpm test:watch`.

## 11. Gotchas / Anti-patterns

- **Don't** use `@testing-library/svelte` — it has runes compatibility issues. Use the custom `mount()` helper.
- **Don't** forget `afterEach(() => { if (c) unmount(c); document.body.innerHTML = ''; })`. Leaked DOM breaks the next test.
- **Don't** forget `flushSync()` after triggering an event — Svelte 5 batches updates; without the flush your assertion runs before the DOM updates.
- **Don't** snapshot component output as HTML strings. Brittle. Assert on attributes and DOM structure instead.
- **Don't** test Melt UI behaviour through your wrapper — test only the contract (prop → state, state → prop).
- **Don't** assert computed CSS values. Tokens change; behaviour shouldn't. Use `data-*` attributes as the contract.
- **Don't** rely on timers without `vi.useFakeTimers()`. Real timers make tests flaky.
- **Don't** assert on `data-melt-*` attributes. Only `data-state` is a Melt contract; anything else is internal.
- **Don't** write existence-only `toBeDefined()` tests — coverage inflation, proves nothing about behaviour.
- **Don't** skip the Storybook story for a new component — without a story, the Playwright axe audit can't reach it.

## 12. When to Re-Verify This Reference

- `apps/web/src/tests/utils/component-test-utils.svelte.ts` — the mount helper API
  (the only file in `src/tests/utils/` as of 2026-04-22)
- `apps/web/tests/a11y/components.spec.ts` — the axe-core Playwright authority (Tier 2 a11y)
- `apps/web/src/lib/components/ui/**/*.svelte.test.ts` — canonical Tier 1 examples
  (Button for `aria-busy`, Input for `aria-invalid` + `aria-describedby`,
  Switch for `aria-checked`, Tabs for `aria-selected`)
- `apps/web/package.json` scripts — test command names
- `apps/web/vite.config.ts` — test include patterns, environment, setup files

If the code disagrees, **the code wins**. This reference is now the only testing
runbook — `apps/web/tests/TESTING.md` was removed in the 2026-04-22 fallow audit
(commit `e53978a5`), so any testing guidance MUST land here.
