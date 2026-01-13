import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      // Cloudflare Workers adapter options
      routes: {
        include: ['/*'],
      },
    }),
    alias: {
      $lib: './src/lib',
      $paraglide: './src/paraglide',
      '@codex/database': '../../packages/database/src',
      '@codex/validation': '../../packages/validation/src',
      '@codex/cloudflare-clients': '../../packages/cloudflare-clients/src',
      '@codex/test-utils': '../../packages/test-utils/src',
    },
    // NOTE: Remote Functions (experimental.remoteFunctions) available but not enabled yet
    // Enable when stable for type-safe client-server communication
  },
};

export default config;
