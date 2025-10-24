/**
 * Shared test helpers
 */

/**
 * Wait for a condition to be true
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
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createMockFn<T extends (...args: any[]) => any>() {
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
