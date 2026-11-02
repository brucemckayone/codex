import { describe, expect, it } from 'vitest';
import { credentialFigure } from './credential-figure';

describe('credentialFigure — a credential that leads with a figure', () => {
  it.each([
    ['20 years teaching', '20', 'years teaching'],
    ['4,000+ students', '4,000+', 'students'],
    ['98% finish the course', '98%', 'finish the course'],
    ['3 books', '3', 'books'],
    ['£12 a class', '£12', 'a class'],
    ['4.9 average rating', '4.9', 'average rating'],
    ['1,250,000 minutes practised', '1,250,000', 'minutes practised'],
  ])('"%s" leads with %s', (text, figure, words) => {
    expect(credentialFigure(text)).toEqual({ figure, words });
  });

  it.each([
    ['2019 Yoga Alliance graduate', 'a year'],
    ['1900 founding members', 'the first year it counts'],
    ['2099 is far off', 'the last year it counts'],
    ['500', 'a number alone'],
    ['1st in her class', 'letters on the number'],
    ['Trained in Kyoto', 'no figure'],
    ['Over 4,000 students', 'a figure later on'],
    ['~20 years', 'a sign the figure does not take'],
    ['20 – 30 classes a week', 'no words straight after it'],
    ['4,00 students', 'commas out of threes'],
    ['007 missions', 'a code'],
  ])('"%s" stays as words: %s', (text) => {
    expect(credentialFigure(text)).toBeNull();
  });

  it('reads a year-like number as a figure once it carries a sign or a comma', () => {
    expect(credentialFigure('2,019 students')?.figure).toBe('2,019');
    expect(credentialFigure('1999+ students')?.figure).toBe('1999+');
    expect(credentialFigure('£2000 raised')?.figure).toBe('£2000');
    // Outside 1900 to 2099, four digits are a count.
    expect(credentialFigure('2100 students')?.figure).toBe('2100');
  });
});
