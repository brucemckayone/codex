/**
 * The live veil (landing-builder 03 X54): each atmosphere section's veil, as
 * thin as its Style asks wherever what the org's shader has drawn behind its
 * inks allows, and the proven one everywhere else.
 *
 * A section whose Style lets more through (`--lp-atmosphere-show`) has two
 * ends, registered in `schemes.css`: the proven veil (`--_atmos-floor`) and
 * the Style's (`--_atmos-thin`). While one is on the page, the org's shader
 * reports the darkest and lightest colour each part of the window has drawn
 * (`shaderTone`); on each report, scroll and change of size, every ink drawn
 * straight on the veil (its words, a control's fill, border and line, an
 * SVG's strokes, a Style's marks) is held against the cells under it, and
 * the section takes the thinnest veil at which all of them hold (`liveVeil`)
 * as `--_atmos-need`.
 *
 * Whatever cannot be measured keeps the proven veil: nothing seen yet (a
 * moving shader is watched for a few seconds first), a browser that cannot
 * read the ends, an ink the page cannot read or that is not opaque, or one
 * on a translucent surface. A section none of whose inks is on the window
 * keeps the veil it has.
 */
import {
  shaderTone,
  toneViewport,
} from '$lib/components/ui/ShaderHero/shader-tone';
import {
  cellsUnder,
  type ToneGrid,
} from '$lib/components/ui/ShaderHero/tone-grid';
import { liveVeil, type Rgb, textFloor, type VeilInk } from './model/live-veil';

type Box = { left: number; top: number; right: number; bottom: number };

/** One colour drawn straight on a section's veil, and where it is now. */
export interface VeilLine extends VeilInk {
  box(): Box;
}

/** An atmosphere section whose veil may go thinner than the proven one. */
export interface VeilSection {
  el: HTMLElement;
  /** The veil's colour (the section's ground, opaque). */
  ground: Rgb;
  thin: number;
  floor: number;
  lines: VeilLine[];
}

/** What the page shows: the DOM's, or a test's. */
export type VeilReader = (root: HTMLElement) => VeilSection[];

type Memo = { grid: ToneGrid; samples: number; key: string; need: number };

/**
 * The veil `section` needs now: the thinnest at which every line on the
 * window holds over the cells under it, or null while the shader is not
 * yet `settled` or none of its lines is on the window. Each box reaches
 * `reach` px further: the shader's blur mixes in what lies that far off.
 */
export function sectionNeed(
  section: VeilSection,
  grid: ToneGrid,
  viewport: { width: number; height: number },
  memo: Map<VeilLine, Memo> = new Map(),
  { settled = grid.samples > 0, reach = 0 } = {}
): number | null {
  if (!settled) return null;
  const cw = viewport.width / grid.cols;
  const ch = viewport.height / grid.rows;
  let need: number | null = null;
  for (const line of section.lines) {
    const at = line.box();
    if (at.right <= at.left || at.bottom <= at.top) continue;
    const box = {
      left: at.left - reach,
      top: at.top - reach,
      right: at.right + reach,
      bottom: at.bottom + reach,
    };
    const backdrops = cellsUnder(grid, box, viewport);
    if (backdrops.length === 0) continue;
    // The same cells and the same frames give the same answer.
    const key = [box.left / cw, box.right / cw, box.top / ch, box.bottom / ch]
      .map(Math.floor)
      .join();
    const seen = memo.get(line);
    let lineNeed: number;
    if (
      seen &&
      seen.grid === grid &&
      seen.samples === grid.samples &&
      seen.key === key
    ) {
      lineNeed = seen.need;
    } else {
      lineNeed = liveVeil({
        ground: section.ground,
        inks: [line],
        backdrops,
        thin: section.thin,
        floor: section.floor,
      });
      memo.set(line, { grid, samples: grid.samples, key, need: lineNeed });
    }
    need = Math.max(need ?? section.thin, lineNeed);
    if (need >= section.floor) break;
  }
  return need;
}

/** How long a burst of changes to the page waits before it is read again. */
const SETTLE_MS = 250;

/**
 * The page root's attachment. `active`: the page is live with a moving
 * background (PageRenderer's `data-lp-atmosphere`).
 */
export function atmosphereVeil(active: boolean, read: VeilReader = readVeil) {
  return (root: HTMLElement) => {
    if (!active) return;
    let sections: VeilSection[] = [];
    let release: (() => void) | null = null;
    let updateFrame = 0;
    let collectFrame = 0;
    let collectTimer: ReturnType<typeof setTimeout> | undefined;
    const memo = new Map<VeilLine, Memo>();
    const written = new Map<HTMLElement, string | null>();
    const sizes = new ResizeObserver(() => scheduleUpdate());

    const write = (el: HTMLElement, value: string | null) => {
      const before = written.get(el) ?? null;
      if (before === value) return;
      written.set(el, value);
      // Thinning eases in; thickening is at once (`surfaces.css`).
      const thinning =
        value !== null && (before === null || Number(value) < Number(before));
      el.toggleAttribute('data-lp-veil-easing', thinning);
      if (value === null) el.style.removeProperty('--_atmos-need');
      else el.style.setProperty('--_atmos-need', value);
    };

    const update = () => {
      cancelAnimationFrame(updateFrame);
      updateFrame = 0;
      const viewport = toneViewport();
      const { grid, settled } = shaderTone;
      const tone = { settled, reach: 2 * shaderTone.blur };
      // Every read, then every write: a write between two reads would lay
      // the page out again.
      const needs = sections.map((s) =>
        sectionNeed(s, grid, viewport, memo, tone)
      );
      sections.forEach((s, i) => {
        const need = needs[i] ?? null;
        // With none of its inks on the window, any veil holds: it keeps the
        // one it has rather than jump as the last line leaves.
        if (need === null && settled) return;
        write(s.el, need === null ? null : String(need));
      });
    };
    function scheduleUpdate() {
      if (!updateFrame) updateFrame = requestAnimationFrame(update);
    }

    // Read again in one task, so a section keeps the veil it has until its
    // new one is written: dropping it to the proven one first would make it
    // ease back in each time. One that is gone, or can no longer be
    // measured, takes the proven veil.
    const collect = () => {
      collectFrame = 0;
      const before = sections;
      sizes.disconnect();
      memo.clear();
      sections = read(root);
      for (const s of before)
        if (!sections.some((now) => now.el === s.el)) write(s.el, null);
      for (const s of sections) sizes.observe(s.el);
      if (sections.length > 0 && !release) release = shaderTone.demand();
      if (sections.length === 0 && release) {
        release();
        release = null;
      }
      update();
    };
    const scheduleCollect = () => {
      if (!collectFrame) collectFrame = requestAnimationFrame(collect);
    };
    // A burst (a count rolling up, a theme's colours easing over) is read
    // once it is over; meanwhile the inks already read are measured.
    const collectSoon = () => {
      clearTimeout(collectTimer);
      collectTimer = setTimeout(scheduleCollect, SETTLE_MS);
    };

    // Colours that eased (a theme's, a hover's) are read once they have
    // settled; a veil's own easing is not one of them.
    const eased = (event: Event) => {
      if (!sections.some((s) => s.el === event.target)) collectSoon();
    };

    collect();
    // A shader that starts again (cleared, or not yet seen for long enough)
    // drops every veil before its next frame is painted, not a frame later.
    const unsubscribe = shaderTone.subscribe(() =>
      shaderTone.settled ? scheduleUpdate() : update()
    );
    // The window's scroll, and any scroller's inside the page; a <details>
    // opening. Captured: neither event bubbles.
    const listen = { capture: true, passive: true } as const;
    document.addEventListener('scroll', scheduleUpdate, listen);
    document.addEventListener('toggle', scheduleUpdate, listen);
    root.addEventListener('transitionend', eased, listen);
    window.addEventListener('resize', scheduleCollect);
    // The theme, the shader starting or stopping, and the page's own sections
    // change what is on the veil and in what colours. Text alone changing (a
    // count) moves no ink to another element or colour.
    const observer = new MutationObserver((records) => {
      const textOnly = records.every(
        (r) =>
          r.type === 'characterData' ||
          (r.type === 'childList' &&
            [...r.addedNodes, ...r.removedNodes].every(
              (n) => n.nodeType === Node.TEXT_NODE
            ))
      );
      if (textOnly) {
        scheduleUpdate();
        collectSoon();
      } else scheduleCollect();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    const layout = root.closest('.org-layout');
    if (layout)
      observer.observe(layout, {
        attributes: true,
        attributeFilter: ['data-hero-shader-active'],
      });
    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => {
      unsubscribe();
      document.removeEventListener('scroll', scheduleUpdate, listen);
      document.removeEventListener('toggle', scheduleUpdate, listen);
      root.removeEventListener('transitionend', eased, listen);
      window.removeEventListener('resize', scheduleCollect);
      observer.disconnect();
      sizes.disconnect();
      clearTimeout(collectTimer);
      cancelAnimationFrame(updateFrame);
      cancelAnimationFrame(collectFrame);
      release?.();
      for (const s of sections) {
        s.el.style.removeProperty('--_atmos-need');
        s.el.removeAttribute('data-lp-veil-easing');
      }
    };
  };
}

// ── The DOM's reader ──────────────────────────────────────────────────────

const SECTION =
  ".lp-section[data-lp-scheme='atmosphere']:not([data-lp-on-media])";

/** What a visitor works: its fill, its border and its line need 3:1. */
const CONTROL =
  "button, summary, input, select, textarea, [role='tab'], [role='tablist'], .lp-button";

type Rgba = readonly [number, number, number, number];
/** A colour as drawn; `none` for transparent; `unreadable` for anything else. */
type Paint = Rgba | 'none' | 'unreadable';

const OPAQUE = 250;
const SENTINEL = '#010203';

/**
 * Any computed colour, as the browser draws it: through a 1 × 1 canvas,
 * never parsed by hand (a computed colour may be rgb(), color(srgb …) or
 * oklch()). A value the canvas does not take leaves the sentinel in place.
 */
function colourReader(): (css: string) => Paint {
  const ctx = document
    .createElement('canvas')
    .getContext('2d', { willReadFrequently: true });
  const cache = new Map<string, Paint>();
  return (css) => {
    const hit = cache.get(css);
    if (hit !== undefined) return hit;
    let out: Paint = 'unreadable';
    if (ctx) {
      ctx.fillStyle = SENTINEL;
      ctx.fillStyle = css;
      if (ctx.fillStyle !== SENTINEL) {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillRect(0, 0, 1, 1);
        const [r = 0, g = 0, b = 0, a = 0] = ctx.getImageData(0, 0, 1, 1).data;
        out = a === 0 ? 'none' : [r, g, b, a];
      }
    }
    cache.set(css, out);
    return out;
  };
}

const opaque = (p: Paint): p is Rgba => typeof p !== 'string' && p[3] >= OPAQUE;
const rgbOf = (c: Rgba): Rgb => [c[0], c[1], c[2]];
/** The same colour as `rgb`, within the two 8-bit steps a translucent
 *  veil's colour loses when the canvas un-premultiplies it. */
const sameRgb = (c: Rgba, rgb: Rgb) =>
  Math.abs(c[0] - rgb[0]) <= 2 &&
  Math.abs(c[1] - rgb[1]) <= 2 &&
  Math.abs(c[2] - rgb[2]) <= 2;

/** `el`'s ancestors, nearest first. */
function ancestors(el: Element): Element[] {
  const out: Element[] = [];
  for (let p = el.parentElement; p; p = p.parentElement) out.push(p);
  return out;
}

/** Each atmosphere section painting a veil it may thin, and its inks. */
export function readVeil(root: HTMLElement): VeilSection[] {
  if (!root.closest('.org-layout[data-hero-shader-active]')) return [];
  const paint = colourReader();
  const out: VeilSection[] = [];
  for (const el of root.querySelectorAll<HTMLElement>(SECTION)) {
    const cs = getComputedStyle(el);
    const thin = Number.parseFloat(cs.getPropertyValue('--_atmos-thin'));
    const floor = Number.parseFloat(cs.getPropertyValue('--_atmos-floor'));
    // Unregistered, these read as their unresolved text: NaN, and no thinning.
    if (!(thin < floor)) continue;
    const ground = paint(cs.backgroundColor);
    if (typeof ground === 'string') continue;
    const lines = inksOn(el, paint, rgbOf(ground));
    if (lines) out.push({ el, ground: rgbOf(ground), thin, floor, lines });
  }
  return out;
}

type Placement = 'veil' | 'off' | 'unknown';

/**
 * Where `el` is drawn: on the section's veil (nothing filled between them),
 * off it (on something opaque, or a picture), or over a translucent fill,
 * whose composite with the veil is not measured.
 */
function placement(
  el: Element,
  section: Element,
  paint: (css: string) => Paint,
  known: Map<Element, Placement>
): Placement {
  const parent = el.parentElement;
  if (!parent || parent === section || !section.contains(parent)) return 'veil';
  const hit = known.get(parent);
  if (hit) return hit;
  const fill = paint(getComputedStyle(parent).backgroundColor);
  const own: Placement | null = parent.hasAttribute('data-lp-on-media')
    ? 'off'
    : opaque(fill)
      ? 'off'
      : fill === 'none'
        ? null
        : 'unknown';
  const at = own ?? placement(parent, section, paint, known);
  known.set(parent, at);
  return at;
}

/** Every colour function in a computed value: a shadow list, a gradient. */
function colourFunctions(value: string): string[] {
  return (
    value.match(/(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\)/g) ??
    []
  );
}

/** The colours of every opaque, unblurred line in a computed box-shadow. */
function shadowColours(shadow: string): string[] {
  return shadow === 'none' ? [] : colourFunctions(shadow);
}

/**
 * The colour stops of a computed `background-image` drawn only with
 * gradients (Path's route, 03 X59), or null when any layer is a picture
 * (`url()`, `image-set()`, a cross-fade…), whose colours cannot be read.
 */
export function imageColours(image: string): string[] | null {
  if (image === 'none') return [];
  if (/\b(?:url|image|image-set|cross-fade|element|paint)\(/.test(image))
    return null;
  if (!/gradient\(/.test(image)) return null;
  return colourFunctions(image);
}

const SIDES = ['Top', 'Right', 'Bottom', 'Left'] as const;

/** Every ink on the section's veil, or null if one cannot be measured. */
function inksOn(
  section: HTMLElement,
  paint: (css: string) => Paint,
  ground: Rgb
): VeilLine[] | null {
  const lines: VeilLine[] = [];
  const known = new Map<Element, Placement>();
  let unmeasurable = false;
  const rectOf =
    (el: Element, grow = 0) =>
    () => {
      const r = el.getBoundingClientRect();
      return {
        left: r.left - grow,
        top: r.top - grow,
        right: r.right + grow,
        bottom: r.bottom + grow,
      };
    };
  /**
   * Where a pseudo-element mark is drawn, reaching `grow` further. Placed
   * absolutely, its own box: the offsets the browser reports from its
   * containing block (the host if positioned, else the host's nearest
   * positioned ancestor), read again on every measure. Otherwise its host's.
   */
  const markBox = (host: Element, ps: CSSStyleDeclaration, grow: number) => {
    const block =
      ps.position === 'absolute'
        ? [host, ...ancestors(host)].find(
            (el) => getComputedStyle(el).position !== 'static'
          )
        : undefined;
    if (!block) return rectOf(host, grow);
    return () => {
      const at = ['left', 'top', 'width', 'height'].map((key) =>
        ps.getPropertyValue(key)
      );
      if (!at.every((value) => value.endsWith('px')))
        return rectOf(host, grow)();
      const [x = 0, y = 0, w = 0, h = 0] = at.map(Number.parseFloat);
      const r = block.getBoundingClientRect();
      const left = r.left + block.clientLeft + x;
      const top = r.top + block.clientTop + y;
      return {
        left: left - grow,
        top: top - grow,
        right: left + w + grow,
        bottom: top + h + grow,
      };
    };
  };
  /** An ink at `floor`: transparent is nothing; anything else not opaque
   *  or not readable keeps the section at the proven veil. */
  const add = (p: Paint, floor: number, box: () => Box) => {
    if (p === 'none') return;
    if (!opaque(p)) unmeasurable = true;
    else lines.push({ rgb: rgbOf(p), floor, box });
  };

  /**
   * A Style's marks on `el` (pseudo-elements, X24), which reach a little
   * past their host: their fill and borders, or, drawn with gradients
   * (Path's route), each opaque stop. A translucent stop is shading, as a
   * soft shadow is, and one in the ground's own colour is the ground (a
   * ring's hole). False when one is a picture, which cannot be read.
   */
  const marksOf = (el: Element): boolean => {
    for (const pseudo of ['::before', '::after']) {
      const ps = getComputedStyle(el, pseudo);
      if (ps.content === 'none' || ps.content === 'normal') continue;
      const em = Number.parseFloat(ps.fontSize) || 16;
      const box = markBox(el, ps, em / 2);
      const mark = paint(ps.backgroundColor);
      if (mark === 'none' && ps.backgroundImage !== 'none') {
        const stops = imageColours(ps.backgroundImage);
        if (!stops) return false;
        for (const stop of stops) {
          const p = paint(stop);
          if (opaque(p) && !sameRgb(p, ground)) add(p, 3, box);
        }
      } else add(mark, 3, box);
      for (const side of SIDES)
        if (
          Number.parseFloat(
            ps.getPropertyValue(`border-${side.toLowerCase()}-width`)
          ) > 0
        )
          add(
            paint(ps.getPropertyValue(`border-${side.toLowerCase()}-color`)),
            3,
            box
          );
    }
    return true;
  };

  // Words: each element that holds text itself, in its colour, on the veil
  // (not on its own fill). Hidden ones too: they may be shown.
  const holders = new Set<HTMLElement>();
  const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.textContent?.trim() && node.parentElement)
      holders.add(node.parentElement);
  }
  for (const el of holders) {
    const at = placement(el, section, paint, known);
    if (at === 'unknown') return null;
    if (at === 'off') continue;
    const cs = getComputedStyle(el);
    const fill = paint(cs.backgroundColor);
    if (opaque(fill)) continue;
    if (fill !== 'none') return null;
    add(
      paint(cs.color),
      textFloor(Number.parseFloat(cs.fontSize), Number(cs.fontWeight)),
      rectOf(el)
    );
  }

  // At 3:1: a control's fill, borders and drawn lines; an SVG's strokes and
  // fills; a Style's marks (pseudo-elements in the mark ink, X24), which
  // reach a little past their host.
  for (const el of section.querySelectorAll<HTMLElement | SVGElement>('*')) {
    if (el.classList.contains('lp-surface')) continue;
    const at = placement(el, section, paint, known);
    if (at === 'unknown') return null;
    if (at === 'off') continue;
    const cs = getComputedStyle(el);
    if (el.matches(CONTROL)) {
      const fill = paint(cs.backgroundColor);
      if (opaque(fill)) add(fill, 3, rectOf(el));
      for (const side of SIDES)
        if (
          Number.parseFloat(
            cs.getPropertyValue(`border-${side.toLowerCase()}-width`)
          ) > 0
        )
          add(
            paint(cs.getPropertyValue(`border-${side.toLowerCase()}-color`)),
            3,
            rectOf(el)
          );
      for (const colour of shadowColours(cs.boxShadow)) {
        const line = paint(colour);
        // A soft, translucent shadow is shading, not a line.
        if (opaque(line)) add(line, 3, rectOf(el, 8));
      }
    }
    if (
      typeof SVGGeometryElement !== 'undefined' &&
      el instanceof SVGGeometryElement
    ) {
      for (const p of ['stroke', 'fill'] as const) {
        const value = cs.getPropertyValue(p);
        if (value === 'none') continue;
        if (p === 'stroke' && Number.parseFloat(cs.strokeWidth) === 0) continue;
        add(
          value.startsWith('url(') ? 'unreadable' : paint(value),
          3,
          rectOf(el)
        );
      }
    }
    if (!marksOf(el)) return null;
    if (unmeasurable) return null;
  }
  // The section's own marks too (Path's walked line is drawn on it).
  if (!marksOf(section)) return null;
  return unmeasurable ? null : lines;
}
