/**
 * Writes every brand face's own fallback, `styles/tokens/font-fallbacks.css`,
 * from its table (`lib/brand-editor/font-fallbacks.ts`). Run after changing
 * the table:
 *
 *   cd apps/web && pnpm exec tsx scripts/write-font-fallbacks-sheet.ts
 *
 * `font-fallbacks.test.ts` fails while the sheet and the table disagree.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fallbacksSheet } from '../src/lib/brand-editor/font-fallbacks';

const sheet = join(
  dirname(fileURLToPath(import.meta.url)),
  '../src/lib/styles/tokens/font-fallbacks.css'
);
writeFileSync(sheet, fallbacksSheet());
console.log(`wrote ${sheet}`);
