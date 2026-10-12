/**
 * Writes the page kit's face lookup, `styles/faces.css`, from its table
 * (`model/faces.ts`). Run after changing the table:
 *
 *   cd apps/web && pnpm exec tsx scripts/write-faces-sheet.ts
 *
 * `styles/faces.test.ts` fails while the sheet and the table disagree.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { facesSheet } from '../src/lib/page-builder/kit/model/faces';

const sheet = join(
  dirname(fileURLToPath(import.meta.url)),
  '../src/lib/page-builder/kit/styles/faces.css'
);
writeFileSync(sheet, facesSheet());
console.log(`wrote ${sheet}`);
