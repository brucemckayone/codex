import type { StorybookConfig } from '@storybook/sveltekit';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(js|ts|svelte)'],
  framework: '@storybook/sveltekit',
  addons: [
    '@storybook/addon-essentials',
    '@storybook/addon-a11y',
    '@storybook/addon-svelte-csf',
  ],
  docs: {
    autodocs: 'tag',
  },
};

export default config;
