import { cleanup } from '@testing-library/svelte';
import { afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';

// Cleanup after each test
afterEach(() => {
  cleanup();
});
