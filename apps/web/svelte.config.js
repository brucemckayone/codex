import { preprocessMeltUI, sequence } from '@melt-ui/pp';
import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: sequence([vitePreprocess(), preprocessMeltUI()]),
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
      $tests: './src/tests',
    },
    // NOTE: Remote Functions (experimental.remoteFunctions) available but not enabled yet
    // Enable when stable for type-safe client-server communication
  },
};

export default config;
