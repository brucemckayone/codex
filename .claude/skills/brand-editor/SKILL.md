---
name: brand-editor
description: >
  DEPRECATED alias — use /design-system instead. This skill's content has moved to
  references/10-brand-editor.md inside /design-system. The wider skill also covers tokens,
  CSS architecture, components, motion, accessibility, performance, icons, testing, and a
  mandatory MCP verification gate. All brand editor work now lives under /design-system.
allowed-tools: Read
---

# Brand Editor — Redirect to `/design-system`

> **This skill has moved.**
>
> `/brand-editor` was narrower than the work actually being done (which always touches
> tokens, CSS cascade, org-brand derivation, and Svelte components). It has been merged
> into the broader `/design-system` skill.

## Where to go

- **Brand editor full-chain content (Paths A–F)** — [`/design-system/references/10-brand-editor.md`](../design-system/references/10-brand-editor.md)
- **Any brand editor work** — invoke `/design-system` and follow its router's brand-editor branch

## Why the move

The brand editor touches every design-system surface:

| Need | `/design-system` reference |
|---|---|
| Understanding the token cascade a brand editor change flows into | `01-tokens.md` |
| CSS architecture for new org-brandable vars and `@custom-media` | `02-css-architecture.md` |
| New UI controls in `lib/components/brand-editor/levels/` | `03-components.md` |
| Editor motion (panel slide, preview micro-animations) | `04-motion.md` |
| Editor a11y (focus management, `sr-only`, contrast) | `05-accessibility.md` |
| Editor + live preview perf (effect cost, repaint cost) | `06-performance.md` |
| Any icon work inside the editor panels | `07-icons.md` |
| Editor component tests | `08-testing.md` |
| **Mandatory MCP verification** before closing any change | `09-mcp-verification.md` |
| The 6 brand-editor integration paths (A–F) | `10-brand-editor.md` |

## Historical note

This deprecation stub remains in place while workflows + muscle memory migrate to
`/design-system`. It will be removed in a future cleanup — the user will request deletion
explicitly.
