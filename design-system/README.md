# Codex Design System

**Version**: 1.0.0
**Status**: Foundation Phase
**Last Updated**: 2026-01-01

---

## Purpose

World-class design system for Codex — a serverless content streaming platform where creators sell courses, videos, and digital content.

This is not a component library. This is a **contract** between product, design, engineering, and the future.

---

## What This Is

A **philosophy encoded into tokens, components, and rules** that defines:

- How decisions are made
- Why things look and feel the way they do
- What we will never compromise on
- How to maintain quality under pressure

---

## System Architecture

```
Philosophy (why we exist)
    ↓
Visual Language (how we express)
    ↓
Design Tokens (design decisions as data)
    ↓
Primitives (atomic components)
    ↓
Compounds (composed patterns)
    ↓
Templates (product experiences)
```

---

## The 14 Pillars

Every world-class design system must nail these. Miss one and the system rots.

### 0. [Mission & Purpose](./00-mission/README.md) ⭐ START HERE
The why behind everything. Community, collaboration, Collectives. This drives all decisions.

### 1. [Design Philosophy](./01-philosophy/README.md)
Non-negotiable principles. The root of everything.

### 2. [Visual Language](./02-visual-language/README.md)
Aesthetic grammar. Shape, density, weight, motion, contrast, space.

### 3. [Color System](./03-color/README.md)
Semantic color contracts. Every color has a job.

### 4. [Typography System](./04-typography/README.md)
Structure, hierarchy, voice. Meaning before decoration.

### 5. [Spacing & Layout](./05-spacing-layout/README.md)
Hidden backbone of quality. Grid, rhythm, alignment.

### 6. [Component Architecture](./06-components/README.md)
Products, not drawings. States, variants, composition rules.

### 7. [Interaction & Motion](./07-interaction-motion/README.md)
Motion is meaning. Feedback, duration, easing, state changes.

### 8. [Content & Voice](./08-content-voice/README.md)
Words are UI. Tone, microcopy, naming, formatting.

### 9. [Accessibility & Inclusion](./09-accessibility/README.md)
Foundational, not a checklist. Contrast, keyboard, screen readers, cognitive load.

### 10. [Theming & Extensibility](./10-theming/README.md)
Future-proofing. Tokens, skins, customization boundaries.

### 11. [Engineering Contract](./11-engineering/README.md)
Design ≠ implementation unless this is explicit.

### 12. [Governance & Evolution](./12-governance/README.md)
Contribution, review, deprecation, decision ownership.

### 13. [Documentation & Education](./13-documentation/README.md)
If it's not taught, it doesn't exist.

---

## Platform Context

**Codex** is a platform for creative Collectives — communities of creators who collaborate to share knowledge and serve their members.

**The Core Idea**: Creators don't compete. They complete each other.

**What makes Codex different**:
- **Collectives** — groups of creators with shared purpose (yoga studios, coaching academies, dance collectives)
- **Multi-membership** — creators can belong to multiple Collectives
- **Community-first** — members belong to something, they don't just buy products
- **Collaboration** — revenue shared, rising tide lifts all boats
- **Ownership** — creators own their content forever, Collectives enable distribution

**Architecture**: Cloudflare Workers (serverless edge compute)
**Stack**: Hono (API), Drizzle ORM (database), R2 (storage), Stripe (payments)
**Database**: Neon PostgreSQL
**Auth**: BetterAuth (session-based)

### The People

- **Creators**: Individuals who own their knowledge/media, collaborate with Collectives
- **Collectives**: Communities of creators with shared purpose (not "organizations")
- **Members**: People who belong to a Collective's community (not "customers")
- **Platform Owner**: The developer who maintains Codex infrastructure

### Key Experiences to Design For

1. **Creator Dashboard** (content management, upload flows, analytics)
2. **Customer Portal** (browse, purchase, watch, library)
3. **Content Player** (video/audio streaming with progress tracking)
4. **Checkout Flow** (Stripe integration, one-time purchases)
5. **Admin Dashboard** (platform-wide analytics, manual access grants)
6. **Organization Settings** (branding, team management)

---

## Design Constraints

### Technical

- **Serverless architecture**: No long-running processes, instant cold starts
- **Edge-first**: Global CDN, sub-50ms response times
- **Mobile-first**: 60%+ traffic from mobile devices
- **Bandwidth awareness**: Video streaming = data costs matter
- **Offline-capable**: Progressive Web App with service workers

### Business

- **Creator-centric**: Tools must empower, not overwhelm
- **Revenue-driven**: Minimize friction in purchase flows
- **Trust-critical**: Money changes hands, security is sacred
- **Self-serve**: No sales team, UI must teach itself
- **Scale-ready**: 1 creator or 10,000 creators, same experience quality

### Brand

- **Professional but approachable**: Not corporate, not playful
- **Clarity over cleverness**: Creators are busy, respect their time
- **Calm confidence**: Platform should feel stable, reliable, secure
- **Creator tools, not toys**: Serious professionals use this daily

---

## Anti-Principles

What we **will not** do:

❌ Follow trends for trend's sake
❌ Add features without removing complexity
❌ Sacrifice clarity for aesthetics
❌ Design for awards, not users
❌ Use motion as decoration
❌ Hide information to "simplify"
❌ Copy competitors without understanding why
❌ Let marketing override usability

---

## Source of Truth

1. **Design Tokens** → `/tokens` (design decisions as data)
2. **Component API** → `/components` (implementation contracts)
3. **Documentation** → This system (the why behind everything)

**Precedence**: Documentation > Tokens > Code
If code contradicts docs, code is wrong.

---

## Quick Start

### For Designers

1. Read [01-philosophy](./01-philosophy/README.md)
2. Understand [02-visual-language](./02-visual-language/README.md)
3. Use tokens from [tokens/](./tokens/)
4. Build with [06-components](./06-components/README.md)

### For Engineers

1. Read [11-engineering](./11-engineering/README.md)
2. Import tokens from `@codex/design-tokens`
3. Use components from `@codex/ui`
4. Follow [12-governance](./12-governance/README.md) for contributions

### For Product

1. Read [01-philosophy](./01-philosophy/README.md)
2. Understand [08-content-voice](./08-content-voice/README.md)
3. Reference [06-components](./06-components/README.md) for capabilities
4. Respect [09-accessibility](./09-accessibility/README.md) requirements

---

## Status

| Pillar | Status | Completion |
|--------|--------|------------|
| 00. Mission & Purpose | ✅ Complete | 100% |
| 01. Philosophy | 🟡 Needs Update | 20% |
| 02. Visual Language | 🔴 Not Started | 0% |
| 03. Color System | 🔴 Not Started | 0% |
| 04. Typography | 🔴 Not Started | 0% |
| 05. Spacing & Layout | 🔴 Not Started | 0% |
| 06. Components | 🔴 Not Started | 0% |
| 07. Interaction & Motion | 🔴 Not Started | 0% |
| 08. Content & Voice | 🔴 Not Started | 0% |
| 09. Accessibility | 🔴 Not Started | 0% |
| 10. Theming | 🔴 Not Started | 0% |
| 11. Engineering | 🔴 Not Started | 0% |
| 12. Governance | 🔴 Not Started | 0% |
| 13. Documentation | 🔴 Not Started | 0% |

---

## Directory Structure

```
design-system/
├── README.md (this file)
│
├── 00-mission/              ⭐ START HERE
│   └── README.md            (The why - community, collaboration, Collectives)
│
├── 01-philosophy/
│   ├── README.md
│   ├── purpose.md
│   ├── principles.md
│   ├── anti-principles.md
│   └── emotional-tone.md
│
├── 02-visual-language/
│   ├── README.md
│   ├── shape-language.md
│   ├── density.md
│   ├── weight.md
│   ├── motion-character.md
│   ├── contrast.md
│   └── negative-space.md
│
├── 03-color/
│   ├── README.md
│   ├── brand-colors.md
│   ├── functional-colors.md
│   ├── interactive-states.md
│   ├── surfaces.md
│   ├── accessibility.md
│   └── dark-mode.md
│
├── 04-typography/
│   ├── README.md
│   ├── typeface-selection.md
│   ├── scale.md
│   ├── hierarchy.md
│   ├── line-length.md
│   └── responsive-type.md
│
├── 05-spacing-layout/
│   ├── README.md
│   ├── spacing-scale.md
│   ├── grid-system.md
│   ├── breakpoints.md
│   ├── containers.md
│   └── vertical-rhythm.md
│
├── 06-components/
│   ├── README.md
│   ├── taxonomy.md
│   ├── primitives/
│   ├── compounds/
│   ├── patterns/
│   └── templates/
│
├── 07-interaction-motion/
│   ├── README.md
│   ├── feedback-rules.md
│   ├── duration-easing.md
│   ├── transitions.md
│   └── reduced-motion.md
│
├── 08-content-voice/
│   ├── README.md
│   ├── voice-principles.md
│   ├── tone-variations.md
│   ├── microcopy.md
│   └── naming-conventions.md
│
├── 09-accessibility/
│   ├── README.md
│   ├── contrast-rules.md
│   ├── keyboard-interaction.md
│   ├── focus-management.md
│   ├── screen-readers.md
│   └── cognitive-load.md
│
├── 10-theming/
│   ├── README.md
│   ├── token-strategy.md
│   ├── theming-model.md
│   ├── customization.md
│   └── versioning.md
│
├── 11-engineering/
│   ├── README.md
│   ├── source-of-truth.md
│   ├── token-naming.md
│   ├── component-api.md
│   ├── performance.md
│   └── testing.md
│
├── 12-governance/
│   ├── README.md
│   ├── contribution.md
│   ├── review-standards.md
│   ├── deprecation.md
│   └── decision-ownership.md
│
├── 13-documentation/
│   ├── README.md
│   ├── narrative.md
│   ├── usage-examples.md
│   ├── do-dont.md
│   └── anti-patterns.md
│
└── tokens/
    ├── README.md
    ├── color.tokens.json
    ├── typography.tokens.json
    ├── spacing.tokens.json
    ├── motion.tokens.json
    └── shadow.tokens.json
```

---

## Next Steps

1. ✅ Create directory structure
2. 🟡 Define design philosophy (current)
3. ⬜ Establish visual language
4. ⬜ Build color system
5. ⬜ Define typography scale
6. ⬜ Create spacing tokens
7. ⬜ Document component taxonomy
8. ⬜ Define motion system
9. ⬜ Write content guidelines
10. ⬜ Establish accessibility standards
11. ⬜ Define theming architecture
12. ⬜ Write engineering contracts
13. ⬜ Establish governance model

---

## Maintainers

**Design System Lead**: TBD
**Engineering Lead**: TBD
**Accessibility Lead**: TBD

**Questions?** Open an issue with `[design-system]` prefix.

---

**Remember**: A design system is not a project. It's a product that serves products.
