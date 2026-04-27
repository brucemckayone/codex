import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SVELTE_CONFIG = resolve(__dirname, '../../../svelte.config.js');

// Walk into Svelte's installed package via Node's require resolution.
// This handles pnpm's content-addressed paths (.pnpm/svelte@x.y.z/...) so
// the test does not break across version bumps that change the path hash.
const require_ = createRequire(import.meta.url);
const sveltePackageJson = require_.resolve('svelte/package.json');
const SVELTE_SSR_EMITTER = resolve(
  dirname(sveltePackageJson),
  'src/compiler/phases/3-transform/server/visitors/shared/element.js'
);

// The exact 14-byte handler body Svelte 5 emits inline alongside any
// function-typed onerror={fn} / onload={fn} on media elements:
//
//   <img onerror="this.__e=event" ... >
//
// See svelte.config.js script-src — the long comment there explains why
// this is whitelisted by SHA256 hash and the threat-model trade-offs.
const SVELTE_HANDLER_CONTRACT = 'this.__e=event';

/**
 * Guard tests for the Svelte 5 pre-hydration capture CSP exception.
 *
 * The CSP in svelte.config.js declares:
 *   script-src ['self', "'unsafe-hashes'", "'sha256-...'"]
 *
 * The sha256 entry whitelists the exact body of Svelte 5's inline event-
 * handler capture. If a Svelte upgrade ever changes that body — rename
 * `__e`, reformat whitespace, switch to addEventListener-only — the hash
 * stops matching and CSP silently starts blocking image error/load
 * handlers.
 *
 * These tests fail loudly at CI time on any of three drift scenarios:
 *
 *   1. Svelte's SSR emitter no longer contains the literal contract
 *      string. (A future version reshaped the capture pattern.)
 *   2. svelte.config.js does not whitelist the sha256 of the contract
 *      string. (Hash entry was deleted, mistyped, or never updated after
 *      the contract changed.)
 *   3. svelte.config.js does not include `'unsafe-hashes'` alongside the
 *      sha256 entry. (Per CSP spec, hashes only apply to event-handler
 *      attributes when `'unsafe-hashes'` is also present.)
 *
 * To recompute the hash after an intentional Svelte change:
 *   echo -n '<new handler body>' | openssl dgst -sha256 -binary | openssl base64
 * Then update both SVELTE_HANDLER_CONTRACT above and the sha256 entry in
 * svelte.config.js script-src.
 */
describe('CSP: Svelte 5 pre-hydration capture hash guard', () => {
  it("Svelte's SSR emitter still contains the contract handler string", () => {
    const emitterSource = readFileSync(SVELTE_SSR_EMITTER, 'utf-8');

    expect(
      emitterSource.includes(SVELTE_HANDLER_CONTRACT),
      `Svelte's SSR emitter at ${SVELTE_SSR_EMITTER} no longer contains ` +
        `the literal string "${SVELTE_HANDLER_CONTRACT}". A Svelte upgrade ` +
        'has changed the pre-hydration capture pattern. Inspect the new ' +
        'emitted body and update SVELTE_HANDLER_CONTRACT in this test ' +
        "AND the sha256 entry in svelte.config.js script-src. If Svelte's " +
        'capture pattern was removed entirely, the CSP exception can be ' +
        "deleted (drop 'unsafe-hashes' and the sha256 entry)."
    ).toBe(true);
  });

  it('script-src whitelists the SHA256 of the contract handler', () => {
    const computedHash = `'sha256-${createHash('sha256')
      .update(SVELTE_HANDLER_CONTRACT)
      .digest('base64')}'`;

    const config = readFileSync(SVELTE_CONFIG, 'utf-8');

    expect(
      config.includes(computedHash),
      `svelte.config.js script-src does not include ${computedHash} — ` +
        `the SHA256 of the Svelte handler body "${SVELTE_HANDLER_CONTRACT}". ` +
        'Add it to the script-src directive. To recompute manually: ' +
        `echo -n '${SVELTE_HANDLER_CONTRACT}' | openssl dgst -sha256 ` +
        '-binary | openssl base64'
    ).toBe(true);
  });

  it("script-src includes 'unsafe-hashes' so the hash applies to event-handler attributes", () => {
    // Per CSP spec, sha256 hashes only match event-handler attributes when
    // 'unsafe-hashes' is also present in the directive. Without it, the
    // sha256 entry above only matches <script> bodies and Svelte 5's
    // inline capture stays blocked.
    const config = readFileSync(SVELTE_CONFIG, 'utf-8');

    const scriptSrcMatch = config.match(
      /['"]script-src['"]\s*:\s*\[([^\]]*)\]/m
    );

    expect(
      scriptSrcMatch,
      'svelte.config.js kit.csp.directives must declare a script-src directive'
    ).not.toBeNull();

    const scriptSrc = scriptSrcMatch?.[1] ?? '';

    expect(
      /['"]unsafe-hashes['"]/.test(scriptSrc),
      "script-src must include 'unsafe-hashes' for the sha256 entry to " +
        'cover inline event-handler attributes (per CSP spec). Without it ' +
        "the hash only matches <script> bodies and Svelte 5's pre-hydration " +
        'capture stays blocked.'
    ).toBe(true);
  });
});
