import adapter from '@sveltejs/adapter-auto';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    alias: {
      $lib: './src/lib',
      '@codex/database': '../../packages/database/src',
      '@codex/validation': '../../packages/validation/src',
      '@codex/cloudflare-clients': '../../packages/cloudflare-clients/src',
      '@codex/core-services': '../../packages/core-services/src',
      '@codex/auth': '../../packages/auth/src',
      '@codex/notifications': '../../packages/notifications/src',
    },
  },
};

export default config;
