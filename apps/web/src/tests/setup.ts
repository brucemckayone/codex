// Import mocks BEFORE any other imports
// This ensures mocks are hoisted and applied before module loading
import './mocks';
import { afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';

// Clean up DOM after each test (only if running in DOM environment)
afterEach(() => {
  if (typeof document !== 'undefined' && document.body) {
    document.body.innerHTML = '';
  }
});
