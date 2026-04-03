# CSS Design Token Reference

Quick reference for all design tokens available in the Codex frontend.

---

## Colors

### Semantic (use these in components)

| Token | Light | Dark | Purpose |
|-------|-------|------|---------|
| `--color-interactive` | Primary 500 | Primary 400 | Buttons, links, active states |
| `--color-interactive-hover` | Primary 600 | Primary 300 | Hover states |
| `--color-interactive-active` | Primary 700 | Primary 200 | Pressed/active states |
| `--color-interactive-subtle` | Primary 50 | Primary 900 | Subtle backgrounds |
| `--color-focus` | Primary 500 | Primary 400 | Focus outline color |
| `--color-focus-ring` | Primary 200 | Primary 800 | Focus ring glow |
| `--color-border-focus` | Primary 500 | Primary 400 | Focus border |
| `--color-text-on-brand` | #ffffff | #ffffff | Text on brand backgrounds |

### Brand (overridden by org branding)

| Token | Default | Purpose |
|-------|---------|---------|
| `--color-brand-primary` | Primary 500 | Org primary color |
| `--color-brand-primary-hover` | Primary 600 | Hover variant |
| `--color-brand-primary-subtle` | Primary 100 | Subtle bg |
| `--color-brand-secondary` | Neutral 600 | Org secondary color |
| `--color-brand-accent` | Warning | Accent/highlight color |
| `--color-brand-accent-hover` | Warning 600 | Accent hover |
| `--color-brand-accent-subtle` | Warning 100 | Accent subtle bg |

### Surface & Text

| Token | Light | Dark |
|-------|-------|------|
| `--color-background` | Neutral 50 | Neutral 900 |
| `--color-surface` | #ffffff | Neutral 800 |
| `--color-surface-secondary` | Neutral 100 | Neutral 700 |
| `--color-surface-overlay` | rgb(0 0 0 / 0.5) | rgb(0 0 0 / 0.7) |
| `--color-text` | Neutral 900 | Neutral 50 |
| `--color-text-secondary` | Neutral 600 | Neutral 300 |
| `--color-text-muted` | Neutral 400 | Neutral 500 |
| `--color-text-inverse` | #ffffff | Neutral 900 |
| `--color-border` | Neutral 200 | Neutral 700 |
| `--color-border-strong` | Neutral 300 | Neutral 600 |
| `--color-border-subtle` | Neutral 100 | Neutral 800 |

### Status

| Token | Value |
|-------|-------|
| `--color-success` / `-50` / `-200` / `-700` | Green scale |
| `--color-warning` / `-50` / `-200` / `-700` | Amber scale |
| `--color-error` / `-50` / `-200` / `-700` | Red scale |
| `--color-info` / `-50` / `-200` / `-700` | Blue scale |

---

## Typography

| Token | Value | Usage |
|-------|-------|-------|
| `--font-sans` | Inter + fallbacks | Body text |
| `--font-heading` | Inter + fallbacks | Headings |
| `--font-mono` | JetBrains Mono | Code |
| `--text-xs` to `--text-4xl` | Fluid clamp() | Font sizes |
| `--font-normal` / `-medium` / `-semibold` / `-bold` | 400-700 | Weights |
| `--leading-none` / `-snug` / `-tight` / `-normal` / `-relaxed` | 1 - 1.75 | Line height |
| `--tracking-tight` / `-normal` / `-wide` / `-wider` | -0.025em to 0.05em | Letter spacing |

---

## Spacing

Scale: `--space-0` through `--space-24`. Base unit: `0.25rem * density`.

| Token | Default | Notes |
|-------|---------|-------|
| `--space-1` | 4px | Base unit |
| `--space-2` | 8px | |
| `--space-3` | 12px | |
| `--space-4` | 16px | Common padding |
| `--space-6` | 24px | Section gaps |
| `--space-8` | 32px | |
| `--space-12` | 48px | Large sections |

---

## Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-none` | 0 | Sharp corners |
| `--radius-xs` | base * 0.25 | Small elements |
| `--radius-sm` | base * 0.5 | Inputs, small cards |
| `--radius-md` | base (0.5rem) | Buttons, inputs |
| `--radius-lg` | base * 1.5 | Cards |
| `--radius-xl` | base * 2 | Modals, panels |
| `--radius-full` | 9999px | Pills, avatars |
| `--radius-button` / `-input` / `-card` / `-modal` | Semantic aliases | |

---

## Shadows

| Token | Usage |
|-------|-------|
| `--shadow-xs` | Subtle depth |
| `--shadow-sm` | Cards, tooltips |
| `--shadow-md` | Dropdowns, popovers |
| `--shadow-lg` | Modals, panels |
| `--shadow-xl` | Brand editor panel |
| `--shadow-inner` | Inset shadow |
| `--shadow-focus-ring` | Input focus glow |
| `--shadow-focus-ring-error` | Error input focus glow |

---

## Motion

| Token | Value | Usage |
|-------|-------|-------|
| `--duration-fast` | 100ms | Color transitions |
| `--duration-normal` | 200ms | General animations |
| `--duration-slow` | 300ms | Panel open/close |
| `--duration-slower` | 500ms | Complex transitions |
| `--ease-default` | cubic-bezier(0.4, 0, 0.2, 1) | General |
| `--ease-in` | cubic-bezier(0.4, 0, 1, 1) | Exit animations |
| `--ease-out` | cubic-bezier(0, 0, 0.2, 1) | Enter animations |
| `--ease-bounce` | cubic-bezier(0.34, 1.56, 0.64, 1) | Playful feedback |
| `--transition-colors` | Composite | Color/bg/border shorthand |
| `--transition-opacity` | Composite | Fade shorthand |

All durations collapse to 0.01ms when `prefers-reduced-motion: reduce`.

---

## Materials

| Token | Light | Dark |
|-------|-------|------|
| `--material-glass` | rgba(255,255,255,0.7) | rgba(23,23,23,0.7) |
| `--material-glass-border` | rgba(255,255,255,0.5) | rgba(255,255,255,0.1) |
| `--blur-sm` / `-md` / `-lg` / `-xl` | 4px / 8px / 12px / 20px | Backdrop blur |

---

## Z-Index

| Token | Value | Usage |
|-------|-------|-------|
| `--z-dropdown` | 1000 | Dropdowns |
| `--z-sticky` | 1020 | Sticky headers |
| `--z-fixed` | 1030 | Fixed elements |
| `--z-modal-backdrop` | 1040 | Modal overlay |
| `--z-modal` | 1050 | Modals, brand editor |
| `--z-popover` | 1060 | Popovers |
| `--z-tooltip` | 1070 | Tooltips |
| `--z-toast` | 1080 | Toast notifications |

---

## Opacity

Scale: `--opacity-0` through `--opacity-100` in increments of 10.

---

## Borders

| Token | Value |
|-------|-------|
| `--border-width` | 1px |
| `--border-width-thick` | 2px |
| `--border-style` | solid |
| `--border-default` | 1px solid var(--color-border) |
| `--border-focus` | 2px solid var(--color-border-focus) |
