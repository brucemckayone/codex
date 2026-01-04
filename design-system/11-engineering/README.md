# 11. Engineering Contract

**Code as craft. How implementation embodies our values.**

---

## Foundation

This document bridges design philosophy and implementation.

Every engineering decision must answer: **Does this code serve the community we're building for?**

---

## Engineering Philosophy

### Code Serves Community

Code isn't just correct—it expresses values.

Consider how creative studios maintain their craft:

| Studio Practice | Engineering Equivalent |
|-----------------|----------------------|
| Yoga instructor respects all bodies | Code respects all devices, connections, abilities |
| Dance company rehearses until seamless | Testing until experience is flawless |
| Music school tunes instruments daily | Maintaining and updating dependencies |
| Art gallery preserves works carefully | Backward compatibility, migrations |

**Our code is our craft.** Rushed, sloppy, or exclusionary code betrays the community.

---

### The Engineering Spectrum

```
Fragile ◄──────────────────────────────────────────► Rigid

Quick hacks  Technical debt  Pragmatic ║  Codex  ║  Proper   Over-engineered
Ship fast    Fix later       "Good enough"║       ║  Tested   Perfect enemy
    │            │               │        ║       ║    │          │
    └────────────┴───────────────┴────────╨───────╨────┴──────────┘
                                          ▲
                                    We live here
```

**Codex engineering is:**
- Quality-focused (not shipping broken experiences)
- Pragmatic (not over-engineered)
- User-centered (performance, accessibility, reliability)
- Maintainable (future developers are users too)

---

### Core Engineering Principles

1. **Implementation Follows Philosophy**
   - If design says warm, code produces warm
   - If design says accessible, code is accessible
   - Code is the final expression of intent

2. **Performance Is Respect**
   - Fast load times respect users' time
   - Small bundles respect users' bandwidth
   - Smooth animation respects users' attention

3. **Accessibility Is Non-Negotiable**
   - Every component keyboard-accessible
   - Every interaction screen-reader announced
   - See [09. Accessibility](../09-accessibility/README.md)

4. **Type Safety Is Trust**
   - TypeScript prevents bugs
   - Bugs break user trust
   - Broken trust breaks community

---

## Source of Truth

### The Hierarchy

```
Philosophy (01)     → WHY we make decisions
        ↓
Design Tokens       → WHAT values to use
        ↓
Component Docs      → HOW to use components
        ↓
Implementation      → CODE that follows all above
```

**Conflict resolution:**
- If code contradicts tokens → **Code is wrong**
- If tokens contradict philosophy → **Tokens are wrong**
- Philosophy is the highest authority

---

### Token Files

**Location:** `/design-system/tokens/`

**Structure:**
```
tokens/
├── color.tokens.json      → All color primitives
├── semantic.tokens.json   → Semantic color mappings
├── typography.tokens.json → Type scale, weights
├── spacing.tokens.json    → Spacing scale
├── shadow.tokens.json     → Elevation shadows
├── motion.tokens.json     → Duration, easing
└── index.ts               → Type-safe exports
```

**Format:** JSON (parseable, portable)

```json
{
  "color": {
    "teal": {
      "500": {
        "value": "#14B8A6",
        "type": "color",
        "description": "Primary action color"
      }
    },
    "cream": {
      "50": {
        "value": "#FFFBF5",
        "type": "color",
        "description": "Default surface, warm white"
      }
    }
  }
}
```

---

## Token Naming Convention

### Format

`{category}.{role}.{variant}.{state}`

**Examples:**
```typescript
// Semantic tokens (use these in components)
color.surface.default         // cream-50 in light mode
color.surface.elevated        // white in light mode
color.text.primary            // cream-900 in light mode
color.action.primary          // teal-500
color.action.primary.hover    // teal-600
color.feedback.success        // green-500

// Spacing
spacing.xs                    // 4px
spacing.sm                    // 8px
spacing.md                    // 16px
spacing.lg                    // 24px
spacing.xl                    // 32px
spacing.section               // 64px

// Typography
typography.body.size          // 16px
typography.body.lineHeight    // 1.5
typography.heading.h1.size    // 48px
typography.heading.h1.weight  // 700

// Motion
motion.duration.quick         // 200ms
motion.duration.smooth        // 300ms
motion.easing.easeOut         // cubic-bezier(0.0, 0.0, 0.2, 1)
```

---

### Naming Rules

1. **Semantic over literal**
   ```typescript
   // ✅ Good — describes purpose
   color.action.primary
   color.surface.elevated
   color.feedback.error

   // ❌ Bad — describes appearance
   color.teal.500
   color.white
   color.red
   ```

2. **Consistent structure**
   ```typescript
   // ✅ Good — same pattern
   color.text.primary
   color.text.secondary
   color.text.tertiary

   // ❌ Bad — inconsistent
   color.primaryText
   textColor.secondary
   color.text.third
   ```

3. **No abbreviations in public API**
   ```typescript
   // ✅ Good — clear
   color.background.elevated
   spacing.component.padding

   // ❌ Bad — unclear
   color.bg.elev
   space.comp.pad
   ```

---

### CSS Custom Properties

Tokens become CSS custom properties:

```css
:root {
  /* Color */
  --color-surface-default: #FFFBF5;
  --color-surface-elevated: #FFFFFF;
  --color-text-primary: #1C1917;
  --color-text-secondary: #57534E;
  --color-action-primary: #14B8A6;

  /* Spacing */
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;

  /* Typography */
  --typography-body-size: 16px;
  --typography-body-line-height: 1.5;

  /* Motion */
  --motion-duration-quick: 200ms;
  --motion-easing-ease-out: cubic-bezier(0.0, 0.0, 0.2, 1);

  /* Shadow (warm-tinted) */
  --shadow-sm: 0 1px 2px rgba(45, 42, 37, 0.06);
  --shadow-md: 0 4px 6px rgba(45, 42, 37, 0.08);
}
```

---

## Component API Standards

### Base Props Interface

Every component inherits base props:

```typescript
interface BaseProps {
  /** Additional CSS classes */
  className?: string;
  /** DOM id for reference */
  id?: string;
  /** Test identifier */
  'data-testid'?: string;
}
```

---

### Common Props Patterns

**Interactive components:**
```typescript
interface InteractiveProps extends BaseProps {
  /** Visual style variant */
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  /** Size variant */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  /** Disables interaction */
  disabled?: boolean;
  /** Shows loading state */
  loading?: boolean;
}
```

**Form components:**
```typescript
interface FormProps extends InteractiveProps {
  /** Field name for forms */
  name: string;
  /** Current value */
  value?: string;
  /** Error message or boolean */
  error?: string | boolean;
  /** Field is required */
  required?: boolean;
  /** Change handler */
  onChange?: (value: string) => void;
}
```

---

### Prop Naming Conventions

**Booleans:** Use positive statements
```typescript
// ✅ Good
disabled?: boolean;
loading?: boolean;
required?: boolean;

// ❌ Bad — double negatives confuse
notDisabled?: boolean;
isNotLoading?: boolean;
```

**Event handlers:** Prefix with `on`
```typescript
// ✅ Good
onClick?: (e: MouseEvent) => void;
onChange?: (value: string) => void;
onFocus?: () => void;
onBlur?: () => void;
onSubmit?: (data: FormData) => void;
```

**Render props:** Prefix with `render`
```typescript
// ✅ Good
renderIcon?: () => ReactNode;
renderLabel?: (value: string) => ReactNode;
```

---

### Default Props

Always define sensible defaults:

```typescript
const Button: FC<ButtonProps> = ({
  variant = 'primary',      // Default: primary action
  size = 'md',              // Default: touch-friendly 44px
  type = 'button',          // Default: button (not submit)
  disabled = false,
  loading = false,
  children,
  ...props
}) => {
  // ...
};
```

**Why defaults?**
- Predictable behavior
- Fewer props needed for common cases
- Documentation of expected use

---

### Forwarded Refs

All components forward refs for DOM access:

```typescript
const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ children, ...props }, ref) => {
    return (
      <button ref={ref} {...props}>
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
```

---

## TypeScript Requirements

### Strict Mode

**Required config:**
```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUncheckedIndexedAccess": true
  }
}
```

---

### No `any`

```typescript
// ❌ Bad — loses type safety
function handleEvent(e: any) { ... }

// ✅ Good — explicit types
function handleEvent(e: MouseEvent<HTMLButtonElement>) { ... }

// ✅ Good — unknown with type guard
function handleUnknown(value: unknown) {
  if (typeof value === 'string') {
    // value is now string
  }
}
```

---

### Token Type Generation

Tokens auto-generate TypeScript types:

```typescript
// Generated from tokens/color.tokens.json
export interface ColorTokens {
  surface: {
    default: string;
    elevated: string;
    muted: string;
  };
  text: {
    primary: string;
    secondary: string;
    tertiary: string;
  };
  action: {
    primary: string;
    primaryHover: string;
    secondary: string;
    secondaryHover: string;
  };
  feedback: {
    success: string;
    error: string;
    warning: string;
    celebration: string;
  };
}
```

**Tooling:** Style Dictionary generates types from JSON

---

## Performance Requirements

### Bundle Size

| Package | Target (gzipped) | Notes |
|---------|------------------|-------|
| Core primitives | < 30KB | Button, Input, etc. |
| Full component library | < 150KB | All components |
| Design tokens | < 5KB | CSS custom properties |

**Measurement tools:**
- `bundlephobia` (npm package size)
- `webpack-bundle-analyzer` (bundle composition)
- `source-map-explorer` (code source breakdown)

---

### Runtime Performance

**Non-negotiable targets:**

| Metric | Target | Why |
|--------|--------|-----|
| First contentful paint | < 1.5s | Users notice delays > 1s |
| Time to interactive | < 3s | Users leave after 3s |
| Component render | < 16ms | 60fps (1000ms / 60 frames) |
| Scroll performance | 60fps | Jank is disrespectful |

**Testing tools:**
- Chrome DevTools Performance
- React DevTools Profiler
- Lighthouse

---

### Animation Performance

**GPU-accelerated only:**
```css
/* ✅ Good — GPU-accelerated */
transform: translateX(100px);
transform: scale(1.1);
transform: rotate(45deg);
opacity: 0.5;

/* ❌ Bad — triggers layout/paint */
width: 100px;     /* Layout */
height: 100px;    /* Layout */
top: 50px;        /* Layout */
left: 50px;       /* Layout */
margin: 20px;     /* Layout */
padding: 20px;    /* Layout */
```

**Why?** Layout-triggering properties cause jank. Users feel it.

---

### Code Splitting

**Split these:**
```typescript
// Large, not always needed
const Modal = lazy(() => import('./Modal'));
const DataTable = lazy(() => import('./DataTable'));
const RichTextEditor = lazy(() => import('./RichTextEditor'));
const VideoPlayer = lazy(() => import('./VideoPlayer'));
```

**Don't split:**
```typescript
// Small, used everywhere
import { Button } from './Button';
import { Input } from './Input';
import { Label } from './Label';
```

---

## Testing Standards

### Unit Tests

**Coverage target:** 80% minimum

**Test categories:**
```typescript
describe('Button', () => {
  // Rendering
  it('renders children correctly', () => { ... });
  it('renders all variants', () => { ... });
  it('renders all sizes', () => { ... });

  // States
  it('handles disabled state', () => { ... });
  it('handles loading state', () => { ... });

  // Interactions
  it('calls onClick when clicked', () => { ... });
  it('does not call onClick when disabled', () => { ... });

  // Accessibility
  it('has accessible name', () => { ... });
  it('has correct role', () => { ... });
});
```

**Tools:** Jest + React Testing Library

---

### Accessibility Tests

**Automated (axe-core):**
```typescript
import { axe, toHaveNoViolations } from 'jest-axe';

expect.extend(toHaveNoViolations);

it('has no accessibility violations', async () => {
  const { container } = render(<Button>Join now</Button>);
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});
```

**Manual testing required:**
- Keyboard navigation (Tab, Enter, Escape)
- Screen reader announcement (VoiceOver, NVDA)
- Focus visibility on all backgrounds

---

### Visual Regression Tests

**Tool:** Chromatic, Percy, or Playwright

**Test matrix:**
```
For each component:
├── All variants (primary, secondary, etc.)
├── All sizes (xs, sm, md, lg, xl)
├── All states (default, hover, active, disabled, loading)
├── Light mode
├── Dark mode
├── Mobile viewport (375px)
├── Tablet viewport (768px)
└── Desktop viewport (1280px)
```

---

### Integration Tests

**Test real user flows:**
```typescript
describe('Content Access Flow', () => {
  it('allows member to access content', async () => {
    // Render content card
    // Click "Watch now"
    // Verify video player opens
    // Verify playback controls work
  });

  it('shows join prompt for non-members', async () => {
    // Render content card as guest
    // Click "Get access"
    // Verify join modal appears
    // Verify correct pricing shown
  });
});
```

---

## Documentation Requirements

### Component README

Every component needs:

```markdown
# ComponentName

## Purpose
What problem this solves.

## Usage
\`\`\`tsx
import { ComponentName } from '@codex/components';

<ComponentName variant="primary">
  Content here
</ComponentName>
\`\`\`

## Props
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| variant | 'primary' \| 'secondary' | 'primary' | Visual style |

## Accessibility
- Keyboard: Tab to focus, Enter to activate
- Screen reader: Announces as [role]
- Focus ring: teal-300, 3px

## Examples
[Storybook link]

## Do's and Don'ts
✅ Do: Use primary variant for main action
❌ Don't: Use multiple primary buttons in same view
```

---

### JSDoc Comments

```typescript
/**
 * Primary button for main actions.
 *
 * Use one primary button per view to guide user attention.
 * For secondary actions, use `variant="secondary"`.
 *
 * @example
 * ```tsx
 * <Button variant="primary" onClick={handleJoin}>
 *   Join the community
 * </Button>
 * ```
 *
 * @see https://design-system.codex.com/components/button
 */
export const Button: FC<ButtonProps> = ({ ... }) => { ... };
```

---

### Storybook Stories

```typescript
// Button.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './Button';

const meta: Meta<typeof Button> = {
  title: 'Primitives/Button',
  component: Button,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'outline', 'ghost', 'danger'],
    },
    size: {
      control: 'select',
      options: ['xs', 'sm', 'md', 'lg', 'xl'],
    },
  },
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Primary: Story = {
  args: {
    children: 'Join the community',
    variant: 'primary',
  },
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex gap-4">
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="danger">Danger</Button>
    </div>
  ),
};
```

---

## Code Style

### Prettier Config

```json
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "printWidth": 100,
  "trailingComma": "es5",
  "bracketSpacing": true,
  "jsxSingleQuote": false
}
```

---

### ESLint Rules

**Required plugins:**
- `@typescript-eslint` — TypeScript rules
- `eslint-plugin-react` — React best practices
- `eslint-plugin-react-hooks` — Hooks rules
- `eslint-plugin-jsx-a11y` — Accessibility rules

**Key rules:**
```javascript
{
  'no-console': 'warn',                    // Use proper logging
  'no-unused-vars': 'error',               // Clean code
  'prefer-const': 'error',                 // Immutability
  'react-hooks/rules-of-hooks': 'error',   // Hook correctness
  'react-hooks/exhaustive-deps': 'warn',   // Dependency arrays
  'jsx-a11y/alt-text': 'error',            // Images need alt
  'jsx-a11y/click-events-have-key-events': 'error',  // Keyboard
}
```

---

## Version Control

### Branch Strategy

```
main              → Production-ready, deployed
        ↓
feature/*         → New components (branch from main)
fix/*             → Bug fixes (branch from main)
docs/*            → Documentation updates
```

---

### Commit Messages

**Conventional Commits:**
```
feat(Button): add loading state with spinner
fix(Modal): correct focus trap on close
docs(Typography): update line height examples
refactor(tokens): migrate from gray to cream scale
test(Card): add visual regression tests
```

**Scopes:**
- Component name: `feat(Button):`
- Token category: `refactor(color):`
- Documentation: `docs(typography):`
- Build/tooling: `chore(deps):`

---

### Changesets

**Process:**
1. Make changes
2. Run `pnpm changeset`
3. Describe change (major/minor/patch)
4. Commit changeset file
5. PR merge → version bump automatic
6. Changelog auto-generated

---

## Release Process

### Checklist

```
□ All tests pass
  □ Unit tests (Jest)
  □ Accessibility tests (axe)
  □ Visual regression (Chromatic)
  □ Integration tests

□ Documentation complete
  □ README updated
  □ Storybook stories
  □ JSDoc comments

□ Review complete
  □ Code review (2 approvals)
  □ Design review (if visual changes)
  □ Accessibility review (if interaction changes)

□ Changeset added
  □ Version bump described
  □ Breaking changes documented
  □ Migration guide (if needed)

□ Release
  □ Merge to main
  □ CI/CD publishes
  □ Changelog posted
```

---

## Platform Compatibility

### Browser Support

| Browser | Versions | Priority |
|---------|----------|----------|
| Chrome | Last 2 | High |
| Firefox | Last 2 | High |
| Safari | Last 2 | High |
| Edge | Last 2 | High |
| iOS Safari | Last 2 | High |
| Android Chrome | Last 2 | High |

**No support:** IE11 (deprecated)

---

### CSS Feature Support

```css
/* ✅ Use freely */
CSS Grid
CSS Custom Properties
Flexbox
@media (prefers-color-scheme)
@media (prefers-reduced-motion)
@media (prefers-contrast)

/* ⚠️ Use with fallback */
:has() selector       /* Safari 15.4+ */
Container queries     /* Chrome 105+, Safari 16+ */
```

---

## Anti-Patterns

| Anti-Pattern | Why It's Wrong | What Instead |
|--------------|----------------|--------------|
| Hard-coded colors | Breaks theming, maintenance hell | Use semantic tokens |
| `any` type | Loses type safety | Use explicit types or `unknown` |
| Animating layout properties | Causes jank | Animate transform/opacity only |
| Missing keyboard support | Excludes users | All interactions keyboard-accessible |
| No error boundaries | Broken UI stays broken | Wrap with error boundaries |
| Giant bundle imports | Slow load times | Tree-shake, code-split |
| Testing implementation | Brittle tests | Test behavior |
| Skipping a11y tests | Excludes users | Automated + manual a11y testing |

---

## The Craft Test

Before shipping any code:

1. **Does it respect users?** Fast, accessible, reliable
2. **Does it follow the design system?** Uses tokens, patterns, conventions
3. **Is it tested?** Unit, accessibility, visual, integration
4. **Is it documented?** README, Storybook, JSDoc
5. **Would you be proud of this code?** Craftsmanship matters

If any answer is no → improve before shipping.

---

## Living Document

Engineering standards evolve. Changes require:

1. RFC proposal
2. Team review
3. Documentation update
4. Migration guide (if breaking)
5. Changelog entry

| Date | Change | Reasoning |
|------|--------|-----------|
| 2026-01-01 | Initial engineering contract | Foundation |
| 2026-01-03 | Complete rewrite | Alignment with Mission. Added warmth philosophy, cream/teal tokens, community-focused examples, expanded testing requirements. |

---

## Summary

**Codex engineering in one breath:**

> Code is craft in service of community. We write performant code because users deserve fast experiences. We write accessible code because everyone belongs. We write tested code because broken experiences break trust. We write documented code because future maintainers are users too. Every line expresses our values.

**The test:**

> Would you ship this code to someone you care about?

If yes → ship it.
If hesitant → improve it first.

---

**Upstream**: [10. Theming](../10-theming/README.md)
**Downstream**: [12. Governance](../12-governance/README.md)

---

*Last updated: 2026-01-03*
*Version: 2.0*
*Status: Foundation document — code as craft*
