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
    experimental: {
      // Enable Remote Functions for type-safe server-client communication
      // See: https://svelte.dev/docs/kit/remote-functions
      remoteFunctions: true,
    },
  },
  compilerOptions: {
    experimental: {
      // Enable await expressions directly in Svelte 5 templates
      async: true,
    },
  },
};

export default config;
