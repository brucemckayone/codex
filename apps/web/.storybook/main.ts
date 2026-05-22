import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import type { StorybookConfig } from '@storybook/sveltekit';

const require = createRequire(import.meta.url);

// Swallow build-tool PostHog shutdown-timeout rejections.
//
// `@inlang/paraglide-js` (transitively via `@inlang/paraglide-sveltekit/vite`,
// loaded by `apps/web/vite.config.ts`) constructs a `posthog-node` client at
// module load time with no env-var gate. When `storybook build` finishes the
// transform phase and Node tears the process down, PostHog's flush can hang
// (offline, slow DNS, blocked egress) and its internal 1s shutdown timeout
// rejects with no `.catch()` handler. Under Node 20's strict mode the orphan
// rejection crashes the build with exit 7 *after* Storybook has already
// emitted the static bundle.
//
// We do NOT want to suppress real rejections — only the well-known PostHog
// telemetry shutdown. Match the exact message string from posthog-node@4.x
// (see node_modules/.pnpm/posthog-node@*/lib/node/index.cjs).
if (typeof process !== 'undefined' && !('__codexPosthogSilencer' in process)) {
  Object.defineProperty(process, '__codexPosthogSilencer', { value: true });
  process.on('unhandledRejection', (reason: unknown) => {
    const message =
      typeof reason === 'string' ? reason : (reason as Error)?.message;
    if (
      typeof message === 'string' &&
      message.includes('Timeout while shutting down PostHog')
    ) {
      return; // build-tool telemetry — safe to drop
    }
    // Re-throw everything else so we keep crash-on-rejection semantics for real bugs.
    throw reason;
  });
}

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(js|ts|svelte)'],
  framework: getAbsolutePath('@storybook/sveltekit'),
  addons: [
    getAbsolutePath('@storybook/addon-essentials'),
    getAbsolutePath('@storybook/addon-a11y'),
    getAbsolutePath('@storybook/addon-svelte-csf'),
    getAbsolutePath('@storybook/addon-interactions'),
  ],
};

export default config;

function getAbsolutePath(value: string): string {
  return dirname(require.resolve(`${value}/package.json`));
}
