/**
 * The focal point control (Codex-61zsk.58, .73): one control for the
 * creator's own upload, whose reference carries its point, and for a course
 * still, whose point the section keeps on this page. An upload behaves as it
 * always has; a still says where its point is saved.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FocalCrop } from '$lib/page-builder/kit';
import { type ImageRef, withFocus } from '$lib/page-builder/page-images';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import FocalPointField from './FocalPointField.svelte';

const CDN = 'https://cdn.test';
const IMAGE: ImageRef = {
  key: 'landing-pages/p1/images/i1',
  alt: 'A lake at dawn',
  w: 1600,
  h: 1067,
};
const STILL = `${CDN}/org-1/media-thumbnails/m-1/lg.webp`;
const CROPS: readonly FocalCrop[] = [
  { at: 'wide', ratio: '7 / 3' },
  { at: 'phone', ratio: '4 / 3' },
];

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
});

function render(props: Record<string, unknown>) {
  const onChange = vi.fn();
  app = mount(FocalPointField, {
    target: document.body,
    props: { crops: CROPS, onChange, ...props },
  });
  flushSync();
  return onChange;
}

const pad = () => document.body.querySelector<HTMLButtonElement>('.focus__pad');
const centre = () =>
  document.body.querySelector<HTMLButtonElement>('.focus__centre');
const press = (key: string, shiftKey = false) => {
  pad()?.dispatchEvent(
    new KeyboardEvent('keydown', { key, shiftKey, bubbles: true })
  );
  flushSync();
};
const readout = () =>
  document.body.querySelector('.focus__readout')?.textContent?.trim();

describe('an upload', () => {
  it('draws its own 400px file, steered by its own point', () => {
    render({ image: { ...IMAGE, focus: { x: 30, y: 60 } }, mediaBaseUrl: CDN });
    expect(pad()?.querySelector('img')?.getAttribute('src')).toBe(
      `${CDN}/${IMAGE.key}/md.webp`
    );
    expect(readout()).toBe(
      m.studio_page_editor_focus_readout({ x: 30, y: 60 })
    );
    const crops = document.body.querySelectorAll<HTMLImageElement>(
      '.focus__crop-picture'
    );
    expect(crops).toHaveLength(2);
    for (const crop of crops) expect(crop.style.objectPosition).toBe('30% 60%');
  });

  it('moves by 2%, and 10% with Shift', () => {
    const onChange = render({ image: IMAGE, mediaBaseUrl: CDN });
    press('ArrowRight');
    expect(onChange).toHaveBeenLastCalledWith({ x: 52, y: 50 });
    press('ArrowUp', true);
    expect(onChange).toHaveBeenLastCalledWith({ x: 50, y: 40 });
  });

  it('writes the whole reference back, its description and size kept', () => {
    expect(withFocus(IMAGE, { x: 52, y: 50 })).toEqual({
      ...IMAGE,
      focus: { x: 52, y: 50 },
    });
    // The centre is never stored.
    expect(withFocus({ ...IMAGE, focus: { x: 52, y: 50 } }, undefined)).toEqual(
      IMAGE
    );
  });

  it('a move back to the centre removes the point', () => {
    const onChange = render({
      image: { ...IMAGE, focus: { x: 48, y: 50 } },
      mediaBaseUrl: CDN,
    });
    press('ArrowRight');
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it('"Use the centre" removes the point, and is pressed already at the centre', () => {
    const onChange = render({
      image: { ...IMAGE, focus: { x: 20, y: 20 } },
      mediaBaseUrl: CDN,
    });
    expect(centre()?.disabled).toBe(false);
    centre()?.click();
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    unmount(app);
    render({ image: IMAGE, mediaBaseUrl: CDN });
    expect(centre()?.disabled).toBe(true);
  });

  it('says nothing about where it is saved: it travels with the picture', () => {
    render({ image: IMAGE, mediaBaseUrl: CDN });
    expect(document.body.textContent).not.toContain(
      m.studio_page_editor_focus_still_saved()
    );
  });

  it('explains itself in a layout that never crops, as before', () => {
    render({ image: IMAGE, mediaBaseUrl: CDN, crops: [] });
    expect(pad()).toBeNull();
    expect(document.body.textContent).toContain(
      m.studio_page_editor_focus_inactive()
    );
  });
});

describe('a course still', () => {
  it('draws the still’s own 400px file, at the point the section keeps', () => {
    render({ still: STILL, focus: { x: 12, y: 8 } });
    expect(pad()?.querySelector('img')?.getAttribute('src')).toBe(
      `${CDN}/org-1/media-thumbnails/m-1/md.webp`
    );
    expect(readout()).toBe(m.studio_page_editor_focus_readout({ x: 12, y: 8 }));
    for (const crop of document.body.querySelectorAll<HTMLImageElement>(
      '.focus__crop-picture'
    ))
      expect(crop.style.objectPosition).toBe('12% 8%');
  });

  it('with no point, reads as the centre', () => {
    render({ still: STILL });
    expect(readout()).toBe(
      m.studio_page_editor_focus_readout({ x: 50, y: 50 })
    );
    expect(centre()?.disabled).toBe(true);
  });

  it('reports each move as a point, and the centre as none', () => {
    const onChange = render({ still: STILL, focus: { x: 52, y: 50 } });
    press('ArrowDown');
    expect(onChange).toHaveBeenLastCalledWith({ x: 52, y: 52 });
    press('ArrowLeft');
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    centre()?.click();
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it('places the point where the picture is tapped', () => {
    const onChange = render({ still: STILL });
    const button = pad();
    if (!button) throw new Error('no pad');
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(100, 200, 400, 200)
    );
    button.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        detail: 1,
        clientX: 200,
        clientY: 250,
      })
    );
    expect(onChange).toHaveBeenLastCalledWith({ x: 25, y: 25 });
  });

  it('says the point is this page’s own, and the pad is described by it', () => {
    render({ still: STILL });
    const saved = [...document.body.querySelectorAll('.focus__hint')].find(
      (hint) => hint.textContent === m.studio_page_editor_focus_still_saved()
    );
    expect(saved).toBeDefined();
    expect(pad()?.getAttribute('aria-describedby')?.split(' ')).toContain(
      saved?.id
    );
  });

  it('explains itself where the layout shows the still whole', () => {
    render({ still: STILL, crops: [] });
    expect(pad()).toBeNull();
    expect(document.body.textContent).toContain(
      m.studio_page_editor_focus_still_inactive()
    );
    expect(document.body.textContent).not.toContain(
      m.studio_page_editor_focus_inactive()
    );
  });

  it('is one labelled group, with the pad a button named for it', () => {
    render({ still: STILL });
    const group = document.body.querySelector('[role="group"]');
    const label = document.getElementById(
      group?.getAttribute('aria-labelledby') ?? ''
    );
    expect(label?.textContent).toBe(m.studio_page_editor_focus_label());
    expect(pad()?.getAttribute('aria-label')).toBe(
      m.studio_page_editor_focus_label()
    );
  });
});
