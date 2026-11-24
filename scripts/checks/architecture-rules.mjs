/**
 * The architecture gate's rule registry (G0, Codex-xtcfl). DATA, not prose:
 * `check-architecture.mjs` runs these entries, and `docs/architecture/rules.md`
 * is generated from them, so a rule can't live only in a doc and a doc can't
 * describe a rule that doesn't run.
 *
 * An entry:
 *   id     A1, LAYERS, DOC-LINK… The same ID appears in the runner's output,
 *          the baseline, the rules page and any CLAUDE.md citation, so
 *          searching it finds the rule, its check and its doc.
 *   title  One line, stated as the invariant.
 *   why    Why the rule exists, for the rules page.
 *   scope  { include, exclude } repo-relative globs (default: every file).
 *   match  { kind, ... }: a kind from architecture-matchers.mjs.
 *   fix    The one fix an agent should apply, shown in every failure.
 */

import { RULES_DOC, renderRulesDoc } from './architecture-docs.mjs';
import {
  ciGateLists,
  PRESETS_FILE,
  rateLimitBindings,
} from './architecture-lists.mjs';

/** Production TypeScript: no tests, fixtures or declaration files. */
const NOT_TESTS = [
  '**/*.test.ts',
  '**/*.spec.ts',
  '**/*.type-check.ts',
  '**/*.d.ts',
  '**/__tests__/**',
  '**/__mocks__/**',
];

/**
 * The package layers, lowest first, measured from the dependency graph on
 * 2026-11-17 (it has no cycles). Every `workers/*` and `apps/*` package is an
 * implicit layer above these.
 */
const LAYERS = [
  {
    name: 'Foundation',
    // Ordered: a foundation package may depend on the ones BEFORE it. This is
    // today's topological order; a new edge that breaks it fails.
    ordered: true,
    packages: [
      '@codex/constants',
      '@codex/shared-types',
      '@codex/urls',
      '@codex/observability',
      '@codex/validation',
      '@codex/database',
      '@codex/service-errors',
      '@codex/cache',
      '@codex/cloudflare-clients',
      '@codex/security',
    ],
  },
  {
    name: 'Domain core',
    packages: [
      '@codex/payments',
      '@codex/agreements',
      '@codex/transcoding',
      '@codex/image-processing',
      '@codex/platform-settings',
      // Test infrastructure: foundation-only dependencies. apps/web lists it
      // under dependencies, so it needs a layer below the apps.
      '@codex/test-utils',
    ],
  },
  {
    name: 'Domain services',
    packages: [
      '@codex/purchase',
      '@codex/subscription',
      '@codex/organization',
      '@codex/content',
      '@codex/identity',
      '@codex/notifications',
    ],
  },
  {
    name: 'Cross-domain readers',
    packages: ['@codex/access', '@codex/admin'],
  },
  {
    name: 'Composition',
    packages: ['@codex/worker-utils'],
  },
];

/** Same-layer edges that exist on purpose. Each new one is a decision. */
const SAME_LAYER_EDGES = [
  {
    from: '@codex/image-processing',
    to: '@codex/transcoding',
    reason:
      "Image storage keys reuse transcoding's R2 key builders (getUserAvatarBaseKey, getContentThumbnailBaseKey).",
  },
  {
    from: '@codex/subscription',
    to: '@codex/purchase',
    reason:
      "Subscriptions reuse purchase's fee floor, checkout reservations and Stripe helpers.",
  },
  {
    from: '@codex/content',
    to: '@codex/organization',
    reason:
      'Only content tests import it today (2026-11-17); a candidate to move to devDependencies.',
  },
];

/**
 * The gitignored session-notes folder, built from parts so this registry (and
 * the rules page generated from it) never cites the folder itself.
 */
const SESSION_NOTES = ['docs', 'handover'].join('/');

/** The static-analysis job, whose steps CI-GATES keeps equal to GATES. */
const CI_WORKFLOW = '.github/workflows/static_analysis.yml';

/** The workflows that run the static-analysis job; each must run it unconditionally. */
export const CI_CALLERS = [
  '.github/workflows/testing.yml',
  '.github/workflows/main-gate.yml',
];

/** Steps of that job that prepare the run rather than gate it. */
export const CI_SETUP_STEPS = [
  'pnpm install --frozen-lockfile',
  'pnpm --filter web exec paraglide-js compile --project ./project.inlang --outdir ./src/paraglide',
  // The GLSL compiler the shader gate runs: CI only (gate.sh never runs sudo).
  'sudo apt-get update && sudo apt-get install -y --no-install-recommends glslang-tools',
];

/**
 * Every gate the static-analysis job runs, so `--gates` (and through it
 * gate.sh) runs the same set locally. `before` is a setup step the gate needs;
 * `needs` is a precondition named when the gate fails.
 *
 * What each gate runs is also what a change must countersign to loosen it
 * (architecture-raises.mjs, gateDependencies): the files its commands name are
 * found from the commands, and `files` (configs it reads, such as biome.json),
 * `filesMatching` (configs found by pattern, such as a nested biome.json, so a
 * new one counts) and `ratchets` (its own baseline, where only a rise loosens
 * it) say the rest.
 */
export const GATES = [
  {
    id: 'BIOME',
    title: 'Biome lint and format; every diagnostic fails',
    run: 'pnpm check:ci',
    files: ['biome.json'],
    // Biome 2 obeys a nested config (`"root": false`; from 2.4 also a hidden
    // .biome.json), and through vcs.useIgnoreFile every .gitignore and .ignore:
    // each can switch lint off for a folder. An ignore file loosens by a new
    // plain line, a lost negation, a new order or a move (S6 of
    // architecture-spec.mjs); deleting a plain line or adding a `!` doesn't.
    filesMatching: [
      '**/biome.json',
      '**/biome.jsonc',
      '**/.biome.json',
      '**/.biome.jsonc',
      '**/.gitignore',
      '**/.ignore',
    ],
  },
  {
    id: 'TYPECHECK',
    title: 'TypeScript across the monorepo',
    run: 'pnpm typecheck',
    // The shared configs every package extends. A package's own tsconfig is
    // not fingerprinted (63 files that change weekly); review is its backstop.
    files: [
      'tsconfig.json',
      'tsconfig.build.json',
      'config/tsconfig.json',
      'config/tsconfig/base.json',
      'config/tsconfig/package.json',
      'config/tsconfig/package-typecheck.json',
      'config/tsconfig/worker.json',
      // `svelte-kit sync` writes the tsconfig tsc and svelte-check read.
      'apps/web/svelte.config.js',
    ],
    // The root turbo.json, and each package's turbo.json at the tasks
    // typecheck depends on, come from the command itself (gateDependencies):
    // either can narrow a task's inputs, so CI replays a cached pass.
  },
  {
    id: 'SETUP-ORDER',
    title: 'Every workflow sets up pnpm before setup-node',
    selfTest: 'node --test scripts/checks/check-workflow-setup-order.test.mjs',
    run: 'node scripts/checks/check-workflow-setup-order.mjs',
  },
  {
    id: 'BRAND-BOUNDARY',
    title: 'The public bundle never imports the brand editor',
    selfTest: 'pnpm --filter web run check:brand-boundary:test',
    run: 'pnpm --filter web run check:brand-boundary',
  },
  {
    id: 'DIALOG-STRUCTURE',
    title: 'Dialogs are built from the shared Dialog parts',
    selfTest: 'pnpm --filter web run check:dialog-structure:test',
    run: 'pnpm --filter web run check:dialog-structure',
  },
  {
    id: 'LOAD-RETRY',
    title: 'A load failure renders the shared LoadFailedAlert with Retry',
    selfTest: 'pnpm --filter web run check:load-retry:test',
    run: 'pnpm --filter web run check:load-retry',
  },
  {
    id: 'OUTPUT-DOOR',
    title: 'A ShaderHero renderer reaches the screen only through bindOutput',
    selfTest: 'pnpm --filter web run check:output-door:test',
    run: 'pnpm --filter web run check:output-door',
  },
  {
    id: 'SHADER',
    title:
      'Every GLSL source compiles, and each compositor layer draws its input at amount 0',
    // CI installs glslang with apt (CI_SETUP_STEPS); locally it is a
    // precondition, never a `before`.
    needs: 'glslang on PATH (brew install glslang) and a Chrome with WebGL2',
    selfTest: 'pnpm --filter web run shaders:check:test',
    run: 'pnpm --filter web run shaders:check',
  },
  {
    id: 'FILM-PASS',
    title:
      "The Showreel's film passes, as text: no stray uniform, no shared pass id, no real clock in a flash",
    selfTest: 'pnpm --filter web run shaders:gate:test',
    run: 'pnpm --filter web run shaders:gate',
  },
  {
    id: 'E2E-PORTS',
    title: 'No hardcoded app or worker port under e2e/',
    selfTest: 'pnpm --filter web run check:e2e-ports:test',
    run: 'pnpm --filter web run check:e2e-ports',
  },
  {
    id: 'DATA-ACCESS',
    title:
      'Cache-Control from presets, no floating KV write, shared search inputs, deterministic sql time, VersionedCache gets waitUntil',
    selfTest: 'node --test scripts/checks/check-data-access-contract.test.mjs',
    run: 'node scripts/checks/check-data-access-contract.mjs',
  },
  {
    id: 'SVELTE-BASELINE',
    title: 'svelte-check finds no error beyond its baseline',
    before: CI_SETUP_STEPS[1],
    // In CI it runs after `pnpm typecheck`, which builds every package's dist/.
    needs: 'built packages: run `pnpm typecheck` first (gate.sh does)',
    selfTest: 'pnpm --filter web run check:svelte-baseline:test',
    run: 'pnpm --filter web run check:svelte-baseline',
    files: ['apps/web/svelte.config.js'],
    ratchets: ['apps/web/scripts/svelte-check-baseline.json'],
  },
  {
    id: 'ARCH',
    title: 'The rules on this page, and countersigned loosening',
    selfTest: 'node --test scripts/checks/check-architecture.test.mjs',
    run: 'node scripts/checks/check-architecture.mjs --ci',
  },
];

export const RULES = [
  {
    id: 'A1',
    title: 'Money moves only through the payments ledger',
    why: "Transfers, reversals, refunds and payouts move real money. When each module calls Stripe itself, the ledger, the clawback rules and the payout thresholds can be bypassed by whichever caller forgets them. The owners are the four @codex/payments modules that record every movement. Each call is pinned by the function it sits in (`transferPendingGroup>transfers.create(`), so a new call in another function fails even where an old one was fixed. Known limit: a text pattern can't follow an alias (`const t = stripe.transfers; t.create(`); the owner refactor and the types epic (Codex-omrp2) close that.",
    scope: {
      include: [
        'packages/*/src/**/*.{ts,mts,cts,js,mjs,cjs}',
        'workers/*/src/**/*.{ts,mts,cts,js,mjs,cjs}',
        'apps/*/src/**/*.{ts,mts,cts,js,mjs,cjs}',
        // An ops script moves real money as surely as a service does, and
        // the Stripe ones live beside their package (packages/database/scripts).
        'scripts/**/*.{ts,mts,cts,js,mjs,cjs}',
        '{packages,workers,apps}/*/scripts/**/*.{ts,mts,cts,js,mjs,cjs}',
      ],
      exclude: [
        ...NOT_TESTS,
        'scripts/checks/**', // the gate itself, which names the calls it bans
        'packages/payments/src/payout-ledger.ts',
        'packages/payments/src/clawback.ts',
        'packages/payments/src/refund.ts',
        'packages/payments/src/bank-payouts.ts',
      ],
    },
    match: {
      kind: 'call',
      // Optional chaining and spacing included: `transfers?.create (`, and an
      // optional call, `create?.(`.
      pattern:
        /\b(?:transfers\s*\??\.\s*(?:create|createReversal)|refunds\s*\??\.\s*create|payouts\s*\??\.\s*create)\s*(?:\?\.\s*)?\(/,
    },
    fix: 'Move the money through @codex/payments (payout-ledger, clawback, refund or bank-payouts); never call these Stripe APIs directly.',
  },
  {
    id: 'LAYERS',
    // A package.json can't carry a comment, so there is no line to except from.
    exceptions: false,
    title: 'A package depends only on lower layers',
    why: "Upward and sideways dependencies are how a payments package ends up importing purchase, and how a 9,000-line service becomes impossible to split. The layer map is today's graph, so the rule starts green and any new edge is a visible decision.",
    scope: {
      include: [
        'packages/*/package.json',
        'workers/*/package.json',
        'apps/*/package.json',
      ],
    },
    match: {
      kind: 'package-graph',
      layers: LAYERS,
      sameLayerEdges: SAME_LAYER_EDGES,
    },
    fix: 'Move the shared code down a layer, or add the edge to SAME_LAYER_EDGES in scripts/checks/architecture-rules.mjs with its reason.',
  },
  {
    id: 'SIZE',
    title: 'A money file never grows; a new one stays under 800 lines',
    why: 'The money services grew to 9,015 and 5,643 lines one urgent fix at a time. Pinning every large file at its size makes each change extract a module instead.',
    scope: {
      include: [
        'packages/payments/src/**/*.ts',
        'packages/purchase/src/**/*.ts',
        'packages/subscription/src/**/*.ts',
        'packages/agreements/src/**/*.ts',
        'workers/ecom-api/src/**/*.ts',
      ],
      exclude: NOT_TESTS,
    },
    match: { kind: 'line-count', newFileMax: 800 },
    fix: 'Extract the change into a new domain module instead of growing this file.',
  },
  // ---- Docs (D0). Archived docs are frozen history, deleted in D1. ----
  {
    id: 'DOC-LINK',
    title: 'Every relative markdown link resolves',
    why: 'The 2026-11-15 docs census found 34 dead links outside the archive. A dead link sends an agent to a file that was moved, renamed or never written, and it then guesses.',
    scope: { include: ['**/*.md'], exclude: ['docs/archive/**'] },
    match: { kind: 'md-link' },
    fix: 'Point the link at the file as it is now, or remove it.',
  },
  {
    id: 'DOC-PATH',
    title: 'Every repo path a doc cites exists',
    why: 'One cited repo path in six was dead (352 outside the archive). A doc that names a file that is gone teaches an agent a codebase that no longer exists. Placeholders like [domain], <name> and globs are exempt.',
    scope: { include: ['**/*.md'], exclude: ['docs/archive/**'] },
    match: { kind: 'md-path' },
    fix: 'Update the path to where the code lives now, or drop the citation.',
  },
  {
    id: 'DOC-INDEX',
    // The hit is the whole file (line 1), with no line above to carry an exception.
    exceptions: false,
    title: 'Every doc under docs/ is listed in docs/README.md',
    why: '85 of 147 docs were cited nowhere in the repo. A doc nobody can find is never updated, and it keeps answering searches with stale content.',
    scope: {
      include: ['docs/**/*.md'],
      // The session folder's README is a Session, not a doc to index.
      exclude: ['docs/README.md', 'docs/archive/**', `${SESSION_NOTES}/**`],
    },
    match: { kind: 'doc-index', index: 'docs/README.md' },
    fix: 'Link the doc (or its folder) from the right section of docs/README.md.',
  },
  {
    id: 'DOC-SESSION',
    title: 'No tracked file cites the gitignored session notes',
    why: 'docs/handover is gitignored, so CI and every other machine see a dead reference. Durable knowledge belongs in a tracked doc.',
    scope: {
      include: [
        '**/*.{md,ts,js,mjs,cjs,json,jsonc,yml,yaml,svelte,sh,py,toml}',
      ],
      // The folder's own tracked README describes the folder.
      // The rules page lists this rule's own scope, which names the folder.
      // The baseline lists file paths; it doesn't cite them.
      exclude: [
        'docs/archive/**',
        `${SESSION_NOTES}/**`,
        RULES_DOC,
        'scripts/checks/architecture-baseline.json',
      ],
    },
    match: { kind: 'cite', text: `${SESSION_NOTES}/` },
    fix: 'Move what the reference needs into a tracked doc and cite that instead.',
  },
  {
    id: 'DOC-BUDGET',
    title: 'A CLAUDE.md never grows past its word budget',
    why: '36 of 38 CLAUDE.md files were over budget (the root had 3,616 words against 1,500). Every word is loaded into every agent session in that folder, so length is paid on every task.',
    scope: {
      include: ['**/CLAUDE.md', '**/AGENTS.md'],
      // No AGENTS.md is tracked yet; the budget is there for the first one.
      optional: ['**/AGENTS.md'],
    },
    match: {
      kind: 'word-count',
      budgets: { 'CLAUDE.md': 1500 },
      defaultBudget: 600,
    },
    fix: 'Move reference material into docs/ and link it; keep the CLAUDE.md to the rules an agent needs in this folder.',
  },
  {
    id: 'RATE-LIMIT-BINDING',
    title:
      "Every rate-limit preset a worker's routes use has its binding in every environment",
    why: 'A preset with no wrangler binding fails OPEN: every request passes and rate_limit.fail_open is logged on each one. wrangler does not inherit ratelimits or Durable Object bindings into env.* blocks, so each environment needs its own. The preset-to-binding map is read from limits.ts, not copied.',
    scope: {
      include: [
        'workers/*/src/**/*.ts',
        'workers/*/wrangler.jsonc',
        PRESETS_FILE,
      ],
      exclude: NOT_TESTS,
    },
    match: { kind: 'lists-agree', ...rateLimitBindings },
    fix: "Add the binding to that worker's wrangler.jsonc, in every env block, in the same change (see the namespace_id scheme in its comment).",
  },
  {
    id: 'RULES-DOC',
    title: 'The rules page equals the registry',
    why: "A rules page written by hand drifts: the payments architecture doc said a money file was 5,097 lines long when it was 9,015. This page is rendered from the registry, so a rule can't exist only in prose, and the prose can't describe a rule that doesn't run.",
    scope: { include: [RULES_DOC, 'scripts/checks/architecture-*.mjs'] },
    // Drift is fixed, never held: no inline exception and no baseline pin.
    exceptions: false,
    baseline: false,
    match: {
      kind: 'generated',
      file: RULES_DOC,
      render: () => renderRulesDoc(RULES, GATES),
    },
    fix: 'Run pnpm check:arch --write-rules and commit the page with the registry change.',
  },
  {
    id: 'CI-GATES',
    title: "The registry's gate list and the static-analysis job's steps agree",
    why: "gate.sh, the local copy of CI, skipped five of CI's static gates, and PR #705 went red in CI minutes after passing it (Codex-kxdz9). With the list held here and checked both ways, a gate added to CI is run locally too, and a gate dropped from CI can't stay listed. A step switched off by if: or continue-on-error counts as dropped, the calling workflows must run the job unconditionally, and every pnpm script a gate runs must exist, because pnpm --filter exits 0 for a missing one.",
    scope: {
      include: [
        CI_WORKFLOW,
        ...CI_CALLERS,
        'scripts/checks/architecture-rules.mjs',
        'package.json',
        '{apps,packages,workers}/*/package.json',
      ],
    },
    // Drift is fixed, never held: no inline exception and no baseline pin.
    exceptions: false,
    baseline: false,
    match: {
      kind: 'lists-agree',
      ...ciGateLists({
        workflow: CI_WORKFLOW,
        callers: CI_CALLERS,
        gates: GATES,
        setupSteps: CI_SETUP_STEPS,
        registryFile: 'scripts/checks/architecture-rules.mjs',
      }),
    },
    fix: 'Add the step to GATES (or CI_SETUP_STEPS) in scripts/checks/architecture-rules.mjs, or add the missing step to the workflow.',
  },
  {
    id: 'WF-EPIC',
    title: "Every epic's lifecycle file and plan are well formed",
    why: 'One retro was written for 69 closed epics, and CI could see none of their state: beads lives outside git, and every plan lived in ~/.claude/plans. An epic.md in git is the lifecycle CI can read, and a plan whose WPs each name their Files, Verify and Pass when can be checked, not just trusted.',
    scope: {
      include: ['docs/epics/*/epic.md', 'docs/epics/*/plan.md'],
      // The templates hold placeholders; the self-test fills them in and checks them.
      exclude: ['docs/epics/_template/**'],
    },
    // A malformed lifecycle file is fixed, never held.
    exceptions: false,
    baseline: false,
    match: { kind: 'epic-file', check: 'lifecycle' },
    fix: 'Follow docs/epics/_template/: epic.md front matter (id equal to the folder, a known status, plan, prs once shipped), and Files:, Verify: and Pass when: lines in every ### WP-N block of plan.md.',
  },
  {
    id: 'DOC-PLAN',
    title: "A finished epic's folder holds only epic.md and retro.md",
    why: "Plans are true on the day they are written and never removed, which is how docs/archive grew to 47% of every word in the docs (census 2026-11-15). At the retro a plan's lasting conclusions move to a durable home, and the plan itself is deleted; git keeps it.",
    scope: {
      include: ['docs/epics/*/epic.md'],
      exclude: ['docs/epics/_template/**'],
    },
    exceptions: false,
    baseline: false,
    match: { kind: 'epic-file', check: 'folder' },
    fix: "Move the plan's lasting conclusions into a Reference doc, an ADR or a rule, then delete the plan, mockups and reports from the epic's folder.",
  },  {
    id: 'WF-LESSON',
    title: "Every lesson in a retro has a home CI can resolve",
    why: 'About 400 lessons lived in memory files and bd memories, outside git, against six checks in CI; a lesson recorded only there is advice. Each retro lesson names one home, a rule, an ADR, a test, a phrase in a skill or CLAUDE.md, or a prose-only verdict that says why every stronger home failed, and CI checks the home exists.',
    scope: {
      include: ['docs/epics/*/retro.md'],
      exclude: ['docs/epics/_template/**'],
    },
    exceptions: false,
    baseline: false,
    match: {
      kind: 'lessons-table',
      // Read when a retro is checked, so the list is the registry itself.
      ruleIds: () => [...RULES, ...GATES].map((r) => r.id),
    },
    fix: 'Give the lesson a Home from docs/epics/_template/retro.md: rule:<ID>, adr:NNNN, test:<path>, skill:<name> "phrase", claude-md:<path> "phrase", or prose-only: with a reason for each of arch, type, rule, test and hook.',
  },
];
