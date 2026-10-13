/**
 * The Button's action picker never writes what the save would refuse
 * (03 X64): every write it makes passes the write boundary's own schema, and
 * a kind it cannot write yet (a link half typed, a section with nowhere to
 * go) writes nothing at all, so a creator's autosave never fails on it.
 */
import { buttonActionSchema, pageSectionSchema } from '@codex/validation';
import { describe, expect, it } from 'vitest';
import { BUTTON_ACTION_IDS } from '$lib/page-builder/kit';
import { actionKinds, chooseAction, linkWrite } from './button-action-choice';

/** The section the save would send with this action, through the server's own schema. */
const saves = (action: unknown) =>
  pageSectionSchema.safeParse({
    id: 'b',
    type: 'button',
    enabled: true,
    props: action === undefined ? {} : { action },
  }).success;

describe('chooseAction', () => {
  const HREFS = [
    '',
    'example.com',
    'http://example.com',
    'https://',
    'https://example.com',
    '  https://example.com/a  ',
    'javascript:alert(1)',
    'https://u:p@example.com',
  ];

  it('writes only what the save accepts, for every kind, with or without a section or an address', () => {
    let writes = 0;
    for (const kind of BUTTON_ACTION_IDS)
      for (const firstTarget of [undefined, 'pricing-1'])
        for (const href of HREFS) {
          const result = chooseAction(kind, { firstTarget, href });
          if (!result.write) continue;
          writes++;
          const where = `${kind} ${firstTarget} ${JSON.stringify(href)}`;
          expect(saves(result.value), where).toBe(true);
          if (result.value !== undefined) {
            expect(
              buttonActionSchema.safeParse(result.value).success,
              where
            ).toBe(true);
          }
        }
    expect(writes).toBeGreaterThan(BUTTON_ACTION_IDS.length);
  });

  it('stores Join as no action at all: the default', () => {
    expect(chooseAction('join', { href: '' })).toEqual({
      write: true,
      value: undefined,
    });
  });

  it('goes to the first other section, and waits when there is none', () => {
    expect(
      chooseAction('section', { firstTarget: 'pricing-1', href: '' })
    ).toEqual({
      write: true,
      value: { kind: 'section', target: 'pricing-1' },
    });
    expect(chooseAction('section', { href: '' })).toEqual({ write: false });
  });

  it('waits for a full https address, and trims the one it writes', () => {
    for (const href of [
      '',
      'example.com',
      'http://example.com',
      'javascript:alert(1)',
    ]) {
      expect(linkWrite(href), href).toEqual({ write: false });
    }
    expect(linkWrite('  https://example.com/a  ')).toEqual({
      write: true,
      value: { kind: 'link', href: 'https://example.com/a' },
    });
  });
});

describe('actionKinds', () => {
  it('offers the preview film only once the journey has one, or the Button already plays it', () => {
    expect(actionKinds(false, undefined)).toEqual(['join', 'section', 'link']);
    expect(actionKinds(true, undefined)).toEqual([
      'join',
      'section',
      'preview',
      'link',
    ]);
    expect(actionKinds(false, 'preview')).toEqual([
      'join',
      'section',
      'preview',
      'link',
    ]);
  });
});
