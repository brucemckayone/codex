# 11. Engineering Contract

**Design ≠ implementation unless this is explicit.**

---

## Purpose

Design systems fail when design and code diverge.

**This document defines**:
- Source of truth (where decisions live)
- Token naming (how design becomes code)
- Component API standards (how to use components)
- Performance requirements (non-negotiable constraints)
- Testing expectations (quality bar)

**Goal**: Design and engineering speak the same language.

---

## Source of Truth

### Hierarchy

```
1. Design Philosophy (why decisions made)
   ↓
2. Design Tokens (JSON) (design decisions as data)
   ↓
3. Component Documentation (usage contracts)
   ↓
4. Implementation (code that follows above)
```

**If code contradicts tokens**: Code is wrong.
**If tokens contradict philosophy**: Tokens are wrong.

---

### Token Files

**Location**: `/design-system/tokens/*.tokens.json`

**Format**: JSON (parseable by tools)

**Example**:
```json
{
  "color": {
    "text": {
      "primary": {
        "value": "#111827",
        "type": "color"
      }
    }
  }
}
```

**Tools**: Style Dictionary, Tokens Studio

---

## Token Naming Convention

### Format

`{category}.{role}.{variant}.{state}`

**Examples**:
```
color.text.primary               (category.role.variant)
color.action.primary.hover       (category.role.variant.state)
spacing.section.default          (category.role.variant)
typography.heading.h1.fontSize   (category.role.variant.property)
```

---

### Categories

- `color` → All colors (text, bg, border)
- `typography` → Font sizes, weights, line heights
- `spacing` → Margins, padding, gaps
- `shadow` → Box shadows, elevations
- `radius` → Border radii
- `motion` → Animation durations, easing
- `zIndex` → Stacking order

---

### Naming Rules

1. **Semantic names** (not appearance-based)
   - ✅ `color.action.primary`
   - ❌ `color.blue.500`

2. **Consistent structure** (same order)
   - ✅ `color.bg.primary`, `color.bg.secondary`
   - ❌ `color.primary.bg`, `bgColor.primary`

3. **No abbreviations** (clarity over brevity)
   - ✅ `color.background.primary`
   - ❌ `color.bg.pri`

---

## Component API Standards

### Props Convention

**Required props**:
```typescript
children?: ReactNode;    // Content
className?: string;      // Style overrides
id?: string;             // DOM reference
```

**Common props**:
```typescript
variant?: 'primary' | 'secondary' | ...;
size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
disabled?: boolean;
loading?: boolean;
error?: boolean | string;
```

**Event props**:
```typescript
onClick?: (e: MouseEvent) => void;
onChange?: (value: T) => void;
onFocus?: (e: FocusEvent) => void;
onBlur?: (e: FocusEvent) => void;
```

---

### Prop Naming

**Boolean props**: Prefix with `is`, `has`, `can`, `should`
```typescript
isLoading?: boolean;
hasError?: boolean;
canEdit?: boolean;
```

**Event handlers**: Prefix with `on`
```typescript
onClick, onChange, onSubmit
```

**Do not use**: Negative booleans (`notDisabled`, `isNotVisible`)

---

### Default Props

**Always define defaults**:
```typescript
Button.defaultProps = {
  variant: 'primary',
  size: 'md',
  type: 'button',
};
```

**Why?** Predictable behavior, fewer bugs

---

## Performance Requirements

### Bundle Size

**Target**:
- Core components: < 50KB (gzipped)
- Full library: < 200KB (gzipped)

**Measure with**: `bundlephobia`, webpack-bundle-analyzer

---

### Runtime Performance

**Non-negotiable**:
- First render: < 16ms (60fps)
- Re-renders: < 16ms (60fps)
- Scroll: 60fps maintained

**Test with**: React DevTools Profiler, Lighthouse

---

### Animation Performance

**Only animate**:
- `transform` (translate, scale, rotate)
- `opacity`

**Never animate**:
- `width`, `height` (causes reflow)
- `top`, `left` (causes reflow)
- `margin`, `padding` (causes reflow)

**Why?** GPU-accelerated properties = 60fps, layout properties = jank

---

### Code Splitting

**Strategy**: Lazy load non-critical components

```javascript
const Modal = lazy(() => import('./Modal'));
const DataTable = lazy(() => import('./DataTable'));
```

**When to split**:
- Modals (not always visible)
- Large components (> 20KB)
- Feature-specific patterns

**Don't split**:
- Primitives (Button, Input) — used everywhere
- Critical path components

---

## TypeScript Requirements

### Type Safety

**All components**:
```typescript
export interface ButtonProps {
  variant?: 'primary' | 'secondary';
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
}

export const Button: React.FC<ButtonProps> = ({ ... }) => { ... };
```

**No `any`**: Use `unknown` and type guards instead

---

### Token Types

**Auto-generated from JSON**:
```typescript
// Generated from tokens/color.tokens.json
export type ColorTokens = {
  text: {
    primary: string;
    secondary: string;
  };
  // ...
};
```

**Tooling**: Style Dictionary

---

## Testing Standards

### Unit Tests (Required)

**Coverage target**: 80% minimum

**Test**:
- All props work correctly
- All variants render correctly
- Event handlers fire
- Accessibility attributes present

**Tool**: Jest + React Testing Library

---

### Visual Regression Tests

**Tool**: Chromatic, Percy, or Storybook

**Coverage**:
- All component states
- All variants
- Light/dark mode
- Mobile/desktop breakpoints

---

### Accessibility Tests

**Automated**: axe-core (in tests)
```javascript
import { axe } from 'jest-axe';

it('should have no accessibility violations', async () => {
  const { container } = render(<Button>Click</Button>);
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});
```

**Manual**: Keyboard navigation, screen reader

---

## Documentation Requirements

**Every component must have**:

### 1. README

- Purpose
- Props API
- Usage examples
- Accessibility notes
- Do's & Don'ts

### 2. Storybook Stories

- All variants
- All states
- Interactive controls
- Code examples

### 3. TypeScript Docs

```typescript
/**
 * Primary button component for main actions.
 *
 * @example
 * <Button variant="primary" onClick={handleClick}>
 *   Save Changes
 * </Button>
 */
export const Button: React.FC<ButtonProps> = ({ ... }) => { ... };
```

---

## Platform Compatibility

**Target browsers**:
- Chrome (last 2 versions)
- Firefox (last 2 versions)
- Safari (last 2 versions)
- Edge (last 2 versions)

**Mobile**:
- iOS Safari (last 2 versions)
- Android Chrome (last 2 versions)

**No support**:
- IE11 (deprecated)

---

## Code Style

### Prettier

**Config**: `.prettierrc`
```json
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "printWidth": 80
}
```

---

### ESLint

**Rules**:
- No unused vars
- No console.log (use proper logging)
- Prefer const over let
- React Hooks rules
- Accessibility rules (eslint-plugin-jsx-a11y)

---

## Version Control

### Git Workflow

**Branches**:
```
main          → Production-ready code
develop       → Integration branch
feature/*     → New components/features
fix/*         → Bug fixes
```

**Commits**: Conventional Commits
```
feat: add Button component
fix: correct focus ring color in dark mode
docs: update Typography guidelines
```

---

### Changesets

**Tool**: Changesets (automated versioning)

**Process**:
1. Make changes
2. Run `changeset` → describe change
3. PR merged → version bumped automatically
4. Changelog generated

---

## Release Process

### Steps

1. **Code review** (2 approvals required)
2. **Tests pass** (unit, visual, a11y)
3. **Changeset added** (version bump documented)
4. **Merge to main**
5. **Publish** (automated via CI/CD)
6. **Announcement** (Slack, changelog)

---

## Living Document

Engineering contracts evolve. Changes require:

1. Proposal (RFC)
2. Team review
3. Documentation update
4. Migration guide (if breaking)

**Change log**:

| Date | Change | Reasoning |
|------|--------|-----------|
| 2026-01-01 | Initial engineering contract | Foundation |

---

Next: [12. Governance & Evolution →](../12-governance/README.md)
