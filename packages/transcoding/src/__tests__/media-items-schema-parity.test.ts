import {
  MAX_TRANSCODING_ATTEMPTS,
  TRANSCODING_ERROR_CODE_MAX_LENGTH,
  TRANSCODING_ERROR_MAX_LENGTH,
} from '@codex/constants';
import { mediaItems } from '@codex/database/schema';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

// The schema keeps these values literal: drizzle-kit loads it through a CJS
// shim that reads a stale constants export as undefined. These pin them to
// the constants the services use.
describe('media_items schema parity', () => {
  const table = getTableConfig(mediaItems);

  it.each([
    ['transcoding_error_code', TRANSCODING_ERROR_CODE_MAX_LENGTH],
    ['transcoding_error', TRANSCODING_ERROR_MAX_LENGTH],
  ])('sizes %s by its constant (%i)', (name, length) => {
    const column = table.columns.find((c) => c.name === name);

    expect(column?.getSQLType()).toBe(`varchar(${length})`);
  });

  it('caps transcoding_attempts at MAX_TRANSCODING_ATTEMPTS', () => {
    const check = table.checks.find(
      (c) => c.name === 'check_max_transcoding_attempts'
    );
    const rendered = check ? new PgDialect().sqlToQuery(check.value).sql : '';

    expect(rendered).toContain(`<= ${MAX_TRANSCODING_ATTEMPTS}`);
  });
});
