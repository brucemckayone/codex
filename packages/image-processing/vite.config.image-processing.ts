import topLevelAwait from 'vite-plugin-top-level-await';
import wasm from 'vite-plugin-wasm';
import { createPackageConfig } from '../../config/vite/package.config';

export default createPackageConfig({
  packageName: 'image-processing',
  additionalExternals: ['@cf-wasm/photon'],
  plugins: [wasm(), topLevelAwait()],
});
