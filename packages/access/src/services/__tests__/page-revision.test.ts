/**
 * The page revision (Codex-61zsk.18): a digest of exactly what a page save
 * writes. Two reads of one row must agree whatever order the driver returns
 * `jsonb` keys in, and any change to a saved column must move it.
 */
import { describe, expect, it } from 'vitest';
import { pageRevision, type RevisionedPage } from '../page-revision';

const PAGE: RevisionedPage = {
  slug: 'bone-deep',
  title: 'Bone Deep',
  status: 'draft',
  brandOverrides: { primary: '#123456', radius: 4 },
  sections: [
    { id: 'sec-1', type: 'hero', enabled: true, props: { heading: 'Hi' } },
  ],
  design: { style: 'quiet', scheme: 'light' },
  seo: { title: '', description: '' },
};

describe('pageRevision', () => {
  it('is 128 bits in hex', async () => {
    expect(await pageRevision(PAGE)).toMatch(/^[0-9a-f]{32}$/);
  });

  it('does not depend on the order an object’s keys come back in', async () => {
    const reordered: RevisionedPage = {
      seo: { description: '', title: '' },
      design: { scheme: 'light', style: 'quiet' },
      sections: [
        { props: { heading: 'Hi' }, enabled: true, type: 'hero', id: 'sec-1' },
      ],
      brandOverrides: { radius: 4, primary: '#123456' },
      status: 'draft',
      title: 'Bone Deep',
      slug: 'bone-deep',
    };
    expect(await pageRevision(reordered)).toBe(await pageRevision(PAGE));
  });

  it.each([
    ['slug', { slug: 'bone-deeper' }],
    ['title', { title: 'Bone Deeper' }],
    ['status', { status: 'published' }],
    ['brand', { brandOverrides: { primary: '#123457', radius: 4 } }],
    ['a section', { sections: [] }],
    [
      'the order of the sections',
      {
        sections: [...(PAGE.sections as unknown[]), { id: 'sec-2' }].reverse(),
      },
    ],
    ['the look', { design: { style: 'bold', scheme: 'light' } }],
    ['the meta', { seo: { title: 'A title', description: '' } }],
  ] as const)('moves when %s changes', async (_, change) => {
    expect(await pageRevision({ ...PAGE, ...change })).not.toBe(
      await pageRevision(PAGE)
    );
  });

  it('reads an absent bag as empty, as the builder’s read and the save’s do', async () => {
    const bare = { ...PAGE, brandOverrides: null, design: null, seo: null };
    expect(
      await pageRevision({
        ...bare,
        brandOverrides: undefined,
        design: undefined,
        seo: undefined,
      })
    ).toBe(await pageRevision(bare));
    expect(await pageRevision({ ...PAGE, sections: null })).toBe(
      await pageRevision({ ...PAGE, sections: [] })
    );
  });
});
