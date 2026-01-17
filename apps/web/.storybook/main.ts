import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import type { StorybookConfig } from '@storybook/sveltekit';

const require = createRequire(import.meta.url);

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(js|ts|svelte)'],
  framework: getAbsolutePath('@storybook/sveltekit'),
  addons: [
    getAbsolutePath('@storybook/addon-a11y'),
    getAbsolutePath('@storybook/addon-svelte-csf'),
    getAbsolutePath('@storybook/addon-docs'),
  ],
};

export default config;

function getAbsolutePath(value: string): string {
  return dirname(require.resolve(`${value}/package.json`));
}
