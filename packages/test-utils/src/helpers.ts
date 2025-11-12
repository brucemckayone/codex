/**
 * Shared Test Helpers
 *
 * Provides utility functions and assertion helpers for Content Management Service tests.
 *
 * Key Points:
 * - Type-safe error assertions
 * - Content-specific test helpers
 * - Async wait utilities for timing-dependent tests
 */

/**
 * Wait for a condition to be true
 * Useful for testing async operations
 *
 * @param condition - Function that returns boolean (or Promise<boolean>)
 * @param timeout - Maximum wait time in milliseconds (default: 5000ms)
 * @throws Error if timeout is reached before condition becomes true
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout = 5000
): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timeout waiting for condition');
}

/**
 * Create a mock function with call tracking
 * Useful for spying on function calls in tests
 *
 * @returns Object with mock function and call tracking methods
 */
export function createMockFn<T extends (...args: never[]) => unknown>() {
  const calls: Array<Parameters<T>> = [];
  const mockFn = ((...args: Parameters<T>) => {
    calls.push(args);
  }) as T;

  return {
    fn: mockFn,
    calls,
    callCount: () => calls.length,
    lastCall: () => calls[calls.length - 1],
  };
}

/**
 * Assert that an error is a ContentServiceError with specific code
 *
 * Usage:
 * ```typescript
 * try {
 *   await service.create(invalidInput, creatorId);
 *   expect.fail('Should have thrown error');
 * } catch (error) {
 *   expectContentServiceError(error, 'VALIDATION_ERROR');
 * }
 * ```
 *
 * @param error - The error to check
 * @param expectedCode - Expected error code
 * @throws Error if error is not a ContentServiceError or has wrong code
 */
export function expectContentServiceError(
  error: unknown,
  expectedCode: string
): void {
  if (!error || typeof error !== 'object') {
    throw new Error(`Expected ContentServiceError, got ${typeof error}`);
  }

  const err = error as Error & { code?: string; message: string };

  if (!err.code) {
    throw new Error(
      `Expected ContentServiceError with code property, got: ${err.constructor.name}`
    );
  }

  if (err.code !== expectedCode) {
    throw new Error(
      `Expected error code '${expectedCode}', got '${err.code}': ${err.message}`
    );
  }
}

/**
 * Assert that an error is an instance of a specific error class
 *
 * Usage:
 * ```typescript
 * try {
 *   await service.get('invalid-id', creatorId);
 *   expect.fail('Should have thrown error');
 * } catch (error) {
 *   expectError(error, ContentNotFoundError);
 * }
 * ```
 *
 * @param error - The error to check
 * @param ErrorClass - Expected error class constructor
 * @param expectedCode - Optional error code to check (for errors with a code property)
 * @throws Error if error is not an instance of ErrorClass or has wrong code
 */
export function expectError<T extends new (...args: never[]) => Error>(
  error: unknown,
  ErrorClass: T,
  expectedCode?: string
): asserts error is InstanceType<T> {
  if (!(error instanceof ErrorClass)) {
    const actualName =
      error instanceof Error ? error.constructor.name : typeof error;
    throw new Error(
      `Expected error to be instance of ${ErrorClass.name}, got ${actualName}`
    );
  }

  // If expectedCode is provided, check it
  if (expectedCode !== undefined) {
    const err = error as Error & { code?: string };
    if (err.code !== expectedCode) {
      throw new Error(
        `Expected error code '${expectedCode}', got '${err.code}': ${error.message}`
      );
    }
  }
}

/**
 * Assert that an error message contains a specific substring
 *
 * @param error - The error to check
 * @param expectedSubstring - Expected substring in error message
 * @throws Error if error message doesn't contain substring
 */
export function expectErrorMessage(
  error: unknown,
  expectedSubstring: string
): void {
  if (!(error instanceof Error)) {
    throw new Error(`Expected Error instance, got ${typeof error}`);
  }

  if (!error.message.includes(expectedSubstring)) {
    throw new Error(
      `Expected error message to contain "${expectedSubstring}", got: "${error.message}"`
    );
  }
}

/**
 * Sleep for specified milliseconds
 * Useful for timing-dependent tests
 *
 * @param ms - Milliseconds to sleep
 */
export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Note: createUniqueSlug is exported from factories.ts
// Re-export it here for convenience
export { createUniqueSlug } from './factories';
