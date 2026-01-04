# 13. Documentation & Education

**Teaching belonging. How we welcome people into our craft.**

---

## Foundation

This document ensures our documentation embodies the values from [00. Mission](../00-mission/README.md).

Every documentation decision must answer: **Does this help someone understand not just HOW, but WHY we build this way?**

---

## Documentation Philosophy

### Teaching, Not Telling

Documentation isn't a reference manual—it's education. It welcomes newcomers into our craft.

Consider how creative studios teach:

| Studio Practice | Documentation Equivalent |
|-----------------|-------------------------|
| Yoga teacher explains breathing philosophy | We explain warmth philosophy |
| Dance instructor demonstrates technique | We show live component examples |
| Music school teaches theory + practice | We provide both principles + code |
| Art collective shares process, not just output | We document why, not just how |

**Our documentation teaches a way of thinking**, not just a way of doing.

---

### The Documentation Spectrum

```
Cryptic ◄─────────────────────────────────────────► Overwhelming

Sparse     Reference     Functional ║  Codex  ║  Thorough   Verbose
Assumes    only          Just how   ║         ║  Shows why  Too much
expertise  Tables        No context ║         ║  Examples   Walls of text
    │          │             │      ║         ║      │           │
    └──────────┴─────────────┴──────╨─────────╨──────┴───────────┘
                                    ▲
                              We live here
```

**Codex documentation is:**
- Educational (teaches thinking, not just doing)
- Example-rich (show, don't tell)
- Layered (beginners to experts)
- Welcoming (feels approachable)

---

### Core Documentation Principles

1. **Welcome First, Reference Second**
   - Documentation is a newcomer's first impression
   - Make them feel capable, not intimidated
   - Show a warm path before showing the map

2. **Show, Don't Tell**
   - Every concept has a visual example
   - Code snippets are copy-paste ready
   - Live demos over static descriptions

3. **Answer "Why" Before "How"**
   - Philosophy before implementation
   - Context before code
   - Reasoning unlocks understanding

4. **Community Language Always**
   - All examples use "member" not "customer"
   - All examples use "join" not "buy"
   - Documentation embodies our values

---

## Documentation Types

### 1. Philosophy Documents (This System)

**Purpose:** Teach the thinking behind decisions

**Audience:** Designers, engineers, product managers

**Location:** `/design-system/01-13/README.md`

**Contents:**
- Core philosophy (belonging, warmth)
- Visual language (creative studio metaphor)
- Color, typography, spacing rationale
- Component philosophy
- Accessibility as love
- Governance as stewardship

**Tone:** Educational, inspiring, grounded in values

---

### 2. Component Documentation

**Purpose:** Teach how to use and when to use each component

**Audience:** Engineers primarily, designers secondarily

**Location:** `/packages/ui/src/{component}/README.md`

**Template:** [Component README Template](#component-readme-template)

**Contents:**
- Purpose and philosophy
- When to use / when NOT to use
- Props API with examples
- States and variants with visuals
- Accessibility requirements
- Do's and Don'ts
- Community-focused examples

---

### 3. Storybook (Interactive Documentation)

**Purpose:** Live, interactive component exploration

**Audience:** Everyone

**URL:** `design.codex.com`

**Features:**
- Live component previews
- Interactive prop controls
- Copy-paste code examples
- Accessibility audits (axe-core)
- Dark mode toggle
- Responsive preview

**Philosophy in Storybook:**
- Every story uses community language
- Examples show real scenarios (joining collective, member progress)
- Annotations explain philosophy decisions

---

### 4. Getting Started Guide

**Purpose:** 0 → productive in 15 minutes

**Audience:** New team members, new projects

**Location:** `/design-system/getting-started.md`

**Structure:**
```markdown
# Getting Started

Welcome to the Codex Design System.

## Before You Code

Read these first (10 minutes):
1. [Philosophy](./01-philosophy) — Why we make decisions
2. [Mission](./00-mission) — Our community values

## Installation (2 minutes)

[npm install instructions]

## Your First Component (3 minutes)

[Button example with community language]

## Building a Real Page

[Content card example showing member joining flow]

## Getting Help

- Office Hours: Thursdays 2pm
- Slack: #design-system
- Storybook: design.codex.com
```

---

### 5. Migration Guides

**Purpose:** Safe upgrades between versions

**Audience:** Engineers upgrading existing code

**Location:** `/design-system/migrations/`

**Structure:**
```markdown
# Migration: v1 → v2

## Breaking Changes Summary

| Component | Change | Migration |
|-----------|--------|-----------|
| Button | `type` → `variant` | Codemod available |

## Detailed Changes

### Button: type → variant

**Why changed:**
- `type` conflicts with HTML button type
- Caused confusion in forms
- `variant` is clearer

**Before:**
[code example]

**After:**
[code example]

**Automated migration:**
npx @codex/migrate v1-to-v2
```

---

## Component README Template

Every component README follows this structure:

```markdown
# ComponentName

**Brief description that mentions community purpose.**

---

## Philosophy

Why does this component exist? What community value does it serve?

Example: "ContentCard shows offerings with creator attribution,
reinforcing that content comes from real people in our community."

---

## When to Use

- ✅ Displaying content in grid layouts
- ✅ Showing creator offerings on browse pages
- ✅ Member library views

## When NOT to Use

- ❌ For navigation (use Link)
- ❌ For featured/hero content (use FeaturedCard)

---

## Anatomy

```
┌────────────────────────────────────┐
│  ┌──────────────────────────────┐  │
│  │       Thumbnail (1)         │  │
│  └──────────────────────────────┘  │
│                                    │
│  Title (2)                         │
│  Description (3)                   │
│                                    │
│  ┌────┐ Creator Name (4)          │
│  │ ○  │ Collective Name (5)       │
│  └────┘                            │
│                                    │
│  Duration · Level (6)             │
│                                    │
│  ┌────────────────────────────┐   │
│  │     Get Access (7)         │   │
│  └────────────────────────────┘   │
└────────────────────────────────────┘
```

1. **Thumbnail** — Visual preview of content
2. **Title** — Content name (h4)
3. **Description** — Brief summary
4. **Creator** — Human attribution (avatar + name)
5. **Collective** — Community context
6. **Meta** — Duration, difficulty level
7. **Action** — "Get Access" (not "Buy")

---

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| content | Content | required | Content data object |
| showCreator | boolean | true | Display creator attribution |
| showCollective | boolean | true | Display collective context |
| variant | 'default' \| 'compact' | 'default' | Layout variant |

---

## States

### Default
[Visual example]

### Hover
Subtle lift with shadow increase. See [07. Motion](../07-interaction-motion).

### Loading
Skeleton loader maintaining layout shape.

### Error
Fallback with retry option.

---

## Variants

### Default
Full card with all elements. Use for browse grids.

### Compact
Smaller card for sidebar or lists. Hides description.

---

## Usage

### Basic Example

```tsx
import { ContentCard } from '@codex/components';

<ContentCard
  content={offering}
  onAccess={handleJoin}
/>
```

### In a Grid

```tsx
<div className="grid grid-cols-3 gap-6">
  {offerings.map(offering => (
    <ContentCard
      key={offering.id}
      content={offering}
    />
  ))}
</div>
```

### Compact Variant

```tsx
<ContentCard
  content={offering}
  variant="compact"
  showDescription={false}
/>
```

---

## Accessibility

- **Keyboard:** Tab to card, Enter activates action button
- **Screen reader:** Announces as article with content title
- **Focus:** 3px teal-300 focus ring on card
- **Images:** Alt text describes content thumbnail

---

## Do's and Don'ts

### Do's

✅ **Show creator attribution**
```tsx
<ContentCard content={offering} showCreator={true} />
```
Reinforces human connection behind content.

✅ **Use community language**
```tsx
// Button says "Get Access" not "Buy Now"
```

### Don'ts

❌ **Don't hide collective context**
```tsx
<ContentCard content={offering} showCollective={false} />
```
Removes community belonging context.

❌ **Don't use for single-item hero**
```tsx
// Use FeaturedCard for hero placement
```

---

## Related Components

- **FeaturedCard** — For hero/featured content
- **JourneyCard** — For member progress tracking
- **CreatorCard** — For creator profiles

---

*Last updated: 2026-01-03*
```

---

## Visual Example Standards

### Screenshots

**Requirements:**
- 2x resolution (retina)
- Light and dark mode versions
- Consistent background (cream-50 or cream-950)
- Annotations for anatomy diagrams

### Live Examples (Storybook)

**Requirements:**
- All states represented
- Community-focused content (real scenarios)
- Copy-paste code examples
- Interactive controls

### Diagrams

**Tools:** ASCII for markdown, Figma for complex

**Style:**
- Simple, clean lines
- Numbered annotations
- Consistent with cream/teal palette descriptions

---

## Code Example Standards

### Short Examples (1-5 lines)

Use inline in markdown:

```tsx
<Button variant="primary">Join the community</Button>
```

### Complete Examples (10+ lines)

Include imports, state, context:

```tsx
import { useState } from 'react';
import { Button, Modal } from '@codex/components';

export function JoinButton({ collective }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Button
        variant="primary"
        onClick={() => setIsOpen(true)}
      >
        Join {collective.name}
      </Button>

      <Modal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
      >
        <h2>Welcome to {collective.name}</h2>
        <p>You're about to join our community...</p>
      </Modal>
    </>
  );
}
```

**Notice:** All examples use community language and real scenarios.

---

## Do's and Don'ts Format

**Structure each Do/Don't as:**

1. Icon (✅ or ❌)
2. Brief statement
3. Code example
4. Explanation (why this matters)

**Example:**

✅ **Do: Use one primary action per screen**

```tsx
<Button variant="primary">Join now</Button>
<Button variant="secondary">Learn more</Button>
```

Maintains clear hierarchy. Members know where to focus.

---

❌ **Don't: Compete for attention**

```tsx
<Button variant="primary">Join now</Button>
<Button variant="primary">Start trial</Button>
<Button variant="primary">Sign up</Button>
```

Multiple primary buttons confuse and overwhelm.

---

## Onboarding Flow

### New Designer

**Day 1:** Philosophy
- Read [00. Mission](./00-mission)
- Read [01. Philosophy](./01-philosophy)
- Browse Storybook (30 minutes)

**Day 2:** Visual Language
- Read [02. Visual Language](./02-visual-language)
- Read [03. Color](./03-color)
- Note the warmth principles

**Day 3:** Apply
- Design a simple screen
- Use component library
- Get feedback from DS team

**Week 1:** Deep Dive
- Read all 13 pillars
- Attend office hours
- Ask questions in Slack

---

### New Engineer

**Day 1:** Philosophy + Setup
- Read [00. Mission](./00-mission)
- Install design system package
- Build first component

**Day 2:** Patterns
- Read [06. Components](./06-components)
- Read [11. Engineering](./11-engineering)
- Understand token usage

**Day 3:** Build
- Create a page using 5+ components
- Follow accessibility requirements
- Get code review

**Week 1:** Deep Dive
- Read all 13 pillars
- Understand governance
- Contribute first fix/improvement

---

## Documentation Maintenance

### When Updating Components

Every PR that changes a component must include:

```
□ README updated
□ Storybook stories updated
□ Changeset added
□ Migration guide (if breaking)
```

**No PR merges without documentation updates.**

### When Adding Components

1. Write README before code (documentation-first)
2. Create Storybook stories during development
3. Add to component index
4. Announce in Slack

### Documentation Reviews

Same criteria as code reviews:

- Accurate and complete?
- Uses community language?
- Examples are realistic?
- Accessible to newcomers?

---

## Search & Discovery

### Documentation Site

**Features:**
- Search bar (full-text search)
- Component index (by category)
- Quick start guides
- Philosophy section

**Navigation:**
```
Home
├── Getting Started
├── Philosophy (pillars 00-01)
├── Foundations (02-05)
├── Components (06)
├── Patterns (07-08)
├── Standards (09-13)
└── Component Library (Storybook)
```

### Storybook

**Organization:**
```
Storybook
├── Getting Started
├── Primitives (Button, Input, etc.)
├── Compounds (Card, Modal, etc.)
├── Patterns (ContentCard, JourneyCard, etc.)
├── Templates (layouts)
└── Design Tokens
```

---

## Feedback Loop

### Report Issues

Every doc page has:
- "Was this helpful?" (👍 / 👎)
- "Report issue" link (creates GitHub issue)
- "Suggest edit" link (opens PR)

### Request Examples

If something is missing:
- Submit issue with "example request" label
- DS team prioritizes by votes
- Community can contribute examples

### Track Understanding

**Metrics:**
- Search queries (what are people looking for?)
- Page views (which docs are most used?)
- Time on page (too short = confusing)
- Feedback ratio (positive vs negative)

---

## Anti-Patterns

| Anti-Pattern | Why It's Wrong | What Instead |
|--------------|----------------|--------------|
| No examples | Abstract concepts don't stick | Every concept has visual + code |
| Transactional language | Breaks our values | Always use community language |
| Reference only | No one learns "why" | Teach philosophy first |
| Outdated docs | Breaks trust | Update with every code change |
| Wall of text | Nobody reads it | Progressive disclosure |
| Jargon without explanation | Excludes newcomers | Define terms, link to philosophy |

---

## The Welcome Test

Before publishing any documentation:

1. **Would a newcomer feel welcomed?** Not intimidated
2. **Does it teach the "why"?** Not just the "how"
3. **Does it use community language?** Member, join, library
4. **Are there enough examples?** Show, don't tell
5. **Is it findable?** Good search, clear navigation

If any answer is no → improve before publishing.

---

## Living Document

Documentation evolves with the system. Changes require:

1. Update documentation with code (same PR)
2. Update Storybook stories
3. Add to changelog
4. Announce changes

| Date | Change | Reasoning |
|------|--------|-----------|
| 2026-01-01 | Initial documentation standards | Foundation |
| 2026-01-03 | Complete rewrite | Alignment with Mission. Reframed as teaching belonging. Added community language requirements, philosophy-first approach, welcome test. |

---

## Summary

**Codex documentation in one breath:**

> Documentation teaches belonging. It welcomes newcomers into our craft, showing not just how to build but why we build this way. Every example uses community language. Every concept has a visual. Every page answers "why" before "how." Good documentation doesn't just instruct—it inspires.

**The test:**

> Would someone new to our team feel welcomed and capable after reading this?

If yes → publish.
If confused or cold → warm it up.

---

**Upstream**: [12. Governance](../12-governance/README.md)

---

*Last updated: 2026-01-03*
*Version: 2.0*
*Status: Foundation document — teaching belonging*
