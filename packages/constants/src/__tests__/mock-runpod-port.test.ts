/**
 * SERVICE_PORTS.MOCK_RUNPOD vs the CI files that dispatch to it
 *
 * `RUNPOD_DIRECT_URL` has to carry a literal port in five places that cannot
 * import TypeScript — two workflow env blocks, an e2e-debug block, and two
 * shell generators. A literal that drifts from the constant does not fail
 * loudly: TranscodingService would post to a dead port, `triggerJob()` would
 * throw `RunPodApiError`, and the log line reads `RunPod API error` — which
 * looks like a third-party outage, not a config bug. That exact confusion
 * cost the 2026-09-02 production deploy (CI run 33667762392).
 *
 * So the number is FORBIDDEN from being stated independently: this test
 * derives the only legal value and rejects every other spelling.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SERVICE_PORTS } from '../urls.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

/** Must match `MOCK_RUNPOD_URL` in e2e/helpers/mock-runpod.ts. */
const EXPECTED_URL = `http://127.0.0.1:${SERVICE_PORTS.MOCK_RUNPOD}/run`;

/** Every file that names a RunPod dispatch URL for a non-production run. */
const CI_FILES = [
  '.github/workflows/testing.yml',
  '.github/workflows/e2e-api-fast.yml',
  '.github/workflows/e2e-debug.yml',
  '.github/scripts/generate-dev-vars.sh',
  '.github/scripts/generate-worker-dev-vars.sh',
];

/** Pulls every RUNPOD_*_URL assignment, in YAML or shell spelling. */
function runpodUrlAssignments(source: string): string[] {
  const found: string[] = [];
  for (const line of source.split('\n')) {
    // Skip comments — a URL quoted in prose is documentation, not config.
    const bare = line.trim();
    if (bare.startsWith('#')) continue;
    const match = bare.match(/^(RUNPOD_[A-Z_]*URL)\s*[:=]\s*(.+)$/);
    if (!match) continue;
    // Shell default expansion: RUNPOD_DIRECT_URL=${RUNPOD_DIRECT_URL:-<url>}
    const value = match[2].replace(/^\$\{[A-Z_]+:-/, '').replace(/\}$/, '');
    found.push(`${match[1]}=${value.trim()}`);
  }
  return found;
}

describe('SERVICE_PORTS.MOCK_RUNPOD', () => {
  it('is not a port any worker already serves', () => {
    const { MOCK_RUNPOD, ...workers } = SERVICE_PORTS;
    expect(Object.values(workers)).not.toContain(MOCK_RUNPOD);
  });

  it.each(CI_FILES)('%s dispatches only to the derived stub URL', (file) => {
    const assignments = runpodUrlAssignments(
      readFileSync(join(REPO_ROOT, file), 'utf-8')
    );

    // Calibration: a file that stopped naming a RunPod URL would pass every
    // assertion below vacuously. Fail instead, so a rename is visible here.
    expect(
      assignments.length,
      `${file} names no RUNPOD_*_URL — did the variable get renamed?`
    ).toBeGreaterThan(0);

    for (const assignment of assignments) {
      // DIRECT is used verbatim; RUNPOD_API_URL gets `/<endpointId>/run`
      // appended and so can never address the stub.
      expect(
        assignment.startsWith('RUNPOD_DIRECT_URL='),
        `${file}: use RUNPOD_DIRECT_URL — RUNPOD_API_URL is a BASE url, so it gets /<endpointId>/run appended and cannot address the stub. Found: ${assignment}`
      ).toBe(true);
      expect(assignment).toBe(`RUNPOD_DIRECT_URL=${EXPECTED_URL}`);
    }
  });

  it('never routes the stub back through media-api itself', () => {
    for (const file of CI_FILES) {
      const source = readFileSync(join(REPO_ROOT, file), 'utf-8');
      for (const assignment of runpodUrlAssignments(source)) {
        // A dispatch to media-api's own port re-enters the dev server that is
        // serving the request, and wrangler answers a reload-time request with
        // 503 "Your worker restarted mid-request".
        expect(
          assignment,
          `${file}: dispatching to media-api's own port ${SERVICE_PORTS.MEDIA} is the 2026-09-02 flake`
        ).not.toContain(`:${SERVICE_PORTS.MEDIA}`);
      }
    }
  });
});
