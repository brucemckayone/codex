import { defineConfig, PluginOption } from 'vite';
import path from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig({
  build: {
    target: 'esnext',
    outDir: path.resolve(__dirname, 'dist'),
    minify: false,
    sourcemap: true,
    lib: {
      entry: path.resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: 'index',
    },
    rollupOptions: {
      external: [
        /^@codex\//, // Don't bundle shared packages, treat as external
        'hono', // Externalize runtime dependencies
        'better-auth',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  plugins: [dts() as PluginOption],
});
