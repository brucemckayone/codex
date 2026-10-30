import { createPackageConfig } from '../../config/vite/package.config';

export default createPackageConfig({
  packageName: 'validation',
  // Bundled by each worker's wrangler, not here: this build bundled
  // isomorphic-dompurify's browser copy, which cannot run on Workers
  // (Codex-kcr87).
  additionalExternals: ['sanitize-html', /^svgo(\/|$)/],
});
