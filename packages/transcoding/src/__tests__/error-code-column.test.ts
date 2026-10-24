import { TRANSCODING_ERROR_CODE_MAX_LENGTH } from '@codex/constants';
import { mediaItems } from '@codex/database/schema';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

// The schema keeps the length a literal (drizzle-kit can read a stale
// constants export as undefined), so this pins the two together.
describe('media_items.transcoding_error_code', () => {
  it('is sized by TRANSCODING_ERROR_CODE_MAX_LENGTH', () => {
    const column = getTableConfig(mediaItems).columns.find(
      (c) => c.name === 'transcoding_error_code'
    );

    expect(column?.getSQLType()).toBe(
      `varchar(${TRANSCODING_ERROR_CODE_MAX_LENGTH})`
    );
  });
});
