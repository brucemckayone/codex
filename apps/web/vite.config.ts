import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // @ts-expect-error - sveltekit returns Promise<Plugin[]> but defineConfig expects PluginOption
  plugins: [sveltekit()],
  test: {
    include: ['src/**/*.{test,spec}.ts'], // Default include for now
    globals: true,
    environment: 'happy-dom',
  },
});
