/**
 * consumerGraph — determines which workers/apps/packages consume a given package.
 *
 * Used by `.claude/skills/denoise/SKILL.md` §5.0 step 1 (cell-due algorithm) to detect
 * cells whose source has no churn but whose consumers have changed. A package with
 * no source diff but with workers calling it differently still warrants re-audit.
 *
 * Phase D: grep-based detection of `from '@codex/<pkg>'` imports across the monorepo.
 * Phase E may upgrade to TS compiler API for semantic resolution including barrel
 * chains, type-only imports, and renamed re-exports.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ConsumerGraphOptions {
  /** Search root, relative to repo root or absolute. Default: '.' */
  root?: string;
  /** Include only consumers under these path prefixes. Default: all of workers/apps/packages. */
  includePrefixes?: string[];
}

export interface ConsumerEntry {
  /** Path of the consuming file. */
  file: string;
  /** Specific symbols imported (best-effort, parsed from import statement). */
  symbols: string[];
  /** Whether the import is type-only (`import type { ... }`). */
  typeOnly: boolean;
}

export interface ConsumerGraphResult {
  /** The package whose consumers were enumerated. */
  packageName: string;
  /** Total number of unique files importing from this package. */
  consumerCount: number;
  /** Consumers split by category for easier filtering. */
  byCategory: {
    workers: ConsumerEntry[];
    apps: ConsumerEntry[];
    packages: ConsumerEntry[];
    other: ConsumerEntry[];
  };
  /** Flat list of all consumers. */
  all: ConsumerEntry[];
}

/**
 * Find every file that imports from `@codex/<packageName>`.
 *
 * @example
 *   const graph = await consumerGraph('security');
 *   console.log(`${graph.consumerCount} consumers (${graph.byCategory.workers.length} workers)`);
 */
export async function consumerGraph(
  packageName: string,
  options: ConsumerGraphOptions = {}
): Promise<ConsumerGraphResult> {
  const root = options.root ?? '.';
  const fullPackageName = packageName.startsWith('@codex/')
    ? packageName
    : `@codex/${packageName}`;

  const args = [
    '-rnE',
    `from\\s+['"\`]${escapeRegex(fullPackageName)}(/[^'"\`]*)?['"\`]`,
    root,
    '--include=*.ts',
    '--include=*.tsx',
    '--include=*.svelte',
    '--exclude-dir=node_modules',
    '--exclude-dir=dist',
    '--exclude-dir=.svelte-kit',
    '--exclude-dir=__denoise_proofs__',
    '--exclude-dir=worktrees',
    '--exclude=*.test.ts',
    '--exclude=*.spec.ts',
  ];

  let stdout = '';
  try {
    const result = await execFileAsync('grep', args, {
      maxBuffer: 50 * 1024 * 1024,
    });
    stdout = result.stdout;
  } catch (err: unknown) {
    const e = err as { code?: number; stdout?: string };
    if (e.code === 1) {
      // No matches — package has zero consumers
      return {
        packageName: fullPackageName,
        consumerCount: 0,
        byCategory: { workers: [], apps: [], packages: [], other: [] },
        all: [],
      };
    }
    throw err;
  }

  const consumerByFile = new Map<string, ConsumerEntry>();

  for (const rawLine of stdout.split('\n')) {
    if (!rawLine) continue;
    const match = rawLine.match(/^([^:]+):\d+:(.*)$/);
    if (!match) continue;
    const [, file, importLine] = match;
    if (!file || importLine === undefined) continue;

    const existing = consumerByFile.get(file);
    if (existing) {
      // Already counted this file via earlier import line; merge
      const newSymbols = parseImportedSymbols(importLine);
      existing.symbols = Array.from(
        new Set([...existing.symbols, ...newSymbols])
      );
      existing.typeOnly =
        existing.typeOnly && /^import\s+type\b/.test(importLine);
    } else {
      consumerByFile.set(file, {
        file,
        symbols: parseImportedSymbols(importLine),
        typeOnly: /^import\s+type\b/.test(importLine.trim()),
      });
    }
  }

  const all = Array.from(consumerByFile.values());

  const byCategory = {
    workers: all.filter(
      (c) => c.file.startsWith('workers/') || c.file.startsWith('./workers/')
    ),
    apps: all.filter(
      (c) => c.file.startsWith('apps/') || c.file.startsWith('./apps/')
    ),
    packages: all.filter(
      (c) => c.file.startsWith('packages/') || c.file.startsWith('./packages/')
    ),
    other: all.filter(
      (c) =>
        !c.file.startsWith('workers/') &&
        !c.file.startsWith('./workers/') &&
        !c.file.startsWith('apps/') &&
        !c.file.startsWith('./apps/') &&
        !c.file.startsWith('packages/') &&
        !c.file.startsWith('./packages/')
    ),
  };

  return {
    packageName: fullPackageName,
    consumerCount: all.length,
    byCategory,
    all,
  };
}

/**
 * Determine if a package's cell is due based on consumer churn.
 *
 * Combines source churn (caller's responsibility) with consumer churn (this function).
 *
 * @example
 *   const isDue = await hasConsumerChurn('security', { since: 'iter-024' });
 *   if (isDue) { /* run audit *\/ }
 */
export async function hasConsumerChurn(
  packageName: string,
  options: { since: string }
): Promise<{ churned: boolean; consumers: string[] }> {
  const graph = await consumerGraph(packageName);

  if (graph.consumerCount === 0) {
    return { churned: false, consumers: [] };
  }

  const consumerFiles = graph.all.map((c) => c.file);
  const churnedConsumers: string[] = [];

  for (const file of consumerFiles) {
    try {
      const result = await execFileAsync('git', [
        'log',
        `--since=${options.since}`,
        '--name-only',
        '--pretty=format:',
        '--',
        file,
      ]);
      if (result.stdout.trim()) {
        churnedConsumers.push(file);
      }
    } catch {}
  }

  return {
    churned: churnedConsumers.length > 0,
    consumers: churnedConsumers,
  };
}

function parseImportedSymbols(importLine: string): string[] {
  // Best-effort parse of `import { a, b, c as d } from '...'`
  const namedMatch = importLine.match(/import\s+(?:type\s+)?\{([^}]*)\}/);
  if (namedMatch && namedMatch[1]) {
    return namedMatch[1]
      .split(',')
      .map((s) =>
        s
          .trim()
          .split(/\s+as\s+/)[0]
          ?.trim()
      )
      .filter((s): s is string => Boolean(s));
  }
  // `import * as X from '...'`
  const namespaceMatch = importLine.match(/import\s+\*\s+as\s+(\w+)/);
  if (namespaceMatch && namespaceMatch[1]) {
    return [`* as ${namespaceMatch[1]}`];
  }
  // `import X from '...'` (default import; rare for @codex packages)
  const defaultMatch = importLine.match(/import\s+(\w+)\s+from/);
  if (defaultMatch && defaultMatch[1]) {
    return [defaultMatch[1]];
  }
  return [];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
