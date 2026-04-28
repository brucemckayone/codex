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
    // Why `style-src` includes `https://fonts.googleapis.com`: the brand
    // editor exposes a Google Fonts catalog (see brand-editor/font-catalog.ts).
    // `loadGoogleFont()` in brand-editor/css-injection.ts injects a
    // <link rel="stylesheet" href="https://fonts.googleapis.com/css2?...">
    // at runtime when the org or editor selects a non-default font, and
    // `'unsafe-inline'` does not whitelist external stylesheet origins.
    // Only the CSS origin is added here; the underlying woff2 binaries are
    // already covered by `font-src 'https://fonts.gstatic.com'`. Other
    // external stylesheet origins remain disallowed.
    //
    // `connect-src` is `self` in production because all worker traffic is
    // server-to-server (apps/web -> workers via createServerApi). The
    // browser only ever fetches from its own origin (SvelteKit endpoints,
    // remote functions, /__data.json).
    //
    // The dev-only `localhost:4100` / `*.nip.io:4100` entries on
    // `connect-src` cover the AudioPlayer's `fetch(waveform.json)` sidecar.
    // The waveform is rendered as a separate JSON file alongside the HLS
    // playlist, and `fetch()` is governed by `connect-src` (not
    // `media-src`). The same origins on `media-src` cover the
    // `<audio src=master.m3u8>` (HLS) playback path.
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
        // ─────────────────────────────────────────────────────────────
        // Why `script-src` includes 'unsafe-hashes' + a sha256 hash
        // ─────────────────────────────────────────────────────────────
        //
        // Svelte 5 emits inline HTML attributes alongside any function-
        // typed `onerror={fn}` or `onload={fn}` handler on media elements
        // (<img>, <video>, <audio>):
        //
        //   <img onerror="this.__e=event" onload="this.__e=event" ...>
        //
        // This is Svelte's pre-hydration event capture. Media elements can
        // fire load/error BEFORE the client JS bundle finishes downloading
        // and hydration runs (typical timeline: image errors at ~120ms,
        // hydration completes at ~500ms). Without the inline capture, the
        // event vanishes and the framework's addEventListener handler —
        // attached at hydration — never fires. The inline attribute writes
        // the event onto `node.__e`; Svelte reads it post-hydration and
        // replays through the real handler. See the Svelte SSR emitter:
        // node_modules/svelte/src/compiler/phases/3-transform/server/visitors/shared/element.js
        // (search for `__e=event`).
        //
        // CSP does NOT let nonces apply to event-handler attributes (per
        // CSP spec — nonces only cover <script> and <style> elements). To
        // allow this specific framework pattern without weakening CSP for
        // unrelated inline handlers, we whitelist the exact handler body
        // by SHA256 hash:
        //
        //   sha256( "this.__e=event" ) →
        //     7dQwUgLau1NFCCGjfn9FsYptB6ZtWxJin6VohGIu20I=
        //
        // To recompute (e.g. after a Svelte upgrade changes the string):
        //   echo -n 'this.__e=event' | openssl dgst -sha256 -binary | openssl base64
        //
        // 'unsafe-hashes' is REQUIRED alongside the hash entry because hash
        // matching for event-handler attributes is opt-in (the spec gates it
        // behind 'unsafe-hashes' to make the trade-off explicit). Without
        // 'unsafe-hashes' the sha256 entry is ignored for our case.
        //
        // ─── Threat model ─────────────────────────────────────────────
        // What this allows: any inline handler whose body hashes to the
        // entry above. That body is literally the 14 bytes `this.__e=event`,
        // which is functionally inert — it stashes an event object on the
        // element and does not fetch URLs, read storage, or execute
        // attacker code. App logic runs in addEventListener callbacks
        // attached at hydration, which are NOT inline and are NOT covered
        // by this hash.
        //
        // What this still blocks: any other inline handler body
        // (`onclick="alert(1)"`, `onerror="fetch('evil')"`, etc.) — they
        // hash to different values. Inline <script> tags still require the
        // per-request nonce. External scripts still need to be same-origin.
        //
        // ─── Brittleness ──────────────────────────────────────────────
        // The string `this.__e=event` is hardcoded in Svelte's compiler
        // (file path above). If a future Svelte version changes it (rename
        // `__e`, reformat whitespace, add quotes), the hash will mismatch
        // and image error/load handlers will silently start failing CSP.
        //
        // Mitigations:
        //   1. Pin Svelte to an exact version in package.json (no caret)
        //      so `pnpm update` cannot change the emitted string without
        //      an intentional bump.
        //   2. A guard test in src/lib/security/csp-svelte-hash.test.ts
        //      asserts (a) Svelte's SSR emitter file still contains the
        //      literal contract string "this.__e=event", (b) sha256 of
        //      that string matches the entry below, and (c) the directive
        //      still includes 'unsafe-hashes'. Any of those drifting fails
        //      CI loudly. The test reads Svelte's compiler source via
        //      require.resolve so it survives pnpm path-hash changes.
        //   3. If pre-hydration capture stops being needed, refactor
        //      `onerror={fn}` callsites to a Svelte action using
        //      addEventListener — no inline attribute is emitted, this
        //      whole exception can come out, and CSP tightens.
        // ─────────────────────────────────────────────────────────────
        'script-src': [
          'self',
          "'unsafe-hashes'",
          "'sha256-7dQwUgLau1NFCCGjfn9FsYptB6ZtWxJin6VohGIu20I='",
        ],
        'style-src': ['self', 'unsafe-inline', 'https://fonts.googleapis.com'],
        'img-src': [
          'self',
          'data:',
          'blob:',
          'https://*.r2.cloudflarestorage.com',
          'https://*.r2.dev',
          // Dev-only origins — dev-cdn (Miniflare R2) serves all media in
          // local dev at http://localhost:4100, and the `cdnRewriteHook`
          // in hooks.server.ts rewrites that to <ip>.nip.io:4100 for LAN
          // mobile testing. These origins never resolve in production, so
          // listing them here is functionally inert outside dev.
          'http://localhost:4100',
          'http://*.nip.io:4100',
        ],
        'font-src': ['self', 'data:', 'https://fonts.gstatic.com'],
        'connect-src': [
          'self',
          // Dev-only — AudioPlayer fetches waveform.json from dev-cdn.
          // See header comment above on `connect-src`. Inert in production.
          'http://localhost:4100',
          'http://*.nip.io:4100',
        ],
        'media-src': [
          'self',
          'blob:',
          'https://*.r2.cloudflarestorage.com',
          'https://*.r2.dev',
          // Dev-only — HLS playback (master.m3u8 + segments) served from
          // dev-cdn (Miniflare R2). Inert in production.
          'http://localhost:4100',
          'http://*.nip.io:4100',
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
