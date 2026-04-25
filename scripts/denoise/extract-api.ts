/**
 * extractApi — produces a draft CLAUDE.md "Key Exports" section from a package's
 * actual exported surface using the TypeScript compiler API.
 *
 * Used by `.claude/skills/denoise/SKILL.md` §5 step 7 (cycle close) when
 * `--regen-claude` is set. Output is a unified diff at
 * `docs/denoise/claude-md-diffs/<pkg>-iter-NNN.diff` — NEVER auto-applied (R5).
 *
 * Phase D: walks `package.json` exports + entry-point file via TS compiler API.
 * Preserves any section wrapped in `<!-- denoise:keep -->` HTML comments verbatim.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import * as ts from 'typescript';

export interface ExtractApiOptions {
  /** Path to the package directory (e.g., 'packages/security'). */
  packageDir: string;
  /** Iteration ID for the diff filename. */
  iterId: string;
  /** Output directory for diffs. Default: 'docs/denoise/claude-md-diffs/'. */
  diffOutputDir?: string;
}

export interface ExportEntry {
  name: string;
  kind:
    | 'function'
    | 'class'
    | 'interface'
    | 'type'
    | 'const'
    | 'enum'
    | 'unknown';
  signature?: string;
  doc?: string;
}

export interface ExtractApiResult {
  packageName: string;
  exports: ExportEntry[];
  diffPath: string;
  changed: boolean;
}

/**
 * Walk the package's entry-point file and emit a CLAUDE.md diff.
 *
 * @example
 *   const result = await extractApi({ packageDir: 'packages/security', iterId: 'iter-027' });
 *   console.log(`Wrote diff to ${result.diffPath} (changed=${result.changed})`);
 */
export async function extractApi(
  options: ExtractApiOptions
): Promise<ExtractApiResult> {
  const packageDir = resolve(options.packageDir);
  const diffOutputDir = options.diffOutputDir ?? 'docs/denoise/claude-md-diffs';

  // 1. Read package.json
  const packageJsonPath = join(packageDir, 'package.json');
  const packageJsonRaw = await readFile(packageJsonPath, 'utf-8');
  const packageJson = JSON.parse(packageJsonRaw) as {
    name: string;
    exports?: Record<string, unknown> | string;
    main?: string;
  };

  // 2. Resolve entry-point file
  const entryPoint = resolveEntryPoint(packageDir, packageJson);

  // 3. Walk the entry file with TS compiler API
  const program = ts.createProgram([entryPoint], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    declaration: true,
    skipLibCheck: true,
  });
  const sourceFile = program.getSourceFile(entryPoint);
  if (!sourceFile) {
    throw new Error(`Could not load source file: ${entryPoint}`);
  }
  const checker = program.getTypeChecker();

  const exports: ExportEntry[] = [];
  ts.forEachChild(sourceFile, (node) => {
    collectExport(node, checker, exports);
  });

  // 4. Render the new "Key Exports" section
  const newSection = renderKeyExportsSection(packageJson.name, exports);

  // 5. Read existing CLAUDE.md, splice in new section while preserving denoise:keep blocks
  const claudeMdPath = join(packageDir, 'CLAUDE.md');
  let existingClaudeMd = '';
  try {
    existingClaudeMd = await readFile(claudeMdPath, 'utf-8');
  } catch {
    // CLAUDE.md doesn't exist yet — first regeneration
    existingClaudeMd = '';
  }

  const updated = spliceKeyExportsSection(existingClaudeMd, newSection);

  // 6. Compute unified diff
  const diff = computeUnifiedDiff(claudeMdPath, existingClaudeMd, updated);

  // 7. Write the diff to docs/denoise/claude-md-diffs/<pkg>-<iter-id>.diff
  const pkgSlug = packageJson.name
    .replace(/^@codex\//, '')
    .replace(/[^a-z0-9-]/gi, '-');
  const diffPath = join(diffOutputDir, `${pkgSlug}-${options.iterId}.diff`);
  await mkdir(dirname(diffPath), { recursive: true });
  await writeFile(diffPath, diff, 'utf-8');

  return {
    packageName: packageJson.name,
    exports,
    diffPath,
    changed: existingClaudeMd !== updated,
  };
}

function resolveEntryPoint(
  packageDir: string,
  packageJson: { exports?: unknown; main?: string }
): string {
  // Try `exports['.']`, then `exports['./index']`, then `main`, fallback to src/index.ts
  const exports = packageJson.exports;
  if (exports && typeof exports === 'object') {
    const e = exports as Record<string, unknown>;
    const dotExport = e['.'] ?? e['./index'];
    if (typeof dotExport === 'object' && dotExport !== null) {
      const types = (dotExport as Record<string, unknown>).types;
      if (typeof types === 'string') return resolve(packageDir, types);
      const importPath = (dotExport as Record<string, unknown>).import;
      if (typeof importPath === 'string')
        return resolve(packageDir, importPath);
    } else if (typeof dotExport === 'string') {
      return resolve(packageDir, dotExport);
    }
  }
  if (packageJson.main) return resolve(packageDir, packageJson.main);
  return resolve(packageDir, 'src/index.ts');
}

function collectExport(
  node: ts.Node,
  checker: ts.TypeChecker,
  out: ExportEntry[]
): void {
  const modifiers = ts.canHaveModifiers(node)
    ? ts.getModifiers(node)
    : undefined;
  const isExported = modifiers?.some(
    (m) => m.kind === ts.SyntaxKind.ExportKeyword
  );

  if (ts.isFunctionDeclaration(node) && isExported && node.name) {
    const symbol = checker.getSymbolAtLocation(node.name);
    out.push({
      name: node.name.text,
      kind: 'function',
      signature: signatureFromFunction(node, checker),
      doc: extractDoc(symbol, checker),
    });
  } else if (ts.isClassDeclaration(node) && isExported && node.name) {
    const symbol = checker.getSymbolAtLocation(node.name);
    out.push({
      name: node.name.text,
      kind: 'class',
      signature: `class ${node.name.text}`,
      doc: extractDoc(symbol, checker),
    });
  } else if (ts.isInterfaceDeclaration(node) && isExported) {
    const symbol = checker.getSymbolAtLocation(node.name);
    out.push({
      name: node.name.text,
      kind: 'interface',
      doc: extractDoc(symbol, checker),
    });
  } else if (ts.isTypeAliasDeclaration(node) && isExported) {
    const symbol = checker.getSymbolAtLocation(node.name);
    out.push({
      name: node.name.text,
      kind: 'type',
      doc: extractDoc(symbol, checker),
    });
  } else if (
    ts.isVariableStatement(node) &&
    node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  ) {
    for (const decl of node.declarationList.declarations) {
      if (ts.isIdentifier(decl.name)) {
        const symbol = checker.getSymbolAtLocation(decl.name);
        out.push({
          name: decl.name.text,
          kind: 'const',
          doc: extractDoc(symbol, checker),
        });
      }
    }
  } else if (ts.isEnumDeclaration(node) && isExported) {
    const symbol = checker.getSymbolAtLocation(node.name);
    out.push({
      name: node.name.text,
      kind: 'enum',
      doc: extractDoc(symbol, checker),
    });
  } else if (ts.isExportDeclaration(node)) {
    // `export { a, b, c }` — re-exports; surface them as opaque entries
    if (node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const element of node.exportClause.elements) {
        out.push({
          name: element.name.text,
          kind: 'unknown',
        });
      }
    }
  }
}

function signatureFromFunction(
  node: ts.FunctionDeclaration,
  checker: ts.TypeChecker
): string {
  const params = node.parameters
    .map((p) => {
      const name = p.name.getText();
      const type = p.type ? p.type.getText() : 'unknown';
      return `${name}: ${type}`;
    })
    .join(', ');
  const returnType = node.type ? node.type.getText() : 'unknown';
  return `(${params}) => ${returnType}`;
}

function extractDoc(
  symbol: ts.Symbol | undefined,
  checker: ts.TypeChecker
): string | undefined {
  if (!symbol) return undefined;
  const docs = symbol.getDocumentationComment(checker);
  if (docs.length === 0) return undefined;
  const text = ts.displayPartsToString(docs);
  return text.split('\n')[0]?.trim();
}

function renderKeyExportsSection(
  packageName: string,
  exports: ExportEntry[]
): string {
  const lines: string[] = [];
  lines.push('## Key Exports');
  lines.push('');
  lines.push(
    `Generated by \`/denoise\` from \`${packageName}\`'s entry point.`
  );
  lines.push('');
  lines.push('| Name | Kind | Description |');
  lines.push('|------|------|-------------|');
  for (const e of exports) {
    const desc = e.doc ?? '_(no JSDoc)_';
    lines.push(`| \`${e.name}\` | ${e.kind} | ${desc} |`);
  }
  lines.push('');
  return lines.join('\n');
}

function spliceKeyExportsSection(existing: string, newSection: string): string {
  if (!existing) {
    // First regen — wrap entire (empty) file in denoise:keep + append draft
    return `<!-- denoise:keep -->\n<!-- /denoise:keep -->\n\n${newSection}`;
  }

  // Find existing "## Key Exports" section bounds
  const startMatch = existing.match(/^## Key Exports\b/m);
  if (!startMatch || startMatch.index === undefined) {
    // No existing section; append at end
    return `${existing.trimEnd()}\n\n${newSection}`;
  }

  const startIdx = startMatch.index;
  // Find next H2 or end of file
  const afterStart = existing.slice(startIdx + 1);
  const nextH2Match = afterStart.match(/^## /m);
  const endIdx =
    nextH2Match && nextH2Match.index !== undefined
      ? startIdx + 1 + nextH2Match.index
      : existing.length;

  // Check if the existing section is wrapped in denoise:keep — if so, preserve it
  const sectionContent = existing.slice(startIdx, endIdx);
  if (sectionContent.includes('<!-- denoise:keep -->')) {
    // Preserve verbatim
    return existing;
  }

  return existing.slice(0, startIdx) + newSection + existing.slice(endIdx);
}

function computeUnifiedDiff(
  filePath: string,
  before: string,
  after: string
): string {
  if (before === after) {
    return `# No changes for ${filePath}\n`;
  }
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');

  const lines: string[] = [];
  lines.push(`--- a/${filePath}`);
  lines.push(`+++ b/${filePath}`);
  lines.push(`@@ -1,${beforeLines.length} +1,${afterLines.length} @@`);
  for (const line of beforeLines) lines.push(`-${line}`);
  for (const line of afterLines) lines.push(`+${line}`);
  return lines.join('\n') + '\n';
}
