import esbuild from 'esbuild';
import { nodeExternalsPlugin } from 'esbuild-node-externals';

esbuild
  .build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    outfile: 'dist/index.js',
    platform: 'node',
    target: 'node20',
    format: 'esm',
    plugins: [nodeExternalsPlugin()],
  })
  .catch(() => process.exit(1));
