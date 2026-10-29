import { describe, expect, it } from 'vitest';
import { editableRows, kindOf, oneLine, retyped } from './included-field';

describe('oneLine — a line is one line', () => {
  it('turns any break, and the spaces round it, into one space', () => {
    expect(oneLine('Printable\nworkbook')).toBe('Printable workbook');
    expect(oneLine('A  \r\n\n  b')).toBe('A b');
  });

  it('leaves a line without breaks as typed, its own spaces too', () => {
    expect(oneLine('6 stages ')).toBe('6 stages ');
    expect(oneLine('Two  spaces')).toBe('Two  spaces');
  });
});

describe('included-field — the rows as the inspector edits them', () => {
  it('reads nothing stored as null: the page draws the course’s own lines', () => {
    expect(editableRows(undefined)).toBeNull();
    expect(editableRows('6 stages')).toBeNull();
    expect(editableRows([])).toEqual([]);
  });

  it('keeps a line still being written, which the block skips', () => {
    expect(editableRows([{ text: '' }, { fact: 'stages', text: '' }])).toEqual([
      { text: '' },
      { fact: 'stages', text: '' },
    ]);
  });

  it('drops what is not a row, and a fact it does not know', () => {
    expect(
      editableRows([
        'x',
        null,
        {},
        { fact: 'downloads' },
        { fact: 'downloads', text: 'Workbook' },
        { fact: 'mix', text: 7 },
      ])
    ).toEqual([{ text: 'Workbook' }, { fact: 'mix' }]);
  });

  it('tags each row by where its words come from', () => {
    expect(kindOf({ fact: 'stages' })).toBe('live');
    expect(kindOf({ fact: 'stages', text: 'Six stages' })).toBe('rewritten');
    expect(kindOf({ fact: 'stages', text: '' })).toBe('rewritten');
    expect(kindOf({ text: 'Printable workbook' })).toBe('own');
  });

  it('makes a typed-into fact the creator’s words, and the course’s line typed back live again', () => {
    expect(retyped({ fact: 'stages' }, 'Six stages', '6 stages')).toEqual({
      fact: 'stages',
      text: 'Six stages',
    });
    expect(
      retyped({ fact: 'stages', text: 'Six stages' }, '6 stages', '6 stages')
    ).toEqual({ fact: 'stages' });
    // Cleared to retype: still the creator's, so the row keeps its place.
    expect(retyped({ fact: 'stages' }, '', '6 stages')).toEqual({
      fact: 'stages',
      text: '',
    });
  });

  it('keeps the creator’s own line theirs, whatever it says', () => {
    expect(retyped({ text: '' }, '6 stages', null)).toEqual({
      text: '6 stages',
    });
  });
});
