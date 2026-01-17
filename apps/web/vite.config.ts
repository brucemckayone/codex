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
    include: ['src/**/*.test.ts'], // Only unit tests, not Playwright .spec.ts files
    environment: 'happy-dom',
  },
});
