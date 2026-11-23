import { InternalServiceError } from '@codex/service-errors';
import { describe, expect, it } from 'vitest';
import { uncoveredFailedRefundIdsOf } from '../services/covered-refunds';

/**
 * The column's decoder: what the driver's value of the JSON array becomes.
 * drizzle keeps `mapWith`'s decoder off `SQL`'s public type, so it is read
 * through this one field.
 */
const decode = (value: unknown): string[] =>
  (
    uncoveredFailedRefundIdsOf('p_1', 'ch_1') as unknown as {
      decoder: { mapFromDriverValue: (value: unknown) => string[] };
    }
  ).decoder.mapFromDriverValue(value);

/** The defect it throws, with what came back by its type alone. */
function refusal(value: unknown) {
  try {
    decode(value);
  } catch (error) {
    return error;
  }
  throw new Error('it decoded a value it should have refused');
}

describe('uncoveredFailedRefundIdsOf (review r11, r12)', () => {
  it('decodes the array, parsed or as its JSON text, and an empty one', () => {
    expect(decode(['re_1', 're_2'])).toEqual(['re_1', 're_2']);
    expect(decode('["re_1","re_2"]')).toEqual(['re_1', 're_2']);
    expect(decode([])).toEqual([]);
    expect(decode('[]')).toEqual([]);
  });

  it('refuses text that is not JSON as the typed defect, never a raw SyntaxError', () => {
    const error = refusal('not json');

    expect(error).toBeInstanceOf(InternalServiceError);
    expect((error as InternalServiceError).context).toEqual({
      received: 'string',
    });
    expect((error as InternalServiceError).cause).toBeInstanceOf(SyntaxError);
  });

  it('refuses anything that is not a list of ids, never an empty set', () => {
    for (const [value, received] of [
      [{ re_1: true }, 'object'],
      ['{"re_1":true}', 'object'],
      [[1, 2], 'object'],
      [null, 'object'],
      [42, 'number'],
    ] as const) {
      const error = refusal(value);
      expect(error).toBeInstanceOf(InternalServiceError);
      expect((error as InternalServiceError).context).toEqual({ received });
    }
  });
});
