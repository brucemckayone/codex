import { describe, expect, it } from 'vitest';
import {
  getConstraintName,
  isUniqueViolation,
  isUniqueViolationOf,
} from '../db-errors';

/** A Postgres error as the driver throws it. */
function postgresError(code: string, constraint?: string): Error {
  return Object.assign(new Error('duplicate key value'), { code, constraint });
}

describe('getConstraintName', () => {
  it('reads the constraint off a Postgres error', () => {
    expect(
      getConstraintName(
        postgresError('23505', 'idx_unique_content_slug_per_org')
      )
    ).toBe('idx_unique_content_slug_per_org');
  });

  it('reads it through the error Drizzle wraps it in, as isUniqueViolation does', () => {
    const wrapped = Object.assign(new Error('Failed query: update "content"'), {
      cause: postgresError('23505', 'idx_unique_content_slug_personal'),
    });
    expect(isUniqueViolation(wrapped)).toBe(true);
    expect(getConstraintName(wrapped)).toBe('idx_unique_content_slug_personal');
  });

  it('reads the cause when the outer error has a code but no constraint', () => {
    const wrapped = Object.assign(postgresError('23505'), {
      cause: postgresError('23505', 'idx_unique_content_slug_per_org'),
    });
    expect(getConstraintName(wrapped)).toBe('idx_unique_content_slug_per_org');
  });

  it('is null for anything else', () => {
    expect(getConstraintName(new Error('boom'))).toBeNull();
    expect(getConstraintName(postgresError('23505'))).toBeNull();
    expect(getConstraintName(undefined)).toBeNull();
  });
});

describe('isUniqueViolationOf', () => {
  const SLUGS = new Set(['idx_unique_content_slug_per_org']);

  it('is a clash on one of the named indexes, wrapped or not', () => {
    const clash = postgresError('23505', 'idx_unique_content_slug_per_org');
    expect(isUniqueViolationOf(clash, SLUGS)).toBe(true);
    expect(
      isUniqueViolationOf(
        Object.assign(new Error('Failed query'), { cause: clash }),
        SLUGS
      )
    ).toBe(true);
  });

  it('is not a clash on another unique index, or one it cannot name', () => {
    expect(
      isUniqueViolationOf(postgresError('23505', 'content_pkey'), SLUGS)
    ).toBe(false);
    expect(isUniqueViolationOf(postgresError('23505'), SLUGS)).toBe(false);
  });

  it('is not another kind of violation on a named index', () => {
    expect(
      isUniqueViolationOf(
        postgresError('23503', 'idx_unique_content_slug_per_org'),
        SLUGS
      )
    ).toBe(false);
  });
});
