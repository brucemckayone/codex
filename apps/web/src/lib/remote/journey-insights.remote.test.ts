/**
 * Journey insights remote-function tests (Codex-2pryk · Round-D · WP-7).
 *
 * Guards the module's import chain (a broken import here poisons the whole SSR
 * module graph — memory vite_ssr_module_load_cascade) and pins the exported
 * query after the Round-D rewire from the mock to the real content-api call.
 */

import { beforeAll, describe, expect, it } from 'vitest';

describe('remote/journey-insights.remote', () => {
  // Pre-warm dynamic imports (slow on first load).
  beforeAll(async () => {
    await import('./journey-insights.remote');
  }, 30_000);

  it('exports getJourneyInsights query', async () => {
    const { getJourneyInsights } = await import('./journey-insights.remote');
    expect(getJourneyInsights).toBeDefined();
  });
});
