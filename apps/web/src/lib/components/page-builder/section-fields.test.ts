/**
 * Section-fields model tests (Codex-2pryk.3.3 · WP-5).
 *
 * Guards the editor↔renderer contract: every catalogue section type has a field
 * set, each field names a `PageSection.props` key + a valid control, and an
 * unknown type degrades to the generic body field rather than throwing.
 */
import { describe, expect, it } from 'vitest';
import { SECTION_CATALOG } from '$lib/page-builder';
import { fieldsForSectionType, SECTION_FIELDS } from './section-fields';

describe('section-fields', () => {
  it('declares a field set for every catalogue section type', () => {
    for (const def of SECTION_CATALOG) {
      const fields = SECTION_FIELDS[def.type];
      expect(fields, `missing fields for ${def.type}`).toBeDefined();
      expect(fields.length).toBeGreaterThan(0);
    }
  });

  it('every field names a prop key and a supported control', () => {
    for (const fields of Object.values(SECTION_FIELDS)) {
      for (const field of fields) {
        expect(field.key).toMatch(/^[a-zA-Z][a-zA-Z0-9]*$/);
        expect(['text', 'textarea', 'select', 'media']).toContain(
          field.control
        );
        // A select must carry choices; nothing else should.
        if (field.control === 'select') {
          expect(field.options?.length ?? 0).toBeGreaterThan(0);
        } else {
          expect(field.options).toBeUndefined();
        }
      }
    }
  });

  it('falls back to a generic body field for an unknown type', () => {
    const fields = fieldsForSectionType('retreat-only-widget');
    expect(fields).toHaveLength(1);
    expect(fields[0].key).toBe('body');
  });
});
