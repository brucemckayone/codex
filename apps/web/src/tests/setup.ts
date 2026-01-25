import { afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';

// Clean up DOM after each test (only if running in DOM environment)
afterEach(() => {
  if (typeof document !== 'undefined' && document.body) {
    document.body.innerHTML = '';
  }
});
