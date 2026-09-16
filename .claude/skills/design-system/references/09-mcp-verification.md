# Reference 09 — MCP Verification Gate (MANDATORY)

**This reference is a hard gate.** Skipping it on any design-system task is a correctness
bug. Visual review without MCP evidence does not count as verification.

## 1. The Gate

Before closing any design-system task, confirm these four MCPs have responded to at least
one call each *during the current session*:

| MCP | Role |
|---|---|
| `svelte` | `svelte-autofixer` on every modified `.svelte`; `get-documentation` for any rune/syntax doubt; `list-sections` to find the right doc page |
| `context7` | `resolve-library-id` + `query-docs` for any Melt UI / SvelteKit / PostCSS / Vitest / Playwright / MDN Baseline question |
| `chrome-devtools` | `navigate_page` → `take_snapshot` → `take_screenshot` → `lighthouse_audit`; `performance_start_trace` for perf-sensitive routes |
| `playwright` | `browser_navigate` → `browser_snapshot` → interaction → `browser_take_screenshot` for user-facing flows |

**If any MCP is unavailable** — `ToolSearch` returns no match, or a call returns
`InputValidationError` after schema load — **STOP**. Tell the user which MCP is missing.
Do not proceed with guessed behaviour. Do not fabricate verification output.

## 1.5 Build Verification Gate (also MANDATORY)

Independent of MCPs, **every iter-NNN close MUST run a successful `pnpm build`** before
the bead is closed. Production build is the only step that compiles the full component
tree — `pnpm dev` lazy-compiles per-route and silently passes:

1. **Orphan closing tags in `.svelte` files** — parsed at compile, invisible until a
   route renders them at runtime. Caught the iter-016 regression that motivated this gate.
2. **`vite-plugin-dts` generation errors** — `failOnError: false` is the default; broken
   `.d.ts` files ship without complaint and surface as red squiggles for downstream
   package consumers later.
3. **Svelte 5 reactivity warnings** — `state_referenced_locally`, `unused_export_let`,
   unused CSS selectors. These appear in production compile output but are suppressed
   during dev to keep HMR fast.

### Command

```bash
pnpm build --filter='./packages/*' --filter=web
```

Total time: ~10 seconds when the workspace is warm. The cost-to-benefit is asymmetric —
the build catches a class of bugs that dev cannot, regardless of how thorough manual
verification was.

### What to do on failure

- **Fix in the current iteration** if the issue is small and clearly within scope
  (e.g., a stray closing tag, a missing import the dev cache had cached).
- **File a follow-up bead and re-open the originating iter-NNN bead** if the fix would
  expand the iteration's surface (e.g., the build failure exposes a typing change that
  cascades into 6 packages — that's a separate piece of work, not part of this iter).

**Never close an iter-NNN bead with a known build failure** — even with a TODO note. The
orphan tags from iter-016 shipped specifically because no contributor ran the build
before merging.

### iter-016 retrospective

- Failing commit: `a4e7422f` (chart a11y + data-table hardening)
- Bug class: three orphan `</content>` closing tags across `RevenueChart.svelte`,
  `CustomerTable.svelte`, `MemberTable.svelte`
- How it slipped through: dev server lazily compiles components on first route hit. No
  session navigated to `/studio` between commit and merge, so the orphan tags never
  surfaced. `pnpm typecheck` does not invoke the Svelte compiler — only `pnpm build` does.
- Tracking bead: Codex-mxmum (this gate's proposal); resolved 2026-05-05.

### Secondary gate (now enforced — Codex-76zya, 2026-05-05)

Broken `.d.ts` generation now fails the build via `vite-plugin-dts`'s `afterDiagnostic`
hook. Note: `vite-plugin-dts` 4.5.4 has **no `failOnError` flag** (despite older docs
suggesting one) — the equivalent semantic lives in the diagnostic-hook callback. The
gate is centralised in the two shared factories that every package + worker imports:

- `config/vite/package.config.ts` — used by all 21 packages
- `config/vite/worker.config.ts` — used by all 8 workers

Both factories' `afterDiagnostic` callback throws when the diagnostic list is non-empty
("vite-plugin-dts emitted N diagnostic(s); failing the build instead of silently shipping
broken .d.ts files"). Inline comments document the rationale so future contributors don't
try to "simplify" the throw back to a (non-existent) `failOnError: true` flag.

**First catch:** the gate immediately surfaced a latent bug in `@codex/test-utils` —
`createMockStripe(): Stripe` returned a type from a `stripe` package that wasn't declared
in test-utils' `package.json`, silently shipping broken `.d.ts` to every consumer. Fixed
in the same PR (`af6c894c`). This is exactly the asymmetric silent-ship class the gate is
designed to catch.

## 2. Change-Type → MCP Matrix

| Change type | svelte | context7 | chrome-devtools | playwright |
|---|---|---|---|---|
| Token addition/edit (CSS only) | — | — | ✓ rendered check | — |
| New component | ✓ autofixer | if library question | ✓ screenshot + lighthouse | ✓ keyboard flow |
| Component edit (visual only) | ✓ autofixer | — | ✓ before/after screenshot | optional |
| Component edit (behaviour) | ✓ autofixer | — | ✓ | ✓ interaction |
| Motion/animation | ✓ autofixer | Baseline check for new CSS | ✓ perf trace | ✓ reduced-motion audit |
| CSS architecture / Baseline adoption | — | ✓ Baseline status | ✓ lighthouse | — |
| Brand editor (any path) | ✓ autofixer | — | ✓ before/after | ✓ editor open/save flow |
| Icon (new or fix) | ✓ autofixer | — | ✓ size matrix screenshot | — |
| Test file only | ✓ autofixer | if new helper API | — | — |
| Performance fix | — | if new feature used | ✓ trace before/after | optional |

## 3. Workflow Per MCP

### Svelte MCP (`svelte-autofixer`)

```
1. Edit / create a .svelte file
2. Call svelte-autofixer on the file
3. Apply ALL suggested fixes
4. Call svelte-autofixer again to confirm clean
5. If unsure about a rune, call get-documentation before writing it
```

The autofixer catches rune misuse that typecheck misses — `$state` on a destructured prop,
improper `$derived.by` usage, `$effect` cleanup patterns, etc. Never close a Svelte edit
without at least one clean autofixer pass.

### Context7 MCP (library docs)

Use when:
- You're about to write Melt UI builder config (`createDialog`, `createSelect`, etc.)
- You're using a SvelteKit server feature (`depends`, `invalidate`, `hooks.server.ts`)
- You're checking Baseline status of a CSS feature (`@layer`, `@property`, `@starting-style`, `subgrid`, `light-dark()`, `content-visibility`)
- You're configuring Vitest or Playwright for a new test type
- You're in doubt about any third-party API

Flow:
```
1. resolve-library-id with the library name (e.g. "Melt UI")
2. query-docs with the resolved id + specific topic
3. Trust the docs output over your training data — library APIs change
```

Prefer Context7 over `WebFetch` — Context7 is curated + version-aware.

### Chrome DevTools MCP (visual/perf evidence)

```
1. browser_navigate to the affected route (e.g., http://lvh.me:3000/)
2. take_snapshot — creates an addressable DOM state
3. take_screenshot — visual evidence for the PR
4. lighthouse_audit — for any UI/perf-sensitive change
5. If perf-critical: performance_start_trace → interact → performance_stop_trace → performance_analyze_insight
6. list_console_messages — catch runtime errors that only surface in the browser
```

Evidence to include in the final task message:
- Screenshot before (from git/main) and after
- Lighthouse score delta for CLS/LCP if relevant
- Console messages (should be empty — any new warnings are a bug)

### Playwright MCP (user flows)

Use when a user-facing interaction changed (not just visuals):
```
1. browser_navigate to the flow start
2. browser_snapshot — establish the starting state
3. browser_click / browser_type / browser_fill_form — walk the flow
4. browser_wait_for — settle assertions
5. browser_take_screenshot at each meaningful state
6. browser_network_requests — verify no broken API calls
```

For brand editor flows: open the editor (`?brandEditor` query param), change a token, save,
reload, verify persistence.

## 4. Evidence Expectations for the Final Message

When closing a design-system task, paste a short section at the end of your response:

```
Verification:
- Svelte: autofixer clean on <file>, <file> (N fixes applied)
- Context7: confirmed Melt UI createDialog signature / confirmed @layer Baseline Widely
- Chrome DevTools: screenshot before/after at http://lvh.me:3000/; Lighthouse CLS 0.02 → 0.01
- Playwright: brand editor open → change primary colour → save → reload → colour persists
```

No evidence = task is not done.

## 5. When MCPs Disagree With Your Plan

If Svelte autofixer flags a pattern you were confident about — trust the autofixer. Fix it.
The autofixer has more recent knowledge than your training data.

If Context7 docs conflict with your memory of an API — trust the docs. APIs change.

If Chrome DevTools shows a Lighthouse regression you didn't expect — investigate before
closing. Don't hand-wave.

If Playwright can't complete a flow — the flow is broken. Either you shipped a bug, or the
test is wrong. Figure out which.

## 6. When MCPs Are Unavailable

Scenarios:
- **Tool not surfaced in ToolSearch** → the MCP server is disconnected. Tell the user.
- **Tool surfaces but call returns `InputValidationError`** → schema mismatch; tell the user, include the error.
- **Tool surfaces but never responds** → tell the user the MCP is hanging.

**Never:**
- Fabricate MCP output to satisfy the gate
- Claim verification without evidence
- Close the task and note "MCP was unavailable so I skipped it"

The gate is hard. Unavailable MCPs mean work pauses until the user reconnects them.

## 7. Gotchas / Anti-patterns

- **Don't** run the autofixer once and ignore its suggestions "because they look wrong". They're right. Fix the code.
- **Don't** use `WebFetch` to look up library docs when Context7 covers that library. Context7 is version-aware; WebFetch is not.
- **Don't** paste a screenshot from your imagination. Chrome DevTools screenshots are real bytes; if you don't have one, say so.
- **Don't** use Playwright for single-component verification — that's what the unit test + DevTools screenshot are for. Playwright is for flows.
- **Don't** skip Lighthouse on a new component "because I only changed the colour". Colour changes can affect contrast-ratio axe violations; Lighthouse catches them.
- **Don't** trust your memory of CSS Baseline status. It changes. Re-verify via Context7 each time you consider adopting a feature.

## 8. When to Re-Verify This Reference

- New MCPs installed that change the verification surface
- Updated change-type matrix as new workflows emerge
- Svelte / SvelteKit major version bump — autofixer capabilities change
- Chrome DevTools MCP / Playwright MCP tool catalogue changes

If an MCP disagrees with this reference, **the MCP wins** — update the reference.
