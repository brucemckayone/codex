/**
 * The quote a switch of billing period's dialog echoes back to change-tier
 * (Codex-2hxff.96): what the preview showed, re-checked before the write.
 */
import { describe, expect, it } from 'vitest';
import { changeTierSchema, tierChangeQuoteSchema } from '../subscription';

const BODY = {
  organizationId: '11111111-1111-4111-8111-111111111111',
  newTierId: '22222222-2222-4222-8222-222222222222',
  billingInterval: 'year' as const,
  prorationDate: 1_796_172_844,
};

describe('tierChangeQuoteSchema', () => {
  it.each([
    'due:8251|lines:-516,8767|next:2027-12-17',
    'due:0|lines:-8767|next:2027-01-17',
    'due:0|lines:|next:2027-01-17',
  ])('takes %s', (quote) => {
    expect(tierChangeQuoteSchema.parse(quote)).toBe(quote);
  });

  it.each([
    ['an empty string', ''],
    ['a figure that is not whole pence', 'due:82.5|lines:-516|next:2027-12-17'],
    ['no next-bill date', 'due:8251|lines:-516,8767'],
    ['a date in another form', 'due:8251|lines:-516|next:17/12/2027'],
    ['anything after the date', 'due:8251|lines:-516|next:2027-12-17|x'],
    ['too long', `due:1|lines:${'1,'.repeat(300)}1|next:2027-12-17`],
  ])('refuses %s', (_, quote) => {
    expect(tierChangeQuoteSchema.safeParse(quote).success).toBe(false);
  });
});

describe('changeTierSchema', () => {
  it('leaves the quote out for every change but a billing switch', () => {
    expect(changeTierSchema.parse(BODY)).toEqual(BODY);
  });

  it('takes the quote a billing switch echoes back', () => {
    const quote = 'due:0|lines:-8767|next:2027-01-17';
    expect(changeTierSchema.parse({ ...BODY, quote })).toEqual({
      ...BODY,
      quote,
    });
  });

  it('refuses a quote in any other form', () => {
    expect(
      changeTierSchema.safeParse({ ...BODY, quote: 'prices are fine' }).success
    ).toBe(false);
  });
});
