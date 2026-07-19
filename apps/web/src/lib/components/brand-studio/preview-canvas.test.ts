/**
 * Brand Studio preview-canvas model tests (Codex-cijzb · WP-1.3).
 *
 * The route/device/theme model is pure and framework-free, so it is proved here
 * without mounting anything. These assertions pin the public route paths the
 * canvas embeds (all root-relative — the slug lives in the hostname) and the
 * content-route gating that disables Detail/Player when the org has no content.
 */
import { describe, expect, it } from 'vitest';
import {
  PREVIEW_DEVICES,
  PREVIEW_ROUTES,
  resolvePreviewPath,
} from './preview-canvas';

describe('resolvePreviewPath', () => {
  it('maps landing to the root path', () => {
    expect(resolvePreviewPath('landing')).toBe('/');
  });

  it('maps nav to the root path (shared full-chrome surface)', () => {
    expect(resolvePreviewPath('nav')).toBe('/');
  });

  it('maps grid to /explore', () => {
    expect(resolvePreviewPath('grid')).toBe('/explore');
  });

  it('maps detail to /content/<slug> when a slug is given', () => {
    expect(resolvePreviewPath('detail', 'my-first-video')).toBe(
      '/content/my-first-video'
    );
  });

  it('maps player to the same content path as detail', () => {
    expect(resolvePreviewPath('player', 'my-first-video')).toBe(
      '/content/my-first-video'
    );
  });

  it('URL-encodes the slug segment', () => {
    expect(resolvePreviewPath('detail', 'a b/c')).toBe('/content/a%20b%2Fc');
  });

  it('returns null for content routes without a slug', () => {
    expect(resolvePreviewPath('detail')).toBeNull();
    expect(resolvePreviewPath('player')).toBeNull();
  });

  it('never returns null for content-free routes', () => {
    expect(resolvePreviewPath('landing')).not.toBeNull();
    expect(resolvePreviewPath('grid')).not.toBeNull();
    expect(resolvePreviewPath('nav')).not.toBeNull();
  });
});

describe('preview model constants', () => {
  it('exposes exactly the five route switcher entries', () => {
    expect(PREVIEW_ROUTES.map((r) => r.id)).toEqual([
      'landing',
      'grid',
      'detail',
      'player',
      'nav',
    ]);
  });

  it('marks only detail and player as content-requiring', () => {
    const requiresContent = PREVIEW_ROUTES.filter((r) => r.requiresContent).map(
      (r) => r.id
    );
    expect(requiresContent).toEqual(['detail', 'player']);
  });

  it('exposes the three device presets with a width read-out each', () => {
    expect(PREVIEW_DEVICES.map((d) => d.id)).toEqual([
      'desktop',
      'tablet',
      'mobile',
    ]);
    for (const device of PREVIEW_DEVICES) {
      expect(device.widthLabel.length).toBeGreaterThan(0);
    }
  });
});
