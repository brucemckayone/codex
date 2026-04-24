import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  createRawSnippet,
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import ErrorBoundary from './ErrorBoundary.svelte';
import ErrorBoundaryHarness from './ErrorBoundaryHarness.test.svelte';
import ErrorTrigger from './ErrorTrigger.svelte';

/**
 * ErrorBoundary component unit tests.
 *
 * ErrorBoundary uses Svelte 5's <svelte:boundary> to catch errors in child
 * components. Interactive error paths (custom fallback, onerror/onreset
 * callbacks) are verified via ErrorBoundaryHarness which wraps the boundary
 * around ErrorTrigger — ErrorTrigger throws synchronously during render when
 * shouldError is true, which is exactly what boundaries are designed to catch.
 */

describe('ErrorBoundary', () => {
  let component: ReturnType<typeof mount> | null = null;

  const originalConsoleError = console.error;
  beforeEach(() => {
    console.error = vi.fn();
  });

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
    console.error = originalConsoleError;
  });

  test('renders children when no error occurs', () => {
    component = mount(ErrorBoundaryHarness, {
      target: document.body,
      props: { shouldError: false },
    });

    flushSync();

    expect(document.querySelector('[data-testid="normal-child"]')).toBeTruthy();
    expect(document.body.textContent).toContain('Normal child content');
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  test('catches thrown error and renders default fallback', () => {
    component = mount(ErrorBoundaryHarness, {
      target: document.body,
      props: { shouldError: true, message: 'Boom' },
    });

    flushSync();

    const alert = document.querySelector('[role="alert"]');
    expect(alert).toBeTruthy();
    expect(alert?.textContent).toContain('Something went wrong');
    expect(alert?.textContent).toContain('Try again');
    expect(document.querySelector('[data-testid="normal-child"]')).toBeNull();
  });

  test('invokes onerror with the thrown Error and a reset function', () => {
    const onerror = vi.fn();
    component = mount(ErrorBoundaryHarness, {
      target: document.body,
      props: { shouldError: true, message: 'Kaboom', onerror },
    });

    flushSync();

    expect(onerror).toHaveBeenCalledTimes(1);
    const [error, reset] = onerror.mock.calls[0];
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Kaboom');
    expect(typeof reset).toBe('function');
  });

  test('invokes onreset when Try again button is clicked', () => {
    const onreset = vi.fn();
    component = mount(ErrorBoundaryHarness, {
      target: document.body,
      props: { shouldError: true, onreset },
    });

    flushSync();

    const tryAgain = document.querySelector<HTMLButtonElement>(
      '[role="alert"] button'
    );
    expect(tryAgain).toBeTruthy();
    expect(tryAgain?.textContent).toContain('Try again');

    tryAgain?.click();
    flushSync();

    expect(onreset).toHaveBeenCalledTimes(1);
  });

  test('renders custom fallback snippet when provided on error', () => {
    const fallback = createRawSnippet<[Error, () => void]>(() => ({
      render: () => '<div data-testid="custom-fallback">Custom error UI</div>',
    }));

    component = mount(ErrorBoundaryHarness, {
      target: document.body,
      props: { shouldError: true, fallback },
    });

    flushSync();

    expect(
      document.querySelector('[data-testid="custom-fallback"]')
    ).toBeTruthy();
    // Default fallback must NOT render when a custom one is provided
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  test('does not render fallback when children render successfully', () => {
    const fallback = createRawSnippet<[Error, () => void]>(() => ({
      render: () => '<div data-testid="custom-fallback">Custom error UI</div>',
    }));

    component = mount(ErrorBoundaryHarness, {
      target: document.body,
      props: { shouldError: false, fallback },
    });

    flushSync();

    expect(
      document.querySelector('[data-testid="custom-fallback"]')
    ).toBeNull();
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  test('renders children directly when mounted without any error path', () => {
    const children = createRawSnippet(() => ({
      render: () => '<div data-testid="direct-child">Direct content</div>',
    }));

    component = mount(ErrorBoundary, {
      target: document.body,
      props: { children },
    });

    expect(document.querySelector('[data-testid="direct-child"]')).toBeTruthy();
  });
});

describe('ErrorTrigger', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('renders normally when shouldError is false', () => {
    component = mount(ErrorTrigger, {
      target: document.body,
      props: { shouldError: false },
    });

    expect(document.body.textContent).toContain(
      'This component renders successfully'
    );
  });

  test('defaults to shouldError false', () => {
    component = mount(ErrorTrigger, {
      target: document.body,
      props: {},
    });

    expect(document.body.textContent).toContain(
      'This component renders successfully'
    );
  });

  test('throws error when shouldError is true', () => {
    expect(() => {
      component = mount(ErrorTrigger, {
        target: document.body,
        props: {
          shouldError: true,
          message: 'Intentional test error',
        },
      });
    }).toThrow('Intentional test error');
  });

  test('throws default error message when shouldError is true', () => {
    expect(() => {
      component = mount(ErrorTrigger, {
        target: document.body,
        props: { shouldError: true },
      });
    }).toThrow('Component error!');
  });
});

describe('ErrorBoundary integration', () => {
  test('both components can be imported together', () => {
    expect(ErrorBoundary).toBeDefined();
    expect(ErrorTrigger).toBeDefined();
  });
});
