/**
 * Test data factories
 * Generate realistic test data for testing
 */

export function createMockUser(overrides = {}) {
  return {
    id: 'test-user-1',
    email: 'test@example.com',
    name: 'Test User',
    role: 'user',
    createdAt: new Date(),
    ...overrides,
  };
}

export function createMockContent(overrides = {}) {
  return {
    id: 'test-content-1',
    title: 'Test Content',
    description: 'Test description',
    createdAt: new Date(),
    ...overrides,
  };
}
