# 13. Documentation & Education

**If it's not taught, it doesn't exist. Docs are part of the product.**

---

## Purpose

Documentation is **not an afterthought**. It's:
- How designers learn the system
- How engineers implement correctly
- How product understands capabilities
- How future team members onboard

**Bad docs = abandoned system. Good docs = adoption.**

---

## Documentation Principles

### 1. Show, Don't Tell

❌ **Bad**: "Buttons should have adequate padding"
✅ **Good**: "Button padding: 12px vertical, 16px horizontal (spacing-3 spacing-4)"

**Include**: Visual examples, code snippets, live demos

---

### 2. Examples Over Explanations

❌ **Bad**: Long paragraph explaining button variants
✅ **Good**: 4 button examples (primary, secondary, outline, danger) with code

**Rule**: Every concept has a visual example

---

### 3. Progressive Disclosure

**Beginners**: See quick start, basic examples
**Experts**: Discover advanced usage, edge cases

**Structure**:
```
Overview (everyone reads)
  ↓
Basic usage (most read)
  ↓
Advanced usage (some read)
  ↓
API reference (few read, but must exist)
```

---

### 4. Answer "Why", Not Just "How"

❌ **Bad**: "Use `variant="primary"` for primary buttons"
✅ **Good**: "Use `variant="primary"` for main actions (Save, Submit, Publish). Only one per screen to maintain hierarchy."

**Include**: Reasoning, context, when to use vs not

---

## Documentation Types

### 1. Design Guidelines (This System)

**Audience**: Designers, design-minded engineers

**Location**: `/design-system/` (markdown files)

**Includes**:
- Philosophy
- Visual language
- Color, typography, spacing
- Interaction patterns
- Accessibility standards

**Format**: Markdown (human-readable, version-controlled)

---

### 2. Component Documentation

**Audience**: Engineers, designers

**Location**: `/packages/ui/src/{component}/README.md`

**Includes**:
- Purpose (what is this for?)
- Anatomy (visual breakdown)
- Props API (TypeScript reference)
- States (default, hover, focus, disabled, etc.)
- Variants (when to use which)
- Accessibility (keyboard, SR, contrast)
- Usage examples (code + visual)
- Do's & Don'ts

**Template**: [Component README Template](#component-readme-template)

---

### 3. Storybook (Interactive Docs)

**Audience**: Everyone

**Location**: `design.codex.com` (deployed Storybook)

**Includes**:
- Live component previews
- Interactive controls (change props live)
- Code examples (copy-paste ready)
- Accessibility tests (built-in axe)
- Design tokens (color swatches, spacing scales)

**Why Storybook?** Visual, interactive, always in sync with code

---

### 4. API Reference

**Audience**: Engineers

**Location**: TypeScript types (auto-generated docs)

**Includes**:
- Prop types + descriptions (JSDoc)
- Default values
- Examples (inline code comments)

**Example**:
```typescript
/**
 * Button component for user actions.
 *
 * @example
 * <Button variant="primary" onClick={handleSave}>
 *   Save Changes
 * </Button>
 */
export const Button: React.FC<ButtonProps> = ({ ... }) => { ... };
```

---

### 5. Migration Guides

**Audience**: Engineers upgrading versions

**Location**: `/design-system/migrations/{version}.md`

**Includes**:
- What changed
- Why changed
- How to update code
- Automated migration script (if possible)

**Example**: [Migration: v1 → v2](#migration-example)

---

### 6. Getting Started Guide

**Audience**: New team members, new projects

**Location**: `/design-system/getting-started.md`

**Includes**:
- Installation
- Basic setup
- First component
- Common patterns
- Where to get help

**Goal**: 0 → productive in 15 minutes

---

## Component README Template

**Every component must have**:

```markdown
# ComponentName

Brief description (1-2 sentences).

## When to Use

- Use case 1
- Use case 2

## When NOT to Use

- Wrong use case 1 (use X instead)

## Anatomy

[Visual diagram showing component parts]

## Props

| Prop      | Type    | Default   | Description           |
|-----------|---------|-----------|----------------------|
| variant   | string  | 'primary' | Visual style variant |
| size      | string  | 'md'      | Size of component    |
| disabled  | boolean | false     | Disable interaction  |

## States

[Visual examples: default, hover, focus, active, disabled, loading, error]

## Variants

[Visual examples: primary, secondary, outline, etc.]
[When to use each variant]

## Usage

### Basic Example

```jsx
<ComponentName variant="primary">
  Content
</ComponentName>
```

### Advanced Example

```jsx
<ComponentName
  variant="primary"
  size="lg"
  loading={isLoading}
  onClick={handleClick}
>
  Submit
</ComponentName>
```

## Accessibility

- Keyboard: [Tab, Enter, Space, etc.]
- Screen Reader: [Announces as "button", etc.]
- Focus: [Visible focus ring, 3:1 contrast]
- ARIA: [aria-label when needed]

## Do's & Don'ts

✅ **Do**: Use for primary actions
❌ **Don't**: Use for navigation (use Link)

✅ **Do**: One primary button per screen
❌ **Don't**: Multiple primary buttons competing

## Related Components

- Link (for navigation)
- IconButton (for icon-only actions)
```

---

## Do's & Don'ts Format

**Purpose**: Quick visual reference for correct usage

**Structure**:

✅ **Do: Use for main actions**
```jsx
<Button variant="primary">Save Changes</Button>
```

❌ **Don't: Use for every action**
```jsx
<Button variant="primary">Save</Button>
<Button variant="primary">Cancel</Button>
<Button variant="primary">Delete</Button>
```

**Explanation**: Only one primary action per screen maintains hierarchy.

---

## Visual Examples

**Include**:
- Screenshots (high-res, 2x retina)
- Live code examples (Storybook)
- Diagrams (anatomy, states, flows)

**Format**:
- Light mode + dark mode
- Mobile + desktop (if responsive)
- All states (hover, focus, disabled)

**Tools**: Figma (export 2x PNG), Storybook (live), Mermaid (diagrams)

---

## Code Examples

### Inline Examples

**Short snippets** (1-5 lines):
```jsx
<Button variant="primary">Save</Button>
```

### Standalone Examples

**Complete implementations** (10+ lines):
```jsx
import { Button } from '@codex/ui';

export function SaveForm() {
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    setLoading(true);
    await saveData();
    setLoading(false);
  };

  return (
    <Button
      variant="primary"
      loading={loading}
      onClick={handleSave}
    >
      Save Changes
    </Button>
  );
}
```

**Include**: Imports, state management, real-world context

---

## Anti-Patterns Documentation

**Purpose**: Teach what NOT to do

**Examples**:

### ❌ Anti-Pattern: All Bold Text

**Problem**: No hierarchy, hard to scan

```jsx
<h1 className="font-bold">Title</h1>
<p className="font-bold">Everything is shouting</p>
```

**Solution**: Use weight for hierarchy

```jsx
<h1 className="font-bold">Title</h1>
<p className="font-normal">Regular body text</p>
```

---

## Migration Example

**File**: `/design-system/migrations/v1-to-v2.md`

```markdown
# Migration Guide: v1 → v2

## Breaking Changes

### Button Component

**What changed**: Renamed `type` prop to `variant`

**Before (v1)**:
```jsx
<Button type="primary">Save</Button>
```

**After (v2)**:
```jsx
<Button variant="primary">Save</Button>
```

**Automated migration**: Run `npx @codex/codemod v1-to-v2`

### Color Tokens

**What changed**: Restructured token names

**Before (v1)**:
```javascript
color.primary.500
color.text.default
```

**After (v2)**:
```javascript
color.action.primary.default
color.text.primary
```

**Migration script**: `scripts/migrate-tokens.js`

## New Features

- Added DataTable component
- Dark mode support for all components
- Performance improvements (30% faster renders)

## Full Changelog

[Link to CHANGELOG.md]
```

---

## Onboarding Flow

**New team member**:

### Day 1: Read Philosophy
- [01-philosophy](./01-philosophy/README.md)
- [02-visual-language](./02-visual-language/README.md)

### Day 2: Explore Components
- Storybook tour (all components)
- Try building a simple form

### Day 3: Build Something
- Create a profile page
- Use 5+ components
- Get feedback from DS team

### Week 1: Deep Dive
- Read all 13 pillars
- Attend office hours
- Ask questions in Slack

---

## Documentation Maintenance

**Responsibility**: Documentation is **not optional**

**When updating components**:
1. Update code
2. Update README (same PR)
3. Update Storybook stories (same PR)
4. Update changelog (automated via changeset)

**When adding components**:
1. Write README before code (TDD for docs)
2. Create Storybook stories during development
3. Add to component index

**When deprecating**:
1. Add deprecation notice to README
2. Add migration guide
3. Update getting started guide (remove from examples)

---

## Search & Discovery

**Documentation site** (`design.codex.com`):
- Search bar (Algolia DocSearch)
- Component index (alphabetical + by category)
- Quick start guides
- Full-text search (search design guidelines)

**Storybook**:
- Component search
- Filter by tag (primitive, compound, pattern)
- Accessibility score (built-in axe)

---

## Feedback Loop

**How users help improve docs**:

### Report Issues
- "Docs unclear" button on every page
- GitHub issue auto-created
- DS team triages weekly

### Suggest Edits
- "Edit this page" link (GitHub)
- Submit PR with doc improvements
- Quick review + merge

### Request Examples
- "I need an example of X" form
- DS team adds to backlog
- Prioritized by votes

---

## Metrics

**Track quarterly**:
- Page views (most/least visited)
- Search queries (what are people looking for?)
- Time on page (too short = confusing, too long = verbose)
- Feedback submissions (positive vs negative)
- Component adoption (after doc updates)

**Goal**: Docs help people succeed

---

## Living Document

Documentation evolves with system. Every change requires:

1. README update
2. Storybook story update
3. Migration guide (if breaking)
4. Changelog entry
5. Announcement (Slack)

**Documentation debt** = tech debt. Pay it down.

---

**Change log**:

| Date | Change | Reasoning |
|------|--------|-----------|
| 2026-01-01 | Initial documentation standards | Foundation |

---

## Summary

**Documentation is not separate from design system. It IS the design system.**

Without docs:
- Components are unused
- Standards are ignored
- System becomes abandonware

With docs:
- Designers design consistently
- Engineers implement correctly
- Product understands capabilities
- System thrives

**Invest in documentation = invest in system success.**
