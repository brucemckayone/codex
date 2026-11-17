import { describe, expect, it } from 'vitest';
// Through the package index, as content-api and the maintenance run import it.
import {
  ERROR_CODES,
  isPublishBlockedReason,
  isTerminalTranscodeFailure,
  MAX_TRANSCODING_ATTEMPTS,
  MEDIA_STATUS,
  NON_RETRYABLE_TRANSCODING_ERROR_CODES,
  PUBLISH_REFUSAL_CODES,
  TRANSCODING_ERROR_CODES,
  transcodingErrorInfo,
} from '../index';

const failed = (transcodingErrorCode: string | null, transcodingAttempts = 1) =>
  isTerminalTranscodeFailure({
    status: MEDIA_STATUS.FAILED,
    transcodingErrorCode,
    transcodingAttempts,
  });

describe('isTerminalTranscodeFailure (Publish when ready, Codex-a6ofh.2.8)', () => {
  it('a code no attempt can cure is terminal on the first attempt', () => {
    expect(failed(TRANSCODING_ERROR_CODES.CORRUPT_INPUT)).toBe(true);
    expect(failed(TRANSCODING_ERROR_CODES.UPLOAD_INCOMPLETE)).toBe(true);
  });

  it('a retryable failure waits until its attempts are spent', () => {
    expect(failed(TRANSCODING_ERROR_CODES.TIMED_OUT, 1)).toBe(false);
    expect(
      failed(TRANSCODING_ERROR_CODES.TIMED_OUT, MAX_TRANSCODING_ATTEMPTS - 1)
    ).toBe(false);
    expect(
      failed(TRANSCODING_ERROR_CODES.TIMED_OUT, MAX_TRANSCODING_ATTEMPTS)
    ).toBe(true);
  });

  // As claimForDispatch reads them: no code, or one this build doesn't know,
  // may still be claimed.
  it('no code, or an unknown one, is retryable', () => {
    expect(failed(null)).toBe(false);
    expect(failed('WRITTEN_BY_A_NEWER_BUILD')).toBe(false);
  });

  it('only a failed row can be terminal', () => {
    expect(
      isTerminalTranscodeFailure({
        status: MEDIA_STATUS.UPLOADED,
        transcodingErrorCode: TRANSCODING_ERROR_CODES.CORRUPT_INPUT,
        transcodingAttempts: MAX_TRANSCODING_ATTEMPTS,
      })
    ).toBe(false);
  });

  it('the non-retryable list is exactly the codes whose policy refuses a retry', () => {
    for (const code of Object.values(TRANSCODING_ERROR_CODES)) {
      expect(NON_RETRYABLE_TRANSCODING_ERROR_CODES.includes(code)).toBe(
        !transcodingErrorInfo(code).retryable
      );
    }
  });
});

describe('isPublishBlockedReason', () => {
  it('takes every publish refusal and a failed file, nothing else', () => {
    for (const code of PUBLISH_REFUSAL_CODES) {
      expect(isPublishBlockedReason(code)).toBe(true);
    }
    expect(isPublishBlockedReason(ERROR_CODES.MEDIA_FAILED)).toBe(true);
    expect(isPublishBlockedReason(ERROR_CODES.INTERNAL_ERROR)).toBe(false);
    expect(isPublishBlockedReason(undefined)).toBe(false);
  });
});
