import { describe, expect, it } from 'vitest';
import {
  isTranscodingErrorCode,
  TRANSCODING_ERROR_CODE_MAX_LENGTH,
  TRANSCODING_ERROR_CODES,
  toJobErrorCode,
  toTranscodingErrorCode,
  transcodingErrorInfo,
} from '../transcoding';

const codes = Object.values(TRANSCODING_ERROR_CODES);
const codesWhere = (
  predicate: (info: ReturnType<typeof transcodingErrorInfo>) => boolean
) => codes.filter((code) => predicate(transcodingErrorInfo(code))).sort();

describe('TRANSCODING_ERROR_CODES', () => {
  it('has each value equal to its key', () => {
    for (const [key, value] of Object.entries(TRANSCODING_ERROR_CODES)) {
      expect(value).toBe(key);
    }
  });

  it('fits every code in the column', () => {
    for (const code of codes) {
      expect(code.length).toBeLessThanOrEqual(
        TRANSCODING_ERROR_CODE_MAX_LENGTH
      );
    }
  });
});

describe('transcodingErrorInfo', () => {
  it('makes only the transcoder-side dispatch codes wait', () => {
    expect(codesWhere((info) => info.transient)).toEqual([
      'TRANSCODER_BUSY',
      'TRANSCODER_MISCONFIGURED',
      'TRANSCODER_PAUSED',
      'TRANSCODER_UNAVAILABLE',
    ]);
  });

  it('alerts the owner on entry only for a misconfigured transcoder', () => {
    expect(codesWhere((info) => info.alertOwnerOnEntry)).toEqual([
      'TRANSCODER_MISCONFIGURED',
    ]);
  });

  it('never offers a retry that would fail identically', () => {
    expect(codesWhere((info) => !info.retryable)).toEqual([
      'CORRUPT_INPUT',
      'INVALID_DURATION',
      'MISSING_STREAM',
      'UNSUPPORTED_CODEC',
      'UPLOAD_INCOMPLETE',
    ]);
  });

  it('emails about every terminal failure except an abandoned upload', () => {
    expect(codesWhere((info) => !info.notify)).toEqual(['UPLOAD_INCOMPLETE']);
  });

  it('reports the category it decided by', () => {
    expect(transcodingErrorInfo('TRANSCODER_PAUSED').category).toBe('service');
    expect(transcodingErrorInfo('TRANSCODER_MISCONFIGURED').category).toBe(
      'config'
    );
    expect(transcodingErrorInfo('TIMED_OUT').category).toBe('timeout');
  });

  it.each([
    'A_CODE_FROM_A_NEWER_BUILD',
    null,
    undefined,
  ])('gives %p the INFRA_ERROR policy, never undefined flags', (stored) => {
    expect(transcodingErrorInfo(stored)).toEqual(
      transcodingErrorInfo('INFRA_ERROR')
    );
    expect(transcodingErrorInfo(stored)).toEqual({
      category: 'internal',
      transient: false,
      notify: true,
      alertOwnerOnEntry: false,
      retryable: true,
    });
  });
});

describe('toTranscodingErrorCode', () => {
  it('keeps a known code', () => {
    expect(toTranscodingErrorCode('CORRUPT_INPUT')).toBe('CORRUPT_INPUT');
    expect(isTranscodingErrorCode('CORRUPT_INPUT')).toBe(true);
  });

  it.each([
    'SOME_FUTURE_CODE',
    'corrupt_input',
    'toString', // an Object.prototype key is not a code
    '',
    undefined,
    null,
    42,
  ])('maps %p to INFRA_ERROR and says it did not know it', (value) => {
    expect(toTranscodingErrorCode(value)).toBe('INFRA_ERROR');
    expect(isTranscodingErrorCode(value)).toBe(false);
  });
});

describe('toJobErrorCode', () => {
  it.each([
    'CORRUPT_INPUT',
    'UNSUPPORTED_CODEC',
    'INVALID_DURATION',
    'MISSING_STREAM',
    'OUTPUT_VALIDATION_FAILED',
    'INFRA_ERROR',
  ])('believes the job about %s', (code) => {
    expect(toJobErrorCode(code)).toBe(code);
  });

  it.each([
    'TRANSCODER_PAUSED', // would put a failed job back to waiting
    'TRANSCODER_MISCONFIGURED',
    'UPLOAD_INCOMPLETE', // would silence every email
    'TIMED_OUT',
    'WEBHOOK_LOST',
    'OUTPUT_REJECTED',
    'SOME_FUTURE_CODE',
  ])('does not believe the job claiming %s', (code) => {
    expect(toJobErrorCode(code)).toBe('INFRA_ERROR');
  });
});
