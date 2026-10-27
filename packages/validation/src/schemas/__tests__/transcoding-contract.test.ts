/**
 * The transcoding handler's webhook bodies, parsed with the schemas the
 * service uses (Codex-l2c48.8).
 *
 * infrastructure/runpod/tests/fixtures/contract/*.json is what the Python
 * handler POSTs; its own test (tests/unit/test_contract_fixtures.py) fails when
 * the handler drifts from them. A body this side would refuse fails here, so
 * neither side can change the contract alone.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { toJobErrorCode } from '@codex/constants';
import { describe, expect, it } from 'vitest';
import { readStillFolderName } from '../../image';
import { runpodWebhookUnionSchema } from '../transcoding';

const FIXTURES = new URL(
  '../../../../../infrastructure/runpod/tests/fixtures/contract/',
  import.meta.url
);

const NAMES = [
  'completed-audio',
  'completed-video-flat',
  'completed-video-sized',
  'failed-corrupt-input',
  'failed-no-media-id',
  'progress',
] as const;

/** A completed fixture's output, as the service parses it. */
function completedOutput(name: (typeof NAMES)[number]) {
  const body = parse(name);
  if (body.status !== 'completed' || !body.output) {
    throw new Error(`${name} is not a completed report with an output`);
  }
  return body.output;
}

/** The fixture as the handler sent it, before the schema strips anything. */
function raw(name: (typeof NAMES)[number]): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(`${name}.json`, FIXTURES), 'utf8'));
}

function parse(name: (typeof NAMES)[number]) {
  const body: unknown = JSON.parse(
    readFileSync(new URL(`${name}.json`, FIXTURES), 'utf8')
  );
  return runpodWebhookUnionSchema.parse(body);
}

describe('transcoding handler contract fixtures', () => {
  it('lists every fixture the handler writes', () => {
    const files = readdirSync(FIXTURES)
      .filter((file) => file.endsWith('.json'))
      .map((file) => file.replace(/\.json$/, ''))
      .sort();
    expect(files).toEqual([...NAMES].sort());
  });

  it.each(NAMES)('%s parses', (name) => {
    expect(() => parse(name)).not.toThrow();
  });

  it('names a sized poster folder by the picture as shown, with all four sizes', () => {
    const output = completedOutput('completed-video-sized');
    const key = output.thumbnailKey ?? '';
    const folder = key.slice(0, key.lastIndexOf('/'));
    const size = readStillFolderName(folder.slice(folder.lastIndexOf('/') + 1));
    expect(size).toEqual({ width: output.width, height: output.height });
    // Read off the raw body: the schema strips a key it doesn't know, so a
    // size added in Python would pass a check of the parsed one.
    const sent = raw('completed-video-sized').output as {
      thumbnailVariants: Record<string, string>;
    };
    expect(Object.keys(sent.thumbnailVariants).sort()).toEqual([
      'lg',
      'md',
      'sm',
      'xl',
    ]);
  });

  it('keeps the flat layout without the sized folder or xl', () => {
    const output = completedOutput('completed-video-flat');
    expect(output.thumbnailVariants?.xl).toBeUndefined();
    expect(output.thumbnailKey).toMatch(/\/media-thumbnails\/[^/]+\/lg\.webp$/);
  });

  it.each([
    'failed-corrupt-input',
    'failed-no-media-id',
  ] as const)('%s carries a code the service keeps', (name) => {
    const body = parse(name);
    if (body.status !== 'failed') throw new Error(body.status);
    expect(toJobErrorCode(body.errorCode)).toBe(body.errorCode);
  });
});
