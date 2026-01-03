# 06. Component Architecture

**Building blocks of belonging. How UI elements embody community.**

---

## Foundation

This document builds on all previous foundations to create components that feel like they belong in a creative studio, not a corporate dashboard.

Every component must answer: **Does this feel warm and welcoming, or cold and transactional?**

---

## Component Philosophy

### Components as Expressions of Values

Components aren't just UI elements—they're expressions of our values:

| Philosophy Principle | Component Expression |
|---------------------|---------------------|
| Belonging over buying | "Join" not "Add to cart" |
| Collaboration by design | Multi-creator attribution |
| Transformation over consumption | Journey progress, not watch time |
| Warm professionalism | Rounded, warm, but not cutesy |
| Trust through light | Visible states, clear feedback |
| Celebrate together | Community milestones, shared wins |

### The Component Character

All components share a personality:

```
Cold ◄──────────────────────────────────────────► Warm

Sharp    Angular   Neutral  ║ Codex ║  Soft    Bubbly
Edges    Precise   Generic  ║       ║  Rounded  Cute
  │         │         │     ║       ║    │        │
  └─────────┴─────────┴─────╨───────╨────┴────────┘
                            ▲
                      We live here
```

**Codex components are:**
- Rounded (8px default radius)
- Warm (cream backgrounds, teal accents)
- Generous (comfortable padding)
- Clear (obvious states and affordances)
- Human (approachable, not intimidating)

---

## Component Taxonomy

### Level 1: Primitives

**Single-purpose, foundational elements**

```
Primitives
├── Button         → Actions
├── Input          → Text entry
├── Textarea       → Long text entry
├── Checkbox       → Binary selection
├── Radio          → Single selection
├── Toggle         → On/off state
├── Select         → Dropdown selection
├── Label          → Form labels
├── Icon           → Visual symbols
├── Avatar         → User representation
├── Badge          → Status/counts
└── Link           → Navigation
```

**Characteristics:**
- No nested components
- Single responsibility
- Maximum reusability
- Minimal internal logic

---

### Level 2: Compounds

**Primitives combined into useful patterns**

```
Compounds
├── FormField      → Label + Input + Helper + Error
├── SearchBar      → Input + Icon + Clear button
├── Card           → Container + Header + Body + Footer
├── Alert          → Icon + Title + Message + Actions
├── Dropdown       → Trigger + Menu + Items
├── Tooltip        → Trigger + Content bubble
├── Modal          → Overlay + Dialog + Actions
├── Tabs           → Tab list + Tab panels
└── Toast          → Icon + Message + Dismiss
```

**Characteristics:**
- 2-5 primitives composed together
- Encapsulate common patterns
- Reusable across features
- Some internal state

---

### Level 3: Patterns

**Feature-aware compositions**

```
Patterns
├── Navigation     → Logo + Links + User menu
├── ContentCard    → Thumbnail + Title + Creator + Meta + Actions
├── CreatorCard    → Avatar + Name + Bio + Offerings count
├── JourneyCard    → Progress + Title + Next step
├── OfferingCard   → Media + Details + Price + Join button
├── DataTable      → Headers + Rows + Pagination + Filters
├── FileUpload     → Dropzone + Preview + Progress
├── VideoPlayer    → Player + Controls + Progress
└── ProgressTracker → Steps + Current + Completion
```

**Characteristics:**
- Business logic aware
- Feature-specific naming
- Compose many compounds/primitives
- Handle complex interactions

---

### Level 4: Templates

**Full page structures**

```
Templates
├── DashboardLayout    → Nav + Sidebar + Content area
├── BrowsingLayout     → Header + Grid + Filters
├── ContentLayout      → Player/Reader + Meta + Related
├── SettingsLayout     → Tabs + Section + Forms
├── OnboardingLayout   → Steps + Content + Progress
└── AuthLayout         → Centered card + Branding
```

**Characteristics:**
- Define page structure
- Wire patterns together
- Responsive breakpoint logic
- Routing boundaries

---

## Component States

Every interactive component must handle these states:

### Core States (Required)

```
State        Visual Change                    Trigger
────────────────────────────────────────────────────────────
default      Base appearance                  Initial render
hover        Background shift, cursor change  Mouse enter (desktop)
focus        Focus ring (teal-300, 3px)       Tab key, click
active       Darker background                Mouse down, Enter key
disabled     Muted colors, no cursor          disabled prop
```

### Extended States (As Needed)

```
State        Visual Change                    Trigger
────────────────────────────────────────────────────────────
loading      Spinner, disabled interaction    Async operation
error        Red border/text, error message   Validation failure
success      Green indicator, checkmark       Successful action
selected     Highlighted background           Multi-select
expanded     Content visible, icon rotated    Accordion/dropdown
```

### State Visual Language

| State | Background | Border | Text | Additional |
|-------|------------|--------|------|------------|
| Default | cream-100 | cream-200 | cream-800 | — |
| Hover | cream-200 | cream-300 | cream-800 | — |
| Focus | cream-100 | teal-500 | cream-800 | 3px teal-300 ring |
| Active | cream-300 | cream-400 | cream-900 | — |
| Disabled | cream-100 | cream-200 | cream-400 | opacity: 0.6 |
| Error | red-50 | red-300 | red-700 | Error icon |
| Success | green-50 | green-300 | green-700 | Check icon |

---

## Component Variants

### Size Variants

```
Size    Height    Padding      Font     Use Case
─────────────────────────────────────────────────────────
xs      28px      8px 12px     12px     Dense tables, inline
sm      36px      8px 16px     14px     Secondary actions
md      44px      12px 20px    14px     Default (touch-friendly)
lg      52px      16px 24px    16px     Primary CTAs
xl      60px      20px 32px    18px     Hero actions
```

**Default: `md`** (44px — touch-friendly)

### Style Variants

**Button example:**

```
Variant      Background   Border      Text       Use When
────────────────────────────────────────────────────────────────
primary      teal-500     teal-500    white      Main action per screen
secondary    cream-200    cream-300   cream-800  Secondary actions
outline      transparent  teal-500    teal-700   Alternative primary
ghost        transparent  none        teal-700   Tertiary actions
danger       red-600      red-600     white      Destructive actions
```

**Rule:** One primary button per screen/section. Never multiple primary CTAs competing.

### Semantic Variants

Some components have meaning-based variants:

**Alert example:**

```
Variant      Background   Border      Icon       Use When
────────────────────────────────────────────────────────────────
info         slate-50     slate-200   ℹ️         Neutral information
success      green-50     green-200   ✓          Positive feedback
warning      amber-50     amber-200   ⚠️         Caution needed
error        red-50       red-200     ✕          Something went wrong
celebration  coral-50     coral-200   🎉         Community wins
```

---

## Community-First Components

### Language in Components

All component default text follows the mission language:

| Generic | Community-First |
|---------|-----------------|
| "Buy Now" | "Join Now" / "Get Access" |
| "Add to Cart" | (no cart metaphor) |
| "Checkout" | "Complete" / "Continue" |
| "Purchase" | "Join" |
| "Your Orders" | "Your Library" |
| "Customers" | "Members" |
| "Products" | "Offerings" |

### Components That Express Belonging

**ContentCard** — Shows community context:
```
┌──────────────────────────────────────┐
│ ┌──────────────────────────────────┐ │
│ │         Thumbnail                │ │
│ └──────────────────────────────────┘ │
│                                      │
│ Content Title                        │
│ "Short description of the offering" │
│                                      │
│ ┌────┐ By Creator Name              │  ← Creator attribution
│ │ ○  │ Part of [Collective]         │  ← Collective context
│ └────┘                              │
│                                      │
│ 45 min · Beginner                   │
│                                      │
│ ┌────────────────────────────────┐  │
│ │         Get Access             │  │  ← Not "Buy"
│ └────────────────────────────────┘  │
└──────────────────────────────────────┘
```

**JourneyCard** — Shows transformation:
```
┌──────────────────────────────────────┐
│ Your Journey                         │
│                                      │
│ ████████████░░░░░░░ 65%             │  ← Progress
│                                      │
│ Next: "Advanced Breathing Techniques"│
│                                      │
│ 12 sessions completed                │  ← Transformation metric
│ 3 milestones reached                 │  ← Not "hours watched"
└──────────────────────────────────────┘
```

**WelcomeMessage** — Expresses belonging:
```
┌──────────────────────────────────────┐
│                                      │
│ Welcome to Mindful Movement          │
│                                      │
│ You're now part of our community.    │
│ Here's how to begin your journey.    │
│                                      │
│ ┌────────────────────────────────┐  │
│ │       Start Exploring          │  │
│ └────────────────────────────────┘  │
└──────────────────────────────────────┘
```

---

## Composition Rules

### Hierarchy

```
Templates    → Define page structure
    │
    ▼
Patterns     → Feature-specific compositions
    │
    ▼
Compounds    → Reusable component groups
    │
    ▼
Primitives   → Foundational elements
```

### What Can Contain What

```
✅ Allowed:
   Template  → Patterns, Compounds, Primitives
   Pattern   → Compounds, Primitives
   Compound  → Primitives
   Primitive → Text, icons only (no nested components)

❌ Not Allowed:
   Primitive → Other components
   Any       → Circular dependencies
   Template  → Direct primitive (without pattern context)
```

### Slot Pattern

Components use slots for flexible composition:

```jsx
<Card>
  <Card.Header>Title Here</Card.Header>
  <Card.Body>Content Here</Card.Body>
  <Card.Footer>Actions Here</Card.Footer>
</Card>
```

---

## Accessibility Requirements

**Every component MUST:**

### Keyboard Navigation

```
Tab           → Move focus to next element
Shift+Tab     → Move focus to previous element
Enter/Space   → Activate button, toggle, submit
Escape        → Close modal, dropdown, cancel
Arrow keys    → Navigate within menus, radios
```

### Screen Reader Support

- Proper semantic HTML elements
- ARIA labels for icons and complex interactions
- ARIA live regions for dynamic content
- Announced state changes

### Visual Requirements

- **Focus visible**: 3px ring, 3:1 contrast
- **Color independent**: Never rely on color alone
- **Touch targets**: 44px minimum
- **Text contrast**: 7:1 for body, 4.5:1 for large

### Testing Checklist

```
□ Keyboard-only navigation works
□ Focus order is logical
□ Focus is visible at all times
□ Screen reader announces correctly
□ Color is not only indicator
□ Touch targets are 44px+
□ Contrast ratios pass WCAG AA+
```

---

## Component API Standards

### Props Convention

**Always include:**
```typescript
interface BaseProps {
  className?: string;      // Style extension
  id?: string;             // DOM reference
  'data-testid'?: string;  // Testing
}
```

**Common patterns:**
```typescript
interface InteractiveProps extends BaseProps {
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
}

interface FormProps extends InteractiveProps {
  error?: string | boolean;
  required?: boolean;
  name: string;
  value?: string;
  onChange?: (value: string) => void;
}
```

### Event Naming

```typescript
// Always prefix with 'on'
onClick?: (event: MouseEvent) => void;
onChange?: (value: T) => void;
onFocus?: (event: FocusEvent) => void;
onBlur?: (event: FocusEvent) => void;
onSubmit?: (data: FormData) => void;
onClose?: () => void;
onOpen?: () => void;
```

### Ref Forwarding

All components forward refs for DOM access:

```typescript
const Button = forwardRef<HTMLButtonElement, ButtonProps>((props, ref) => {
  return <button ref={ref} {...props} />;
});
```

---

## Responsive Behavior

### Breakpoint Adaptations

Every component documents responsive changes:

**Button:**
```
Desktop: All sizes available
Mobile:  Minimum md size (44px), full-width option
```

**Card:**
```
Desktop: Side-by-side in grid
Tablet:  2-column grid
Mobile:  Full-width stack
```

**Navigation:**
```
Desktop: Horizontal links
Tablet:  Condensed links
Mobile:  Hamburger menu
```

### Touch Considerations

```
Mobile components:
├── 44px minimum touch targets
├── No hover-dependent features
├── Swipe gestures where appropriate
└── Thumb-friendly placement
```

---

## Documentation Requirements

Every component README includes:

```markdown
# ComponentName

## Purpose
What problem does this solve?

## Anatomy
Visual breakdown with labeled parts

## Props
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| ... | ... | ... | ... |

## Variants
When to use each variant

## States
Visual examples of all states

## Accessibility
Keyboard, screen reader, ARIA

## Usage Examples
Code examples for common cases

## Do's and Don'ts
Anti-patterns and best practices
```

---

## Priority Components

### Phase 1: Foundation

**Primitives (must ship first):**
- [ ] Button (all variants, all sizes)
- [ ] Input (text, email, password, number)
- [ ] Textarea
- [ ] Checkbox
- [ ] Radio
- [ ] Toggle
- [ ] Select
- [ ] Label
- [ ] Icon (system)
- [ ] Avatar
- [ ] Badge
- [ ] Link

**Compounds (build on primitives):**
- [ ] FormField
- [ ] Card
- [ ] Alert
- [ ] Dropdown
- [ ] Modal
- [ ] Tooltip
- [ ] Toast
- [ ] Tabs

### Phase 2: Features

**Patterns (feature-specific):**
- [ ] Navigation
- [ ] ContentCard
- [ ] CreatorCard
- [ ] JourneyCard
- [ ] DataTable
- [ ] FileUpload
- [ ] VideoPlayer
- [ ] ProgressTracker
- [ ] SearchResults

**Templates:**
- [ ] DashboardLayout
- [ ] BrowsingLayout
- [ ] ContentLayout
- [ ] SettingsLayout
- [ ] AuthLayout

---

## Anti-Patterns

| Anti-Pattern | Why It's Wrong | What Instead |
|--------------|----------------|--------------|
| Sharp corners | Cold, aggressive | 8px radius default |
| Cool gray buttons | Corporate, cold | Teal primary, cream secondary |
| "Buy" language | Transactional | "Join", "Get Access" |
| Multiple primary CTAs | Confusing | One primary per section |
| Hover-only features | Inaccessible on touch | Always provide alternative |
| Color-only indicators | Inaccessible | Color + icon + text |
| Tiny touch targets | Frustrating on mobile | 44px minimum |
| Disabled without explanation | Confusing | Tooltip explaining why |

---

## The Warmth Test

Before shipping any component:

1. **Does it feel warm?** Rounded, generous padding, soft colors
2. **Does it feel welcoming?** Approachable, not intimidating
3. **Does it use community language?** "Join" not "Buy"
4. **Is it accessible?** Keyboard, screen reader, contrast
5. **Does it match the creative studio feel?** Not SaaS, not corporate

If any answer is no → revise before shipping.

---

## Living Document

Component system evolves. Changes require:

1. Proposal with use case
2. Design review (warmth, accessibility)
3. Implementation with tests
4. Documentation
5. Changelog update

| Date | Change | Reasoning |
|------|--------|-----------|
| 2026-01-01 | Initial component architecture | Foundation |
| 2026-01-03 | Complete rewrite | Alignment with Mission/Philosophy. Added community-first component examples, warmth guidelines, language corrections. |

---

## Summary

**Codex components in one breath:**

> Every button, card, and input expresses our values—warm, welcoming, and designed for belonging. Components use community language, generous spacing, and rounded forms. They're accessible to all and feel like they belong in a creative studio, not a corporate dashboard.

**The test:**

> Does this component feel like it belongs in a beloved yoga studio's website, or in enterprise software?

If yoga studio → ship it.
If enterprise → add warmth.

---

**Upstream**: [05. Spacing & Layout](../05-spacing-layout/README.md)
**Downstream**: [07. Interaction & Motion](../07-interaction-motion/README.md)

---

*Last updated: 2026-01-03*
*Version: 2.0*
*Status: Foundation document — building blocks of belonging*
