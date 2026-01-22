import { afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';

// Clean up DOM after each test
afterEach(() => {
  document.body.innerHTML = '';
});
