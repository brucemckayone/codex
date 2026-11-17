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
export const LAYERS = [
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
export const SAME_LAYER_EDGES = [
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

export const RULES = [
  {
    id: 'A1',
    title: 'Money moves only through the payments ledger',
    why: 'Transfers, reversals, refunds and payouts move real money. When each module calls Stripe itself, the ledger, the clawback rules and the payout thresholds can be bypassed by whichever caller forgets them. The owners are the four @codex/payments modules that record every movement.',
    scope: {
      include: ['packages/*/src/**/*.ts', 'workers/*/src/**/*.ts'],
      exclude: [
        ...NOT_TESTS,
        'packages/payments/src/payout-ledger.ts',
        'packages/payments/src/clawback.ts',
        'packages/payments/src/refund.ts',
        'packages/payments/src/bank-payouts.ts',
      ],
    },
    match: {
      kind: 'call',
      pattern:
        /\.(?:transfers\.(?:create|createReversal)|refunds\.create|payouts\.create)\(/,
    },
    fix: 'Move the money through @codex/payments (payout-ledger, clawback, refund or bank-payouts); never call these Stripe APIs directly.',
  },
  {
    id: 'LAYERS',
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
    title: 'Every doc under docs/ is listed in docs/README.md',
    why: '85 of 147 docs were cited nowhere in the repo. A doc nobody can find is never updated, and it keeps answering searches with stale content.',
    scope: {
      include: ['docs/**/*.md'],
      exclude: ['docs/README.md', 'docs/archive/**'],
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
      exclude: ['docs/archive/**', `${SESSION_NOTES}/**`],
    },
    match: { kind: 'cite', text: `${SESSION_NOTES}/` },
    fix: 'Move what the reference needs into a tracked doc and cite that instead.',
  },
  {
    id: 'DOC-BUDGET',
    title: 'A CLAUDE.md never grows past its word budget',
    why: '36 of 38 CLAUDE.md files were over budget (the root had 3,616 words against 1,500). Every word is loaded into every agent session in that folder, so length is paid on every task.',
    scope: { include: ['**/CLAUDE.md', '**/AGENTS.md'] },
    match: {
      kind: 'word-count',
      budgets: { 'CLAUDE.md': 1500 },
      defaultBudget: 600,
    },
    fix: 'Move reference material into docs/ and link it; keep the CLAUDE.md to the rules an agent needs in this folder.',
  },
];
