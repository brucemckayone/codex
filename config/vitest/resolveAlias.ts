import { resolve } from 'path';
import { fileURLToPath } from 'url';

export const resolveAlias = {
  '@codex/security': resolve(__dirname, '../../packages/security/src/index.ts'),
  '@codex/security/*': resolve(__dirname, '../../packages/security/src/*'),
  '@codex/database': resolve(__dirname, '../../packages/database/src/index.ts'),
  '@codex/database/*': resolve(__dirname, '../../packages/database/src/*'),
  '@codex/observability': resolve(
    __dirname,
    '../../packages/observability/src/index.ts'
  ),
  '@codex/observability/*': resolve(
    __dirname,
    '../../packages/observability/src/*'
  ),
  '@codex/validation': resolve(
    __dirname,
    '../../packages/validation/src/index.ts'
  ),
  '@codex/validation/*': resolve(__dirname, '../../packages/validation/src/*'),
};
