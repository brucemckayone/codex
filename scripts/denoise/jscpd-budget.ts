/**
 * jscpdBudget — programmatic clone-detection helper for denoise simplification proofs.
 *
 * Used by `__denoise_proofs__/iter-NNN/*.test.ts` files to assert clone counts
 * (the second flavour of the simplification 3-flavour rule from
 * `.claude/skills/denoise/SKILL.md` §6).
 *
 * Phase B: shells out to the `jscpd` CLI to produce a JSON report, then parses it.
 * Phase D may replace this with a programmatic API call once jscpd's stable
 * library API is depended on directly.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface JscpdBudgetOptions {
  /** Source root to scan, relative to repo root or absolute. */
  root: string;
  /** Minimum tokens for a clone to count. Default 50. */
  minTokens?: number;
  /** File extensions to scan. Default ['ts', 'tsx', 'svelte']. */
  formats?: string[];
  /** Paths to exclude (glob patterns). Default excludes node_modules, dist, __denoise_proofs__. */
  ignore?: string[];
}

export interface JscpdDuplicate {
  files: string[];
  lines: number;
  tokens: number;
}

export interface JscpdBudgetResult {
  duplicates: JscpdDuplicate[];
  total: number;
}

/**
 * Run jscpd against `root` and return structured duplicate clusters.
 *
 * Throws if jscpd CLI is not available or the report is malformed.
 *
 * @example
 *   const result = await jscpdBudget({ root: 'packages/foo/src', minTokens: 50 });
 *   expect(result.duplicates.length).toBeLessThan(3);
 */
export async function jscpdBudget(
  options: JscpdBudgetOptions
): Promise<JscpdBudgetResult> {
  const minTokens = options.minTokens ?? 50;
  const formats = options.formats ?? ['ts', 'tsx', 'svelte'];
  const ignore = options.ignore ?? [
    '**/node_modules/**',
    '**/dist/**',
    '**/.svelte-kit/**',
    '**/__denoise_proofs__/**',
    '**/*.test.ts',
    '**/*.spec.ts',
  ];

  const reportDir = await mkdtemp(join(tmpdir(), 'denoise-jscpd-'));

  try {
    await execFileAsync(
      'npx',
      [
        'jscpd',
        options.root,
        '--min-tokens',
        String(minTokens),
        '--formats-exts',
        formats.join(','),
        '--ignore',
        ignore.join(','),
        '--reporters',
        'json',
        '--output',
        reportDir,
        '--silent',
      ],
      { cwd: process.cwd() }
    );

    const reportPath = join(reportDir, 'jscpd-report.json');
    const rawReport = await readFile(reportPath, 'utf-8');
    const parsed = JSON.parse(rawReport) as {
      duplicates?: Array<{
        firstFile: { name: string };
        secondFile: { name: string };
        lines: number;
        tokens: number;
      }>;
    };

    const duplicates: JscpdDuplicate[] = (parsed.duplicates ?? []).map((d) => ({
      files: [d.firstFile.name, d.secondFile.name],
      lines: d.lines,
      tokens: d.tokens,
    }));

    return {
      duplicates,
      total: duplicates.length,
    };
  } finally {
    await rm(reportDir, { recursive: true, force: true });
  }
}
