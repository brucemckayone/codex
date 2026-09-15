# Fallow False Positives & Gotchas — Codex

Accumulated from Codex-gv2r5 (2026-04-22, fallow 2.x: 236 hits -> 46 real
cleanups, 154 framework-dispatch false positives, 5 human escalations) and
every cycle since.

**Read the matching row BEFORE proposing any deletion.** A row that matches is
a `.fallowrc.json` entry, not a delete.

## False-Positive Taxonomy

This is the reference card. If a fallow finding matches any pattern below, do NOT delete without escalation.

| # | Pattern | Signature | How to verify |
|---|---------|-----------|---------------|
| 1 | **SvelteKit remote functions** | `apps/web/src/lib/remote/**/*.remote.ts` exports | Framework compiler-registered. ALWAYS false positive. Never delete. |
| 2 | **`export *` chains** | Re-export-star across 2+ files | Grep the symbol directly — fallow can't trace multi-hop `export *`. Fix by replacing with explicit re-exports. |
| 3 | **Service registry dispatch** | `ctx.services.X.method()` | Grep `packages/worker-utils/src/procedure/service-registry.ts` — any method accessed via registry is live, regardless of static import count. |
| 4 | **Dynamic preset loading** | `import('./renderers/${name}-renderer')` | Grep the filename stem and the preset-key string. ShaderHero is the canonical example. |
| 5 | **Namespace barrel aliasing** | `import * as X from '$lib/ui/Y'` then `<Y.Root>` | Grep `import \* as` in consumers — Melt UI pattern for Table, Accordion, Popover, Tabs, Card. |
| 6 | **Storybook dynamic registration** | `.stories.svelte` referencing a component | Storybook loads stories via its own resolver. A component used only by a story is still live in the design system — escalate, don't auto-delete. |
| 7 | **DurableObject entry points** | `fetch(request)`, `alarm()` on a DO class | Runtime-dispatched by Cloudflare. Always false positive. |
| 8 | **Interface contract properties** | `class X implements Y` with property `Y` requires | Grep the interface definition — implementations look "unused" to fallow but satisfy a contract (e.g., `EmailProvider.name`). |
| 9 | **PostCSS global-data** | CSS files referenced by `postcss.config.js` | Check `postcss.config.js` for the file path. Breakpoints.css is the canonical case. |
| 10 | **Paraglide message names** | Function names like `followers_only_cta_title` | Check `messages/en.json` for matching keys. Build-time generated symbols. |
| 11 | **Self-use type exports** | Type used only as parameter/return type in its own file | Grep same-file hits. Safe action: drop `export`, keep the type declaration (see PR 5 pattern). |

## Verification Procedure (Per Item)

Every candidate runs through this checklist before landing:

1. `Grep <symbol_name> --glob '!.claude/worktrees/**'` — filter worktree noise
2. `Grep <symbol_name> --glob '!**/*.stories.*' --glob '!.svelte-kit/**' --glob '!**/dist/**'` — filter build artifacts
3. For `.svelte` files: also grep the filename stem (`Grep "<BaseName>.svelte"`) — catches deep imports
4. For class members: grep `service-registry.ts` + `ctx.services.<instance>.<method>`
5. For barrel re-exports: trace `src/index.ts` → any intermediate → declaration; any `export *` hop is a blindspot
6. For documented APIs: `Grep <symbol> packages/<pkg>/CLAUDE.md workers/<worker>/CLAUDE.md` — documented = escalate
7. For paraglide message shapes: `Grep <symbol> apps/web/messages/en.json`

If ANY check surfaces a consumer, classify as FALSE POSITIVE with evidence.

## PR Commit Message Template

```
<type>(<scope>): <brief action> (Codex-<bead-id>)

<1-paragraph why this is safe — which fallow finding, what verification>

<bullet list of changes with file:line and reason per item>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

Types by PR cluster:
- PR 1 (deletions): `chore(web)`
- PR 2 (re-exports): `chore(web)` or `refactor(web)`
- PR 3 (package focus): `refactor(<package>)`
- PR 4 (dev-only): `chore(<package>)`
- PR 5 (internalize): `refactor(<scope>)`

## Escalation Beads (Always File These)

After landing the safe PRs, file these follow-up beads:

1. **Fallow config hardening** (P2) — Add suppressions to `.fallowrc.json` for every FP pattern that appeared (`.remote.ts`, dynamic loaders, PostCSS files). Include the `export *` refactor if applicable.
2. **"Wire or delete" decisions** (P3) — Consolidated bead with a checklist of documented-but-unwired APIs. One bead per category:
   - Designed-but-unwired security features (e.g., email hooks)
   - Documented DI extension points never activated (e.g., `setCachePurge`)
   - Dev helpers with no consumers (e.g., MailHog inspection helpers)
   - Scheduled-trigger candidates (cron/alarm callbacks with no wiring)
   - Total orphans with no documentation
3. **Doc rot** (P4) — Any stale doc flagged during verification (e.g., a doc claiming X is unused when grep shows otherwise).

## Gotchas (Lessons from Codex-gv2r5)

- **DataTable rule**: when fallow flags a barrel `index.ts` as dead, the sibling `.svelte`/implementation file is NOT automatically dead. Grep the filename stem — `CustomerTable.svelte:20` used `DataTable.svelte` directly.
- **Never run `biome check --write --unsafe`**: biome mis-renames `.remote.ts` exports with a `_` prefix, breaking SvelteKit's compiler transform. Documented in Codex-zf9wf.
- **Don't touch unexpected unstaged changes**: session started with an unstaged modification to `AudioPlayer/audio-analyser.ts` — in-progress work from another context. Leave it. Check `git status --short | grep -v worktree` before every commit.
- **`.claude/worktrees/` pollution**: any raw `grep`/`rg` without a worktree filter will return 12+ copies. Always exclude.
- **export-star is fallow's single biggest miss**: two lines in `packages/worker-utils/src/procedure/index.ts` (`export * from './binary-upload-procedure'`; `export * from './multipart-procedure'`) produce ~10 recurring false positives. Replacing with explicit re-exports permanently fixes the view.
- **`service-registry.ts` blindspot accounts for ~40 class-member FPs**: every `ctx.services.X.method()` call is invisible to static analysis.
- **Run fallow BEFORE and AFTER** — the delta table is the session's scorecard. Aim for a double-digit reduction in `total_issues` per audit.

