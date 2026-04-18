# Audit Methodology

## Four dimensions per section

### 1. CSS modernity
- **Modern APIs in use** — `:has()`, `@container`, `@layer`, custom media queries, view transitions, `text-wrap`, `color-mix()`, relative colour syntax, logical properties, `@property`, nesting
- **Modern APIs missing** — patterns that could be simplified by adopting a feature we already ship
- **Legacy patterns** — autoprefixer artefacts, vendor prefixes that current browsers drop, float layouts, JS-driven responsive that could be CSS

### 2. Inheritance & reuse
- **Token adoption** — are hardcoded values gone? Do tokens compose (primitive → semantic → component)?
- **Component reuse** — is a pattern a component or a copy-paste? Are wrappers hiding reuse?
- **Cascade correctness** — is the cascade doing the work, or are there `!important` / high-specificity overrides fighting it?

### 3. Wasted code
- **Unused files** — verified with grep across the whole repo before declaring unused (per CLAUDE.md / feedback memory)
- **Dead selectors** — classes that no component emits, media queries that no element falls into
- **Duplicate rules** — same declaration block in multiple places
- **Bloat** — oversized rules that would be smaller as a token reference

### 4. Simplification
- **Over-engineering** — wrappers that add nothing, abstractions with one caller, premature variants
- **Inlinable complexity** — components that could be a Svelte snippet or a CSS class
- **Specific refactors** — with approximate effort and impact

## Severity scale

| Level | Definition |
|---|---|
| High | User-visible bug, a11y failure, or meaningful bundle bloat (>2KB CSS) |
| Medium | Architectural inconsistency or reuse gap affecting multiple components |
| Low | Polish, nitpicks, marginal bundle wins |

## Guardrails (from CLAUDE.md + memory)

- Never claim unused without grepping the full repo (UI + tests + docs)
- Design tokens only — flag any hardcoded px/hex/rgb values
- Currency is GBP (£) — flag any `$` USD occurrences in UI copy
- Respect Svelte 5 idiom — `$props`, `$state`, `$app/state`, snippets
- Use `$app/state` (not `$app/stores`), `page.url` (not `$page.url`)
- Prefer `getServiceUrl()` from `@codex/constants` — flag hardcoded ports

## Output rules

- Per-section report must include line numbers so findings are actionable
- Each finding maps to a recommendation — don't list problems without solutions
- Quote snippets sparingly; prefer file:line references

## Traceability

Each report ends with a commit. `git log --follow docs/frontend-audit/` shows the full trail of each firing's contribution.
