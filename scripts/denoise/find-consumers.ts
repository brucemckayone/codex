/**
 * findConsumers — counts the import-site consumers of a named symbol across the repo.
 *
 * Used by `__denoise_proofs__/iter-NNN/*.test.ts` files to assert consumer counts
 * (the "lonely abstraction" Catalogue row from `.claude/skills/denoise/SKILL.md` §6).
 *
 * Phase B: grep-based detection. Good enough for proof tests against named exports;
 * fails for re-exports through barrels (caller must grep both the symbol and any
 * known re-export aliases).
 *
 * Phase D will replace this with a TypeScript compiler API walk that resolves
 * imports semantically, including barrel chains and renamed re-exports.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface FindConsumersOptions {
  /** Search root, relative to repo root or absolute. */
  root?: string;
  /** Glob patterns to include. Default `**\/*.{ts,tsx,svelte}`. */
  include?: string[];
  /** Glob patterns to exclude. Default excludes node_modules, dist, denoise_proofs, tests. */
  exclude?: string[];
}

export interface ConsumerHit {
  /** Path of the consuming file. */
  file: string;
  /** Line number of the import or use site. */
  line: number;
  /** Matched line content. */
  text: string;
}

/**
 * Find every file that imports or references a named symbol.
 *
 * Returns import-site hits and direct-reference hits separately is overkill for
 * Phase B — we collapse to a single list and let the caller filter.
 *
 * @example
 *   const consumers = await findConsumers('FooStrategy');
 *   expect(consumers.length).toBe(1);  // lonely abstraction proof
 */
export async function findConsumers(
  symbol: string,
  options: FindConsumersOptions = {}
): Promise<ConsumerHit[]> {
  const root = options.root ?? '.';
  const exclude = options.exclude ?? [
    'node_modules',
    'dist',
    '.svelte-kit',
    '__denoise_proofs__',
    '*.test.ts',
    '*.spec.ts',
    'worktrees',
  ];

  const args = [
    '-rnE',
    `\\b${escapeRegex(symbol)}\\b`,
    root,
    '--include=*.ts',
    '--include=*.tsx',
    '--include=*.svelte',
    ...exclude.flatMap((e) => ['--exclude-dir', e, '--exclude', e]),
  ];

  let stdout = '';
  try {
    const result = await execFileAsync('grep', args, {
      maxBuffer: 10 * 1024 * 1024,
    });
    stdout = result.stdout;
  } catch (err: unknown) {
    // grep exits 1 when no matches found — that's a valid result, not an error
    const e = err as { code?: number; stdout?: string };
    if (e.code === 1) {
      return [];
    }
    throw err;
  }

  const hits: ConsumerHit[] = [];
  const seenFiles = new Set<string>();

  for (const rawLine of stdout.split('\n')) {
    if (!rawLine) continue;
    const match = rawLine.match(/^([^:]+):(\d+):(.*)$/);
    if (!match) continue;
    const [, file, lineStr, text] = match;
    if (file && lineStr && text !== undefined) {
      // Dedupe by file — multiple hits in same file count as one consumer
      if (!seenFiles.has(file)) {
        seenFiles.add(file);
        hits.push({ file, line: parseInt(lineStr, 10), text: text.trim() });
      }
    }
  }

  return hits;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
