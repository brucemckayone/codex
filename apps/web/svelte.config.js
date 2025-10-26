import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      // Cloudflare Pages configuration
      routes: {
        include: ['/*'],
        exclude: ['<all>'],
      },
    }),
    alias: {
      $lib: './src/lib',
      '@codex/database': '../../packages/database/src',
      '@codex/validation': '../../packages/validation/src',
      '@codex/cloudflare-clients': '../../packages/cloudflare-clients/src',
    },
  },
};

export default config;
