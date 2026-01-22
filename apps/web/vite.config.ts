import { paraglide } from '@inlang/paraglide-sveltekit/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    // Paraglide must come before SvelteKit
    paraglide({
      project: './project.inlang',
      outdir: './src/paraglide',
    }),
    sveltekit(),
  ],
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.svelte.test.ts'], // Only unit tests, not Playwright .spec.ts files
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/tests/setup.ts'],
  },
  // Tell Vitest to use the `browser` entry points in `package.json` files,
  // even though it's running in Node. This is required for Svelte 5 runes
  // to work properly in @testing-library/svelte.
  resolve: process.env.VITEST
    ? {
        conditions: ['browser'],
      }
    : undefined,
});
