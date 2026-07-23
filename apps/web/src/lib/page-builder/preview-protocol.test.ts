import type { PageBuilderState } from '@codex/shared-types';
import { describe, expect, it } from 'vitest';
import {
  isPagePreviewMessage,
  PAGE_PREVIEW_MESSAGE_TYPE,
  type PagePreviewMessage,
} from './preview-protocol';

const draft: PageBuilderState = {
  pageType: 'course',
  slug: 'rootwork',
  title: 'Rootwork',
  status: 'draft',
  subjectType: 'course',
  subjectId: 'course-1',
  brandOverrides: null,
  sections: [{ id: 's1', type: 'hero', enabled: true, props: {} }],
};

describe('PAGE_PREVIEW_MESSAGE_TYPE', () => {
  it('is the versioned page-preview channel tag', () => {
    expect(PAGE_PREVIEW_MESSAGE_TYPE).toBe('codex:page-preview:v1');
  });
});

describe('isPagePreviewMessage', () => {
  it('accepts a well-formed message', () => {
    const msg: PagePreviewMessage = {
      type: PAGE_PREVIEW_MESSAGE_TYPE,
      page: draft,
    };
    expect(isPagePreviewMessage(msg)).toBe(true);
  });

  it('rejects a wrong / unversioned type tag', () => {
    expect(
      isPagePreviewMessage({ type: 'codex:brand-preview:v1', page: draft })
    ).toBe(false);
    expect(
      isPagePreviewMessage({ type: 'codex:page-preview:v2', page: draft })
    ).toBe(false);
  });

  it('rejects a missing or non-object page payload', () => {
    expect(isPagePreviewMessage({ type: PAGE_PREVIEW_MESSAGE_TYPE })).toBe(
      false
    );
    expect(
      isPagePreviewMessage({ type: PAGE_PREVIEW_MESSAGE_TYPE, page: null })
    ).toBe(false);
    expect(
      isPagePreviewMessage({ type: PAGE_PREVIEW_MESSAGE_TYPE, page: 'nope' })
    ).toBe(false);
  });

  it('rejects non-object / null inbound data', () => {
    expect(isPagePreviewMessage(null)).toBe(false);
    expect(isPagePreviewMessage(undefined)).toBe(false);
    expect(isPagePreviewMessage('codex:page-preview:v1')).toBe(false);
    expect(isPagePreviewMessage(42)).toBe(false);
  });
});
