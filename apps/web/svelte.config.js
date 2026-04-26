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
    // Content-Security-Policy. SvelteKit injects nonces (dynamic SSR) or
    // hashes (prerendered) per `mode: 'auto'`. Manual <script> blocks in
    // src/app.html opt in via `nonce="%sveltekit.nonce%"`.
    //
    // Why `style-src` keeps `'unsafe-inline'`: Svelte transitions, scoped
    // component styles compiled into <style> elements at runtime, and the
    // brand editor's `injectTokenOverrides()` (live CSS variable injection
    // on the org layout) all rely on inline <style>. Per SvelteKit docs,
    // you must either omit `style-src` entirely or include `'unsafe-inline'`
    // — there is no nonce path for transition-generated styles. We pin the
    // origin list explicitly so a future tightening (e.g. nonced styles)
    // is a one-line change.
    //
    // `connect-src 'self'` is sufficient because all worker traffic is
    // server-to-server (apps/web -> workers via createServerApi). The
    // browser only ever fetches from its own origin (SvelteKit endpoints,
    // remote functions, /__data.json).
    //
    // `frame-ancestors 'none'` is the modern equivalent of X-Frame-Options
    // DENY (the hooks.server.ts header still says SAMEORIGIN — keep both
    // for defence in depth; modern browsers prefer the CSP directive).
    //
    // `form-action` permits Stripe Checkout / Customer Portal redirects
    // (server-side 303 redirects from our endpoints land at *.stripe.com).
    csp: {
      mode: 'auto',
      directives: {
        'default-src': ['self'],
        'script-src': ['self'],
        'style-src': ['self', 'unsafe-inline'],
        'img-src': [
          'self',
          'data:',
          'blob:',
          'https://*.r2.cloudflarestorage.com',
          'https://*.r2.dev',
        ],
        'font-src': ['self', 'data:', 'https://fonts.gstatic.com'],
        'connect-src': ['self'],
        'media-src': [
          'self',
          'blob:',
          'https://*.r2.cloudflarestorage.com',
          'https://*.r2.dev',
        ],
        'object-src': ['none'],
        'base-uri': ['self'],
        'frame-ancestors': ['none'],
        'form-action': [
          'self',
          'https://checkout.stripe.com',
          'https://billing.stripe.com',
        ],
      },
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
