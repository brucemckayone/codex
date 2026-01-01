# 06. Component Architecture

**Products, not drawings. States, variants, composition rules.**

---

## Purpose

Components are **products** with APIs, contracts, and lifecycle management.

Not Figma rectangles. Not React boilerplate. **Reusable, accessible, predictable building blocks.**

---

## Component Taxonomy

### Primitives (Atoms)

**Single-purpose, no internal composition**

- Button
- Input
- Label
- Icon
- Avatar
- Badge
- Checkbox
- Radio
- Toggle
- Link

**Characteristics**:
- No children components
- Single responsibility
- Highly reusable
- Minimal logic

---

### Compounds (Molecules)

**Combinations of primitives**

- FormField (Label + Input + Error)
- SearchBar (Input + Icon + Button)
- Card (Container + Header + Body + Footer)
- Alert (Icon + Title + Description + Dismiss)
- Dropdown (Button + Menu + Items)

**Characteristics**:
- Composed of 2-5 primitives
- Encapsulate common patterns
- Reusable across features

---

### Patterns (Organisms)

**Complex, feature-specific compositions**

- Navigation (Logo + Links + UserMenu)
- DataTable (Header + Rows + Pagination + Filters)
- ContentCard (Thumbnail + Title + Meta + Actions)
- Modal (Overlay + Header + Body + Footer)
- Form (Fields + Validation + Submit)

**Characteristics**:
- Business logic aware
- Feature-specific
- Compose many compounds/primitives

---

### Templates (Pages)

**Full-page layouts**

- DashboardLayout (Nav + Sidebar + Content + Footer)
- ContentEditor (Toolbar + Canvas + Inspector)
- SettingsPage (Tabs + Sections + Forms)

**Characteristics**:
- Wire patterns together
- Define page structure
- Routing boundaries

---

## Component States

**Every interactive component must define**:

### Visual States

```
default     → Normal appearance
hover       → Mouse over (desktop only)
active      → Mouse down or key press
focus       → Keyboard focus (required for a11y)
disabled    → Not interactive, visually muted
loading     → Async operation in progress
error       → Validation failed or action failed
success     → Action completed successfully
```

**Minimum**: default, hover, focus, disabled
**Full**: All 8 states documented

---

## Component Variants

**Different versions of same component**

### Size Variants

```
xs  → Compact (tables, dense UIs)
sm  → Small (secondary actions)
md  → Medium (default)
lg  → Large (primary CTAs)
xl  → Extra large (hero elements)
```

**Default**: `md`

---

### Style Variants

**Button example**:
```
primary     → Blue bg, white text (main action)
secondary   → Gray bg, gray text (secondary)
outline     → Transparent bg, border
ghost       → Transparent bg, no border
danger      → Red bg, white text (destructive)
```

---

## Composition Rules

### What Can Contain What

**Allowed**:
- ✅ Patterns contain compounds + primitives
- ✅ Compounds contain primitives
- ✅ Templates contain patterns

**Not allowed**:
- ❌ Primitives contain other components
- ❌ Circular dependencies (A contains B contains A)
- ❌ Skipping levels (Template directly uses primitive without pattern wrapper)

---

## Accessibility Requirements

**Every component must**:

1. **Keyboard navigable**: Tab, Enter, Space, Arrows
2. **Screen reader friendly**: Proper ARIA labels, roles
3. **Focus visible**: Clear focus indicators (3:1 contrast)
4. **Color-independent**: Never rely on color alone
5. **Touch-friendly**: 44px minimum tap targets

**Test with**:
- Keyboard only (no mouse)
- Screen reader (VoiceOver, NVDA)
- Color blindness simulators

---

## Component API Standards

### Props

**Required**:
```typescript
children?: ReactNode;        // Composition
className?: string;          // Style overrides
id?: string;                 // DOM reference
```

**Optional but common**:
```typescript
variant?: 'primary' | 'secondary' | ...;
size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
disabled?: boolean;
loading?: boolean;
error?: boolean | string;
```

---

### Events

**Naming convention**: `on{Event}`

**Common**:
```typescript
onClick?: (event: MouseEvent) => void;
onChange?: (value: any) => void;
onFocus?: (event: FocusEvent) => void;
onBlur?: (event: FocusEvent) => void;
onSubmit?: (data: FormData) => void;
```

---

## Responsive Behavior

**Every component defines**:

- **Mobile behavior**: How it adapts to small screens
- **Touch targets**: Minimum 44px tap areas
- **Overflow**: How content truncates or wraps

**Example (Navigation)**:
```
Desktop: Horizontal links
Tablet:  Condensed links
Mobile:  Hamburger menu
```

---

## Documentation Requirements

**Every component README includes**:

1. **Purpose**: What problem does this solve?
2. **Anatomy**: Visual breakdown of parts
3. **Props**: Complete API reference
4. **States**: Visual examples of all states
5. **Variants**: When to use which variant
6. **Accessibility**: Keyboard, screen reader behavior
7. **Usage examples**: Common implementations
8. **Do's & Don'ts**: Anti-patterns

---

## Component Lifecycle

### 1. Proposal

- **Why**: Problem statement
- **Sketch**: Low-fidelity mockup
- **API**: Proposed props, states
- **Accessibility**: WCAG compliance plan

### 2. Design

- **High-fidelity**: All states, variants
- **Dark mode**: Light + dark versions
- **Responsive**: Mobile, tablet, desktop
- **Review**: Design team sign-off

### 3. Implementation

- **Code**: React component
- **Tests**: Unit tests (states, props)
- **Storybook**: Interactive documentation
- **Accessibility**: Keyboard, screen reader tests

### 4. Documentation

- **README**: Complete component guide
- **Examples**: Real-world usage
- **Migration**: If replacing old component

### 5. Release

- **Versioning**: Semantic versioning
- **Changelog**: What's new/changed
- **Announcement**: Team notification

---

## Priority Components (Phase 1)

### Primitives (Must-have)

1. ✅ Button
2. ✅ Input
3. ✅ Label
4. ✅ Checkbox
5. ✅ Radio
6. ✅ Toggle
7. ✅ Icon
8. ✅ Badge
9. ✅ Avatar
10. ✅ Link

### Compounds (Must-have)

1. ✅ FormField
2. ✅ Card
3. ✅ Alert
4. ✅ Dropdown
5. ✅ Modal
6. ✅ Tooltip
7. ✅ SearchBar

### Patterns (Phase 2)

1. ⬜ Navigation
2. ⬜ DataTable
3. ⬜ ContentCard
4. ⬜ VideoPlayer
5. ⬜ FileUpload
6. ⬜ ProgressTracker

---

Next: [07. Interaction & Motion →](../07-interaction-motion/README.md)
