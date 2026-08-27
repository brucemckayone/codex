/**
 * Codex-1g5lh.24 — structured JSON log records must never reach the browser
 * console in production.
 *
 * `ObservabilityClient.log()` (packages/observability/src/index.ts) ends every
 * record in `console.debug/info/warn/error`, and outside `development` the
 * payload is `JSON.stringify(logEntry)` — the whole record, metadata included.
 * In a worker `console.*` IS the log sink and that is correct. In a browser it
 * is the end user's devtools. `$lib/observability` wraps the client so the
 * deciding axis is browser-vs-server rather than dev-vs-prod.
 *
 * Environment control: `src/tests/mocks.ts` mocks `$app/environment` globally
 * for the whole apps/web suite as `{ browser: true, dev: false }` — i.e. the
 * suite's default IS a production browser. Each test below re-declares the
 * environment explicitly with `vi.doMock` + `vi.resetModules()` so it does not
 * depend on that global or on test ordering. One test asserts the global
 * default separately, because it is what makes the defect reachable at all.
 */

import { ObservabilityClient } from '@codex/observability';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser as globalBrowser, dev as globalDev } from '$app/environment';

type ConsoleMethod = 'debug' | 'info' | 'warn' | 'error' | 'log';
type Spies = Record<ConsoleMethod, ReturnType<typeof vi.spyOn>>;

const SECRET_ORG = 'org_SECRET_ID';
const SECRET_ACCT = 'acct_SECRET_ACCT';

function spyOnConsole(): Spies {
  const methods: ConsoleMethod[] = ['debug', 'info', 'warn', 'error', 'log'];
  return Object.fromEntries(
    methods.map((m) => [m, vi.spyOn(console, m).mockImplementation(() => {})])
  ) as Spies;
}

/** Every string that reached any console method, across all spies. */
function allConsoleOutput(spies: Spies): string {
  return Object.values(spies)
    .flatMap((spy) => spy.mock.calls.map((args) => args.map(String).join(' ')))
    .join('\n');
}

function totalConsoleCalls(spies: Spies): number {
  return Object.values(spies).reduce((n, spy) => n + spy.mock.calls.length, 0);
}

/** Load `$lib/observability` with `$app/environment` forced to `env`. */
async function loadLogger(env: { browser: boolean; dev: boolean }) {
  vi.resetModules();
  vi.doMock('$app/environment', () => ({ ...env, building: false }));
  return (await import('./observability')).logger;
}

type TestLogger = Awaited<ReturnType<typeof loadLogger>>;

/**
 * Exercise every public entry point that funnels into `log()`, so a pass
 * cannot come from one method happening to be gated.
 */
function logThroughEveryEntryPoint(logger: TestLogger) {
  const meta = { organizationId: SECRET_ORG, reason: SECRET_ACCT };

  logger.info('info message', meta);
  logger.warn('warn message', meta);
  logger.error('error message', meta);
  logger.debug('debug message', meta);
  // Over the default 2000ms threshold, so perf() logs at warn (not gated).
  logger.perf('slow-op', 999_999, { metadata: meta });
  logger.trackRequest({
    url: 'https://example.test/x',
    method: 'GET',
    duration: 5,
    status: 500,
  });

  const err = new Error(`${SECRET_ACCT} blew up`);
  err.stack = `Error: ${SECRET_ACCT} blew up\n    at secretFrame (${SECRET_ORG}.js:1:1)`;
  logger.trackError(err, meta);

  logger.startTimer('timed-op').end(meta);

  // The raw funnel every other method delegates to.
  logger.log({
    level: 'error',
    message: 'raw log message',
    timestamp: new Date(),
    metadata: meta,
  });
}

describe('$lib/observability logger', () => {
  let spies: Spies;

  beforeEach(() => {
    spies = spyOnConsole();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('runs its suite in a production browser by default (src/tests/mocks.ts)', () => {
    // Not incidental: this is the environment every apps/web unit test runs in,
    // so any structured record the logger emits here is the defect in miniature.
    expect({ browser: globalBrowser, dev: globalDev }).toEqual({
      browser: true,
      dev: false,
    });
  });

  describe('production browser (the defect)', () => {
    it('emits nothing to any console method, via any entry point', async () => {
      const logger = await loadLogger({ browser: true, dev: false });

      logThroughEveryEntryPoint(logger);

      expect(totalConsoleCalls(spies)).toBe(0);
      expect(allConsoleOutput(spies)).toBe('');
    });

    it('leaks no identifier, stack frame, or JSON envelope as a substring', async () => {
      const logger = await loadLogger({ browser: true, dev: false });

      logThroughEveryEntryPoint(logger);
      const output = allConsoleOutput(spies);

      // The bead's example record carries an organizationId; the monetisation
      // page routes raw Stripe errors (acct_… ids) here; ErrorBoundary.svelte
      // routes error.stack here.
      expect(output).not.toContain(SECRET_ORG);
      expect(output).not.toContain(SECRET_ACCT);
      expect(output).not.toContain('secretFrame');
      expect(output).not.toContain('"service"');
      expect(output).not.toContain('"web-app"');
    });

    it('is not a vacuous test: the unwrapped client DOES leak in this env', async () => {
      // Anchors the assertions above to the real defect. If ObservabilityClient
      // ever stops writing to console, this fails and the suppression tests
      // stop meaning anything — which is exactly when someone should look.
      const unwrapped = new ObservabilityClient('web-app', 'production');

      unwrapped.error('error message', {
        organizationId: SECRET_ORG,
        reason: SECRET_ACCT,
      });

      expect(spies.error).toHaveBeenCalledTimes(1);
      const output = allConsoleOutput(spies);
      expect(output).toContain(SECRET_ORG);
      expect(output).toContain('"service":"web-app"');
    });
  });

  describe('development browser (must be unchanged)', () => {
    it('prints the colorized dev record, not JSON', async () => {
      const logger = await loadLogger({ browser: true, dev: true });

      logger.error('dev error message', { organizationId: 'org_123' });

      expect(spies.error).toHaveBeenCalledTimes(1);
      const output = String(spies.error.mock.calls[0]?.[0]);

      expect(output).toContain('dev error message');
      expect(output).toContain('web-app');
      // formatDevLog output (ANSI), not JSON.stringify output.
      expect(output).toContain('\x1b[');
      expect(output.startsWith('{')).toBe(false);
    });

    it('produces output byte-identical to an unwrapped ObservabilityClient', async () => {
      const message = 'parity check';
      const metadata = { organizationId: 'org_123', status: 500 };

      const wrapped = await loadLogger({ browser: true, dev: true });
      wrapped.error(message, metadata);
      const wrappedOutput = String(spies.error.mock.calls[0]?.[0]);

      spies.error.mockClear();

      // The same constructor arguments the wrapper uses when dev === true.
      new ObservabilityClient('web-app', 'development').error(
        message,
        metadata
      );
      const baseOutput = String(spies.error.mock.calls[0]?.[0]);

      // formatDevLog prefixes a wall-clock time; normalise so the assertion
      // cannot fail on a second boundary.
      const normalise = (s: string) => s.replace(/\d{2}:\d{2}:\d{2}/g, 'TIME');

      expect(normalise(wrappedOutput)).toBe(normalise(baseOutput));
    });

    it('routes each level to its matching console method', async () => {
      const logger = await loadLogger({ browser: true, dev: true });

      logger.debug('d');
      logger.info('i');
      logger.warn('w');
      logger.error('e');

      expect(spies.debug).toHaveBeenCalledTimes(1);
      expect(spies.info).toHaveBeenCalledTimes(1);
      expect(spies.warn).toHaveBeenCalledTimes(1);
      expect(spies.error).toHaveBeenCalledTimes(1);
    });
  });

  describe('server (must be completely unaffected)', () => {
    it('still writes the structured JSON record in production', async () => {
      const logger = await loadLogger({ browser: false, dev: false });

      logger.error('server error message', { organizationId: 'org_123' });

      expect(spies.error).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(String(spies.error.mock.calls[0]?.[0]));

      expect(parsed).toMatchObject({
        level: 'error',
        message: 'server error message',
        service: 'web-app',
        environment: 'production',
      });
      // Metadata survives — the log aggregator needs it.
      expect(parsed.metadata).toMatchObject({ organizationId: 'org_123' });
    });

    it('produces JSON byte-identical to an unwrapped production client', async () => {
      const message = 'server parity check';
      const metadata = { organizationId: 'org_123', status: 500 };

      const wrapped = await loadLogger({ browser: false, dev: false });
      wrapped.error(message, metadata);
      const wrappedOutput = String(spies.error.mock.calls[0]?.[0]);

      spies.error.mockClear();

      new ObservabilityClient('web-app', 'production').error(message, metadata);
      const baseOutput = String(spies.error.mock.calls[0]?.[0]);

      // Only the ISO timestamp differs between the two calls.
      const normalise = (s: string) =>
        s.replace(/"timestamp":"[^"]+"/, '"timestamp":"TIME"');

      expect(normalise(wrappedOutput)).toBe(normalise(baseOutput));
    });

    it('emits through every entry point, unsuppressed', async () => {
      const logger = await loadLogger({ browser: false, dev: false });

      logThroughEveryEntryPoint(logger);

      // debug() and the sub-threshold perf path self-gate outside development,
      // so assert the floor rather than an exact count.
      expect(totalConsoleCalls(spies)).toBeGreaterThanOrEqual(6);
      expect(allConsoleOutput(spies)).toContain(SECRET_ORG);
    });

    it('writes the structured record on the server in dev too', async () => {
      const logger = await loadLogger({ browser: false, dev: true });

      logger.error('server dev message');

      expect(spies.error).toHaveBeenCalledTimes(1);
    });
  });
});
