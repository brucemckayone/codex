/**
 * Journey preview wiring tests (Codex-2pryk.3.3 · WP-5).
 *
 * Proves the seam forwards to the sender with the frozen protocol's arguments:
 * `registerFrame` passes the frame element + its explicit origin (never '*'),
 * and `pushSnapshot` forwards the page draft to `send`.
 */

import type { PageBuilderState } from '@codex/shared-types';
import { describe, expect, it, vi } from 'vitest';
import type { PagePreviewSender } from '$lib/page-builder';
import type { JourneyPreviewFrameLoad } from './journey-preview-canvas';
import { createJourneyPreviewWiring } from './preview-wiring';

function makeSender() {
  return {
    register: vi.fn(),
    send: vi.fn(),
    destroy: vi.fn(),
  } satisfies PagePreviewSender;
}

const PAGE: PageBuilderState = {
  pageType: 'course',
  slug: 'stillness',
  title: 'Stillness',
  status: 'draft',
  subjectType: 'course',
  subjectId: null,
  brandOverrides: null,
  sections: [],
};

describe('createJourneyPreviewWiring', () => {
  it('registerFrame passes the element + explicit origin to the sender', () => {
    const sender = makeSender();
    const wiring = createJourneyPreviewWiring(sender);
    const element = {} as HTMLIFrameElement;
    const detail: JourneyPreviewFrameLoad = {
      window: {} as Window,
      element,
      origin: 'https://acme.example',
      theme: 'light',
    };

    wiring.registerFrame(detail);

    expect(sender.register).toHaveBeenCalledWith(
      element,
      'https://acme.example'
    );
    expect(sender.register).not.toHaveBeenCalledWith(element, '*');
  });

  it('pushSnapshot forwards the page draft to send', () => {
    const sender = makeSender();
    const wiring = createJourneyPreviewWiring(sender);

    wiring.pushSnapshot(PAGE);

    expect(sender.send).toHaveBeenCalledWith(PAGE);
  });
});
