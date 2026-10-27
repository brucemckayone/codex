import { describe, expect, it } from 'vitest';
import { issuePaths, validationErrorFor } from './validation-error';

describe('validationErrorFor', () => {
  it('names the section a page save was refused over, and why', () => {
    expect(
      validationErrorFor([
        {
          message: 'Section props are too large (16KB limit)',
          path: ['sections', 2, 'props'],
        },
      ])
    ).toEqual({
      message: 'Section 3: Section props are too large (16KB limit)',
      code: 'VALIDATION_ERROR',
    });
  });

  it('reads Standard Schema path segments as well as plain keys', () => {
    expect(
      validationErrorFor([
        { message: 'Too long', path: [{ key: 'sections' }, { key: 0 }] },
      ]).message
    ).toBe('Section 1: Too long');
  });

  it('gives the first issue alone, and no path it cannot name', () => {
    expect(
      validationErrorFor([
        { message: 'Slug must be lowercase', path: ['slug'] },
        { message: 'Title is required', path: ['title'] },
      ]).message
    ).toBe('Slug must be lowercase');
  });

  it('falls back to the default when there is no issue to describe', () => {
    expect(validationErrorFor([]).message).toBe('Bad Request');
  });
});

// What a log may say about refused input (Codex-osuqt): the schema's own
// field names and array indices, never a key the caller chose.
describe('issuePaths', () => {
  it('names fields and indices', () => {
    expect(
      issuePaths([
        { message: 'x', path: ['sections', 2, { key: 'title' }] },
        { message: 'x', path: [] },
      ])
    ).toEqual(['sections.2.title', '']);
  });

  it('masks a record key the caller chose, such as an email', () => {
    expect(
      issuePaths([
        {
          message: 'x',
          path: ['brandOverrides', 'tokenOverrides', 'jane@example.com'],
        },
        { message: 'x', path: ['shaderConfig', 'a'.repeat(5000)] },
        { message: 'x', path: [Symbol('s')] },
      ])
    ).toEqual(['brandOverrides.tokenOverrides.*', 'shaderConfig.*', '*']);
  });
});
