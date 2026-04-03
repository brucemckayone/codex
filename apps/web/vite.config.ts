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
    testTimeout: 15000,
  },
  server: {
    // Bind to 0.0.0.0 so lvh.me and nip.io (LAN wildcard DNS) can reach the server.
    host: true,
    // Allow lvh.me and nip.io plus all subdomains for local dev.
    // lvh.me resolves to 127.0.0.1, nip.io resolves to the embedded LAN IP.
    // Both support cross-subdomain cookie sharing (unlike localhost per RFC 6761).
    allowedHosts: ['.lvh.me', '.nip.io'],
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
