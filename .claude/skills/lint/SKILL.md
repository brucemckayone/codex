---
name: lint
description: Run Biome linting, formatting, and TypeScript type checking. Use when checking code quality, fixing formatting issues, or running type checks.
disable-model-invocation: true
---

# Codex Linting & Type Checking

Run linting and type checking for the Codex platform. Codex uses **Biome** for fast linting and formatting (not ESLint/Prettier).

## Available Commands

| Command | Description |
|---------|-------------|
| `pnpm check` | Format + lint with auto-fix (recommended for development) |
| `pnpm check:ci` | Check without auto-fix (for CI) |
| `pnpm format` | Format only |
| `pnpm lint` | Lint only |
| `pnpm typecheck` | Full TypeScript type checking across monorepo |
| `pnpm deadcode` | Find unused code with knip |

## Quick Usage

### Auto-fix formatting and linting issues
```bash
pnpm check
```

### Run type checking only
```bash
pnpm typecheck
```

### CI check (no auto-fix)
```bash
pnpm check:ci
```

### Find dead/unused code
```bash
pnpm deadcode
```

## Biome Configuration

From `biome.json`:
- **Formatter**: 2-space indent, single quotes, semicolons always
- **Linter**: Recommended rules, `noExplicitAny` as warning
- **Files**: packages, workers, apps, config directories
- **VCS**: Git-aware (only checks changed files when in git)

## Post-Edit Hooks

Automatic formatting is configured in `.claude/settings.local.json` via `PostToolUse` hooks. After any Edit/Write operation on supported file types (`.ts`, `.tsx`, `.js`, `.jsx`, `.svelte`, `.json`), Biome automatically formats the changed files.

## Pre-Commit Hooks

The project also uses `husky` + `lint-staged` for pre-commit checks.
