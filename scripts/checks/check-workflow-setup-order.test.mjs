/**
 * Self-test for the workflow setup-order gate (Codex-2g7jj).
 *
 * "A check that has never failed has proven nothing" — so the must-catch cases
 * below are anchored on the ACTUAL shape that broke production on 2026-09-15
 * (pnpm/action-setup after actions/setup-node in deploy-production.yml), not on
 * a synthetic approximation of it.
 *
 * The near-misses are the load-bearing half. A gate that flags a `run:` block
 * mentioning setup-node, or demands pnpm in a checkout-less utility job, gets
 * switched off within a week — and a gate switched off is a convention again,
 * which is the condition this bead exists to end.
 *
 * Two cases deserve naming because they are the failures a line scan invites:
 *
 *   "a run: block is not a step"  — testing.yml is 1300+ lines and much of it
 *   is shell. A `uses:` written inside a block scalar must be invisible, in
 *   both directions: it must not raise a violation, and it must not CREDIT a
 *   pnpm step that does not exist.
 *
 *   "a sibling job's pnpm does not count" — the defect a file-level check has.
 *   Runners share nothing between jobs, so job B is broken even though the file
 *   contains a pnpm line.
 *
 * The final case reads the real .github/workflows tree on purpose. Every other
 * case could pass against a parser that returns nothing at all; that one fails
 * if the scanner stops seeing the repo's actual steps, so "OK" cannot come to
 * mean "parsed nothing".
 *
 * Run with node's built-in runner (`node --test`) rather than vitest: the thing
 * under test is a dependency-free .mjs CLI and this suite must stay runnable in
 * the static-analysis CI job.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  collectSetupOrderViolations,
  parseWorkflowJobs,
  workflowFiles,
  PNPM_SETUP,
  SETUP_NODE,
} from './check-workflow-setup-order.mjs';

/** The shape of deploy-production.yml immediately before PR #510 fixed it. */
const HISTORICAL_BREAK = `name: Production Deployment
on:
  workflow_run:
    workflows: ['PR and Push CI (Neon ephemeral DB)']
jobs:
  deploy-production:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - uses: actions/setup-node@v5
        with:
          node-version: '22'

      - uses: pnpm/action-setup@v5

      - name: Install dependencies
        run: pnpm install --frozen-lockfile
`;

const CORRECT_ORDER = `name: ok
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v5
      - uses: actions/setup-node@v5
        with:
          node-version: '22'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
`;

test('CATCHES the historical break: pnpm/action-setup after setup-node', () => {
  const v = collectSetupOrderViolations(HISTORICAL_BREAK, 'deploy-production.yml');
  assert.equal(v.length, 1);
  assert.equal(v[0].job, 'deploy-production');
  assert.equal(v[0].line, 11);
  assert.match(v[0].reason, /runs AFTER/);
});

test('CATCHES setup-node with no pnpm/action-setup anywhere in the job', () => {
  const src = `name: x
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
      - run: npm ci
`;
  const v = collectSetupOrderViolations(src);
  assert.equal(v.length, 1);
  assert.match(v[0].reason, /has no pnpm\/action-setup before it/);
});

test('PASSES the correct order', () => {
  assert.deepEqual(collectSetupOrderViolations(CORRECT_ORDER), []);
});

test("a sibling job's pnpm does NOT satisfy another job (runners share nothing)", () => {
  const src = `name: x
on: [push]
jobs:
  first:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v5
      - uses: actions/setup-node@v5
  second:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
      - run: pnpm build
`;
  const v = collectSetupOrderViolations(src);
  assert.equal(v.length, 1, 'the second job must be reported');
  assert.equal(v[0].job, 'second');
});

test('EXEMPT: package-manager-cache: false switches auto-detection off', () => {
  const src = `name: x
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: '22'
          package-manager-cache: false
`;
  assert.deepEqual(collectSetupOrderViolations(src), []);
});

test("EXEMPT: package-manager-cache: 'false' quoted is still an opt-out", () => {
  const src = `name: x
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          package-manager-cache: 'false'
`;
  assert.deepEqual(collectSetupOrderViolations(src), []);
});

test('EXEMPT: a job with no checkout has no package.json to detect', () => {
  const src = `name: x
on: [push]
jobs:
  utility:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v5
      - run: npm i -g neonctl@2
`;
  assert.deepEqual(collectSetupOrderViolations(src), []);
});

test('a run: block is not a step — a uses: line inside shell is invisible', () => {
  const src = `name: x
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v5
      - uses: actions/setup-node@v5
      - name: Explain the rule
        run: |
          echo "the broken form was:"
          echo "  - uses: actions/setup-node@v5"
          # uses: pnpm/action-setup@v5
          echo "done"
`;
  assert.deepEqual(collectSetupOrderViolations(src), [], 'shell text must not raise');
  const jobs = parseWorkflowJobs(src);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].steps.length, 3, 'only the three real `uses:` steps');
});

test('a run: block must not CREDIT a pnpm step that does not exist', () => {
  const src = `name: x
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - name: Mention pnpm setup in prose
        run: |
          echo "remember: - uses: pnpm/action-setup@v5"
      - uses: actions/setup-node@v5
`;
  const v = collectSetupOrderViolations(src);
  assert.equal(v.length, 1, 'the shell mention must not count as a pnpm step');
  assert.match(v[0].reason, /has no pnpm\/action-setup before it/);
});

test('a job-level uses: (reusable workflow call) is not a step', () => {
  const src = `name: x
on: [push]
jobs:
  static-analysis:
    needs: [cleanup]
    uses: ./.github/workflows/static_analysis.yml
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v5
      - uses: actions/setup-node@v5
`;
  assert.deepEqual(collectSetupOrderViolations(src), []);
  const jobs = parseWorkflowJobs(src);
  assert.equal(jobs.length, 2);
  assert.equal(jobs.find((j) => j.name === 'static-analysis').steps.length, 0);
});

test('a step leading with name: still has its uses: detected', () => {
  const src = `name: x
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v5
      - name: Node
        uses: actions/setup-node@v5
      - name: Pnpm
        uses: pnpm/action-setup@v5
`;
  const v = collectSetupOrderViolations(src);
  assert.equal(v.length, 1, 'name-first steps must be parsed, and this order is wrong');
  assert.match(v[0].reason, /runs AFTER/);
});

test('an inline comment after uses: does not defeat matching', () => {
  const src = `name: x
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5 # bumped for Node 24
      - uses: pnpm/action-setup@v5
`;
  const v = collectSetupOrderViolations(src);
  assert.equal(v.length, 1);
  assert.match(v[0].reason, /runs AFTER/);
});

test('a block scalar OUTSIDE a step must not forge a phantom pnpm step', () => {
  // A reusable-workflow call passing a YAML snippet as a string input. The
  // body sits at JOB level, not inside a step, so the step-level skipping does
  // not cover it — only the main parse loop does. Mutation-tested: removing
  // the main loop's skipBlockScalar makes the phantom `- uses:` below count as
  // a real pnpm step, and this gate goes SILENT on the job beneath it, which
  // is the direction that costs a deploy rather than a false alarm.
  const src = `name: x
on: [push]
jobs:
  call:
    uses: ./.github/workflows/reusable.yml
    with:
      snippet: |
        - uses: pnpm/action-setup@v5
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
`;
  const jobs = parseWorkflowJobs(src);
  assert.deepEqual(
    jobs.map((j) => j.name),
    ['call', 'build'],
    'the snippet body must not open a job'
  );
  assert.equal(jobs[0].steps.length, 0, 'a job-level `with:` snippet holds no steps');

  const v = collectSetupOrderViolations(src);
  assert.equal(v.length, 1, 'the phantom pnpm step must not satisfy the rule');
  assert.equal(v[0].job, 'build');
  assert.match(v[0].reason, /has no pnpm\/action-setup before it/);
});

test('the REAL workflow tree parses — "OK" cannot mean "parsed nothing"', () => {
  const files = workflowFiles();
  assert.ok(files.length >= 10, `expected the real workflow dir, saw ${files.length} files`);

  let setupNode = 0;
  let pnpm = 0;
  let jobs = 0;
  let testingYmlSetupNodeJobs = 0;

  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const parsed = parseWorkflowJobs(src);
    jobs += parsed.length;
    for (const job of parsed) {
      const n = job.steps.filter((s) => s.uses.startsWith(`${SETUP_NODE}@`)).length;
      setupNode += n;
      pnpm += job.steps.filter((s) => s.uses.startsWith(`${PNPM_SETUP}@`)).length;
      if (n > 0 && file.endsWith('testing.yml')) testingYmlSetupNodeJobs += 1;
    }
  }

  assert.ok(setupNode >= 10, `parser saw only ${setupNode} ${SETUP_NODE} steps`);
  assert.ok(pnpm >= 10, `parser saw only ${pnpm} ${PNPM_SETUP} steps`);
  assert.ok(jobs >= 20, `parser saw only ${jobs} jobs`);
  assert.ok(
    testingYmlSetupNodeJobs >= 4,
    `testing.yml carries four independent setup pairs; parser attributed ${testingYmlSetupNodeJobs} jobs`
  );
});
