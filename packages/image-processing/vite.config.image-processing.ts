<<<<<<< HEAD

import topLevelAwait from 'vite-plugin-top-level-await';
import wasm from 'vite-plugin-wasm';

=======
>>>>>>> 8382ae6cb976af715f83b1cc106536c18c8b47cf

import { createPackageConfig } from '../../config/vite/package.config';

export default createPackageConfig({
  packageName: 'image-processing',
<<<<<<< HEAD
  additionalExternals: ['@cf-wasm/photon'],
  plugins: [wasm(), topLevelAwait()],
=======
  additionalExternals: ['drizzle-orm'],
>>>>>>> 8382ae6cb976af715f83b1cc106536c18c8b47cf
});
