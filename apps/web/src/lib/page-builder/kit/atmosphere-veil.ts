/**
 * The live veil (landing-builder 03 X54): each atmosphere section's veil, as
 * thin as its Style asks wherever what the org's shader has drawn behind its
 * inks allows, and the proven one everywhere else.
 *
 * A section whose Style lets more through (`--lp-atmosphere-show`) has two
 * ends, registered in `schemes.css`: the proven veil (`--_atmos-floor`) and
 * the Style's (`--_atmos-thin`). While one is on the page, the org's shader
 * reports the darkest and lightest colour each part of the window has drawn
 * (`shaderTone`); on each report and each scroll, every ink drawn straight on
 * the veil (its words, a filled button's fill, a ghost button's line, a mark)
 * is held against the cells under it, and the section takes the thinnest
 * veil at which all of them hold (`liveVeil`) as `--_atmos-need`. Nothing
 * measured yet, or a browser that cannot read the ends: no `--_atmos-need`,
 * so the veil is the proven one. A section none of whose inks is on the
 * window keeps the veil it has.
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
 * window holds over the cells under it, or null while nothing has been
 * measured or none of its lines is on the window.
 */
export function sectionNeed(
  section: VeilSection,
  grid: ToneGrid,
  viewport: { width: number; height: number },
  memo: Map<VeilLine, Memo> = new Map()
): number | null {
  if (grid.samples === 0) return null;
  const cw = viewport.width / grid.cols;
  const ch = viewport.height / grid.rows;
  let need: number | null = null;
  for (const line of section.lines) {
    const box = line.box();
    if (box.right <= box.left || box.bottom <= box.top) continue;
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
    const memo = new Map<VeilLine, Memo>();
    const written = new Map<HTMLElement, string | null>();

    const update = () => {
      updateFrame = 0;
      const viewport = toneViewport();
      const { grid } = shaderTone;
      // Every read, then every write: a write between two reads would lay
      // the page out again.
      const needs = sections.map((s) => sectionNeed(s, grid, viewport, memo));
      sections.forEach((s, i) => {
        const need = needs[i] ?? null;
        // With none of its inks on the window, any veil holds: it keeps the
        // one it has rather than jump to the proven one as the last line
        // leaves. Only while nothing is measured is that the proven one.
        if (need === null && grid.samples > 0) return;
        const value = need === null ? null : String(need);
        if (written.get(s.el) === value) return;
        written.set(s.el, value);
        if (value === null) s.el.style.removeProperty('--_atmos-need');
        else s.el.style.setProperty('--_atmos-need', value);
      });
    };
    const scheduleUpdate = () => {
      if (!updateFrame) updateFrame = requestAnimationFrame(update);
    };

    const collect = () => {
      collectFrame = 0;
      for (const s of sections) s.el.style.removeProperty('--_atmos-need');
      written.clear();
      memo.clear();
      sections = read(root);
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

    collect();
    const unsubscribe = shaderTone.subscribe(scheduleUpdate);
    window.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleCollect);
    // The theme, the shader starting or stopping, and the page's own sections
    // change what is on the veil and in what colours.
    const observer = new MutationObserver(scheduleCollect);
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
    observer.observe(root, { childList: true, subtree: true });

    return () => {
      unsubscribe();
      window.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleCollect);
      observer.disconnect();
      cancelAnimationFrame(updateFrame);
      cancelAnimationFrame(collectFrame);
      release?.();
      for (const s of sections) s.el.style.removeProperty('--_atmos-need');
    };
  };
}

// ── The DOM's reader ──────────────────────────────────────────────────────

const SECTION =
  ".lp-section[data-lp-scheme='atmosphere']:not([data-lp-on-media])";

type Rgba = readonly [number, number, number, number];

/**
 * Any computed colour, as the browser draws it: through a 1 × 1 canvas,
 * never parsed by hand (a computed colour may be rgb(), color(srgb …) or
 * oklch()). Unreadable or transparent: null.
 */
function colourReader(): (css: string) => Rgba | null {
  const ctx = document
    .createElement('canvas')
    .getContext('2d', { willReadFrequently: true });
  const cache = new Map<string, Rgba | null>();
  return (css) => {
    const hit = cache.get(css);
    if (hit !== undefined) return hit;
    let out: Rgba | null = null;
    if (ctx) {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = 'transparent';
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const [r = 0, g = 0, b = 0, a = 0] = ctx.getImageData(0, 0, 1, 1).data;
      out = a === 0 ? null : [r, g, b, a];
    }
    cache.set(css, out);
    return out;
  };
}

const rgbOf = (c: Rgba): Rgb => [c[0], c[1], c[2]];
const OPAQUE = 250;

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
    if (!ground) continue;
    out.push({
      el,
      ground: rgbOf(ground),
      thin,
      floor,
      lines: inksOn(el, paint),
    });
  }
  return out;
}

/** Whether `el` sits on the section's veil: nothing opaque between them. */
function onVeil(
  el: Element,
  section: Element,
  paint: (css: string) => Rgba | null,
  verdicts: Map<Element, boolean>
): boolean {
  const parent = el.parentElement;
  if (!parent || parent === section || !section.contains(parent)) return true;
  const known = verdicts.get(parent);
  if (known !== undefined) return known;
  const fill = paint(getComputedStyle(parent).backgroundColor);
  const verdict =
    !parent.hasAttribute('data-lp-on-media') &&
    !(fill && fill[3] >= OPAQUE) &&
    onVeil(parent, section, paint, verdicts);
  verdicts.set(parent, verdict);
  return verdict;
}

function inksOn(
  section: HTMLElement,
  paint: (css: string) => Rgba | null
): VeilLine[] {
  const lines: VeilLine[] = [];
  const verdicts = new Map<Element, boolean>();
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

  // Words: each element that holds text itself, in its colour.
  const holders = new Set<HTMLElement>();
  const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.textContent?.trim() && node.parentElement)
      holders.add(node.parentElement);
  }
  for (const el of holders) {
    if (!onVeil(el, section, paint, verdicts)) continue;
    const cs = getComputedStyle(el);
    const ink = paint(cs.color);
    if (!ink || cs.visibility === 'hidden') continue;
    lines.push({
      rgb: rgbOf(ink),
      floor: textFloor(Number.parseFloat(cs.fontSize), Number(cs.fontWeight)),
      box: rectOf(el),
    });
  }

  // Controls and marks, at 3:1: a filled button's fill, a ghost button's
  // line, and a Style's marks (pseudo-elements in the mark ink, X24), which
  // reach a little past their host.
  for (const el of section.querySelectorAll<HTMLElement>('*')) {
    if (
      el.classList.contains('lp-surface') ||
      !onVeil(el, section, paint, verdicts)
    )
      continue;
    if (el.classList.contains('lp-button')) {
      const cs = getComputedStyle(el);
      const fill = paint(cs.backgroundColor);
      const edge =
        fill && fill[3] >= OPAQUE
          ? fill
          : Number.parseFloat(cs.borderTopWidth) > 0
            ? paint(cs.borderTopColor)
            : null;
      if (edge) lines.push({ rgb: rgbOf(edge), floor: 3, box: rectOf(el) });
    }
    for (const pseudo of ['::before', '::after']) {
      const ps = getComputedStyle(el, pseudo);
      if (ps.content === 'none' || ps.content === 'normal') continue;
      const mark = paint(ps.backgroundColor);
      if (!mark) continue;
      const em = Number.parseFloat(ps.fontSize) || 16;
      lines.push({ rgb: rgbOf(mark), floor: 3, box: rectOf(el, em / 2) });
    }
  }
  return lines;
}
