/**
 * StepPayouts component tests (Codex-et1tx).
 *
 * Locks the become-creator payouts redirect contract: after a successful
 * `connectMeOnboard`, the wizard must navigate the browser to the Stripe-hosted
 * onboarding URL returned as `onboardingUrl`.
 *
 * Regression guard: the shipped bug read `result.url` (undefined) instead of
 * `result.onboardingUrl`, sending the creator to `/undefined` (404). The
 * remote command() boundary widens the return type, so `.url` did NOT fail
 * tsc — only a runtime assertion like this can catch a reintroduction.
 *
 * window.location.href is stubbed via a Proxy (mirrors SubscribeButton's
 * "Update payment" test) so the assertion runs without jsdom actually
 * navigating away and polluting sibling tests.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  type Mock,
  test,
  vi,
} from 'vitest';
import {
  mount,
  screen,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

vi.mock('$lib/remote/subscription.remote', () => ({
  connectMeOnboard: vi.fn(),
}));

import { connectMeOnboard } from '$lib/remote/subscription.remote';
import StepPayouts from './StepPayouts.svelte';

const mockOnboard = connectMeOnboard as unknown as ReturnType<typeof vi.fn>;

function baseProps() {
  return {
    payoutsEnabled: false,
    connectReturnBanner: null,
    onContinue: vi.fn(),
    onSkip: vi.fn(),
    onBack: vi.fn(),
  };
}

describe('StepPayouts — connect redirect', () => {
  let component: ReturnType<typeof mount> | null = null;
  let originalLocation: Location;
  let hrefSetter: Mock<(value: string) => void>;

  beforeEach(() => {
    mockOnboard.mockReset();

    // Intercept assignment to window.location.href without navigating.
    originalLocation = window.location;
    hrefSetter = vi.fn<(value: string) => void>();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: new Proxy(originalLocation, {
        set(target, prop, value) {
          if (prop === 'href') {
            hrefSetter(value);
            return true;
          }
          return Reflect.set(target, prop, value);
        },
        get(target, prop) {
          return Reflect.get(target, prop);
        },
      }),
    });
  });

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
    document.body.innerHTML = '';
  });

  test('successful onboard navigates to the returned onboardingUrl (not /undefined)', async () => {
    const onboardingUrl =
      'https://connect.stripe.com/setup/e/acct_1TrE829Rq1gYsipU/abc123';
    mockOnboard.mockResolvedValueOnce({
      accountId: 'acct_1TrE829Rq1gYsipU',
      onboardingUrl,
    });

    component = mount(StepPayouts, {
      target: document.body,
      props: baseProps(),
    });

    const connect = screen.getByTestId('payouts-connect') as HTMLButtonElement;
    expect(connect).toBeTruthy();
    connect.click();

    // Flush the connect() async flow (await connectMeOnboard → set href).
    await new Promise((r) => setTimeout(r, 0));

    expect(mockOnboard).toHaveBeenCalledTimes(1);
    // The redirect target is the Stripe onboarding URL, verbatim.
    expect(hrefSetter).toHaveBeenCalledWith(onboardingUrl);
    // Explicit regression guard against the `result.url` bug.
    expect(hrefSetter).not.toHaveBeenCalledWith(undefined);
  });

  test('connect() sends wizard return/refresh URLs back to the payouts step', async () => {
    mockOnboard.mockResolvedValueOnce({
      accountId: 'acct_x',
      onboardingUrl: 'https://connect.stripe.com/setup/e/acct_x/y',
    });

    component = mount(StepPayouts, {
      target: document.body,
      props: baseProps(),
    });

    (screen.getByTestId('payouts-connect') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));

    const arg = mockOnboard.mock.calls[0]?.[0] as {
      returnUrl: string;
      refreshUrl: string;
    };
    expect(arg.returnUrl).toContain(
      '/become-creator?step=payouts&connect=success'
    );
    expect(arg.refreshUrl).toContain(
      '/become-creator?step=payouts&connect=refresh'
    );
  });

  test('onboard failure surfaces an error and does NOT navigate', async () => {
    mockOnboard.mockRejectedValueOnce(new Error('boom'));

    component = mount(StepPayouts, {
      target: document.body,
      props: baseProps(),
    });

    (screen.getByTestId('payouts-connect') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));

    // No redirect on failure; an error alert is shown instead.
    expect(hrefSetter).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')).toBeTruthy();
  });
});
