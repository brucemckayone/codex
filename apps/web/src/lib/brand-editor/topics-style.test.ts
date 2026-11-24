/**
 * resolveTopicsStyle (Codex-8swlj.2): the only reader of
 * tokenOverrides['topics-style']. The server keeps any value under any key, so
 * the whitelist lives here; and the editor's pending map, when given, is the
 * whole intended state.
 */
import { DEFAULT_TOPICS_STYLE, TOPICS_STYLES } from '@codex/validation';
import { describe, expect, test } from 'vitest';
import { resolveTopicsStyle } from './topics-style';

describe('resolveTopicsStyle', () => {
  test('the default is One bar', () => {
    expect(DEFAULT_TOPICS_STYLE).toBe('bar');
  });

  test.each(TOPICS_STYLES)('a saved %s reads as itself', (style) => {
    expect(resolveTopicsStyle({ 'topics-style': style })).toBe(style);
  });

  test.each([
    ['an unknown style', { 'topics-style': 'grid' }],
    ['a different case', { 'topics-style': 'Windows' }],
    ['a padded value', { 'topics-style': ' windows ' }],
    ['a number', { 'topics-style': 2 }],
    ['a null value', { 'topics-style': null }],
    ['no key', { 'hero-hide-stats': '1' }],
    ['an empty map', {}],
  ])('%s reads as the default', (_, overrides) => {
    expect(resolveTopicsStyle(overrides)).toBe('bar');
  });

  test('no overrides at all reads as the default', () => {
    expect(resolveTopicsStyle(null)).toBe('bar');
    expect(resolveTopicsStyle(undefined)).toBe('bar');
    expect(resolveTopicsStyle(undefined, undefined)).toBe('bar');
  });

  // The layouts type JSON.parse's result as a map; at runtime it can be any
  // JSON value, an array included.
  test('a map that is not a plain object reads as the default', () => {
    const parsed: Record<string, unknown> = JSON.parse('["windows"]');
    parsed['topics-style'] = 'windows';
    expect(resolveTopicsStyle(parsed)).toBe('bar');
  });

  test('the pending map wins over the saved one', () => {
    expect(
      resolveTopicsStyle(
        { 'topics-style': 'windows' },
        { 'topics-style': 'channels' }
      )
    ).toBe('channels');
  });

  // Choosing One bar deletes the key: the preview must show it before saving.
  test('a pending map without the key is One bar, not the saved style', () => {
    expect(resolveTopicsStyle({ 'topics-style': 'windows' }, {})).toBe('bar');
  });

  test('an unknown pending value is the default, not the saved style', () => {
    expect(
      resolveTopicsStyle(
        { 'topics-style': 'channels' },
        { 'topics-style': 'grid' }
      )
    ).toBe('bar');
  });

  test('no pending map (the editor closed) reads the saved one', () => {
    expect(resolveTopicsStyle({ 'topics-style': 'windows' }, null)).toBe(
      'windows'
    );
    expect(resolveTopicsStyle({ 'topics-style': 'windows' }, undefined)).toBe(
      'windows'
    );
  });
});
