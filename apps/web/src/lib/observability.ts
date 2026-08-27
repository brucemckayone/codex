import { type LogEvent, ObservabilityClient } from '@codex/observability';
import { browser, dev } from '$app/environment';

/**
 * Web-app logger.
 *
 * `ObservabilityClient.log()` writes every record with `console.debug/info/warn/
 * error`, and outside `development` what it writes is `JSON.stringify(logEntry)`
 * — the whole structured record, metadata included.
 *
 * In a **worker** that is exactly right: `console.*` IS the log sink, and the
 * structured line is what the aggregator ingests.
 *
 * In a **browser** `console.*` is the end user's devtools. This single `logger`
 * is imported by both server modules (`hooks.server.ts`, every
 * `+page.server.ts`, `$lib/server/*`, `$lib/remote/*`) and client modules
 * (studio pages, `ErrorBoundary.svelte`, and the TanStack DB collections in
 * `$lib/collections/*`), so the axis that decides whether `console` is a
 * private sink or the most public one available is **browser vs server** — not
 * dev vs prod. The `environment` constructor argument cannot express that,
 * which is the whole reason this subclass exists.
 *
 * Call sites already depend on this being a private sink. See
 * `routes/_org/[slug]/studio/monetisation/+page.svelte`, which keeps the raw
 * Stripe error out of the DOM because it can carry an `acct_…` id or an email,
 * and routes it instead "to the logger (which redacts)". Redaction is not the
 * same as "safe to show the end user" — an `organizationId` survives redaction
 * by design, and `ErrorBoundary.svelte` logs `error.stack` — so in the browser
 * that record must not be printed either.
 *
 * Resulting behaviour:
 * - server, any environment — unchanged: `super.log()` → `console.*`.
 * - browser + dev — unchanged: `super.log()` → colorized dev output, which is
 *   what a developer looking at their own devtools wants.
 * - browser + production — not printed. See the sink seam below.
 *
 * Redaction is untouched: it runs inside `super.log()` and still applies to
 * every record that is emitted.
 */
class WebObservabilityClient extends ObservabilityClient {
  override log(event: LogEvent): void {
    if (browser && !dev) {
      // ── CLIENT SINK SEAM ─────────────────────────────────────────────────
      // Nothing is emitted here yet, deliberately. This repo has no
      // client→server diagnostic channel to route to: no Sentry, no `/api/log`,
      // no `reportError` remote function (`routes/api/progress-beacon` is
      // progress sync, not error reporting). Standing one up is a separate
      // piece of work, not part of closing the console leak.
      //
      // This branch is the single place such a sink attaches. When one exists,
      // forward `event` from here: it arrives already shaped as
      // `{ level, message, timestamp, metadata }`, and `redactSensitiveData`
      // (exported by `@codex/observability`) should be applied to
      // `event.metadata` before anything leaves the browser, because
      // `super.log()`'s own redaction pass is being bypassed on this path.
      //
      // Do NOT satisfy "it should go somewhere" by restoring `console` output
      // here — printing to the user's devtools is precisely the defect this
      // class exists to prevent.
      return;
    }

    super.log(event);
  }
}

export const logger = new WebObservabilityClient(
  'web-app',
  dev ? 'development' : 'production'
);
