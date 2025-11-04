import { defineConfig, PluginOption } from 'vite';
import path from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: 'index',
    },
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      external: ['zod', '@neondatabase/serverless', 'hono'], // Node-only deps
    },
  },
  plugins: [dts() as PluginOption],
});
