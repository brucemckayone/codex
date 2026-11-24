/**
 * The Showreel's type fitted to its room, wired: the hooks the Showreel calls
 * once each, at init, where their effects belong in its order.
 *
 * `useTypeFit`:
 *   - the Wide title: every piece's title fitted to the words' width, so the
 *     one on show takes its own the moment it shows;
 *   - the name window: the name as large as the width and its room let it
 *     be, never under `TYPE_FLOOR`, held at what CSS drew where the window is
 *     in flow (the owner's floor), so nothing moves when the page hydrates;
 *   - both film windows' masks (`title-mask.ts`): the name window's, and on
 *     Corner and Wide the big title's, drawn after it and never on Name.
 *
 * `useStandInRun`: the run a failed logo's stand-in name is held to in the
 * top bar, measured as it shows and on every resize of the bar or its meta.
 *
 * The maths is `name-lines.ts`'s; this measures the laid-out page and hands
 * the results back. Each fit runs now, once the fonts are in, and on resize.
 */
import { tick } from 'svelte';
import { showreelFeed } from '$lib/components/ui/ShaderHero/compositor/showreel-feed';
import type { HeroOptions } from '$lib/org-hero/hero-config';
import {
  fitTitle,
  type NameLines,
  nameInRoom,
  nameLines,
  standInRun,
} from './name-lines';
import type { ReelWords } from './reel-words';
import { drawTitleMask } from './title-mask';

/** The name window's largest size: desktop (with the peek, smaller) and
 *  phone, the mock's 228 or 196, and 138. */
const NAME_MAX = { desk: 228, deskPeek: 196, phone: 138 };
/** The Wide title's range (the mock's). */
export const WIDE_TITLE = { min: 72, max: 150 };
/**
 * The owner's floor: on a short screen the big type shrinks
 * with the room it has, never under this, Wide's least fitted size, and the
 * hero grows only as far as the floor needs. Type already under it (a
 * phone's) keeps its own size.
 */
export const TYPE_FLOOR = WIDE_TITLE.min;
/** Where the name window rests out of flow, its centre, as a share of the hero's height (`top: 36%`). */
const NAME_AT = 0.36;
/** The longest a later title's mask waits for an idle moment: past a cut. */
const MASK_IDLE_MS = 2000;

/** `run` once the page is idle (at most MASK_IDLE_MS on); returns its cancel. */
function whenIdle(run: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(run, { timeout: MASK_IDLE_MS });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(run, MASK_IDLE_MS / 2);
  return () => clearTimeout(id);
}

/** What `useTypeFit` reads from the Showreel, each as it is now. */
interface TypeFitSource {
  /** The big title on show (Corner and Wide). */
  readonly titleEl: () => HTMLElement | undefined;
  /** The name window (Name). */
  readonly windowEl: () => HTMLElement | undefined;
  /** The opening's centred name on Corner and Wide, while it opens. */
  readonly openerEl: () => HTMLElement | null | undefined;
  readonly options: () => HeroOptions;
  readonly words: () => readonly ReelWords[];
  /** The piece on show, and its title. */
  readonly shown: () => number;
  readonly title: () => string | undefined;
  /** The words' swap: going out, the title window stays where it sat. */
  readonly swap: () => '' | 'out' | 'in';
  readonly name: () => string;
  readonly desktop: () => boolean;
}

/**
 * Fit the Wide title and the name window, and draw both film windows'
 * masks. Call once, during the Showreel's init.
 */
export function useTypeFit(source: TypeFitSource): {
  /** The Wide title's size for the piece on show, or null (CSS's). */
  readonly wideSize: number | null;
  /** The name window's lines and size, or null (CSS's). */
  readonly nameFit: NameLines | null;
  /** The name window's height as CSS drew it in flow, or null out of flow. */
  readonly nameBox: number | null;
} {
  const layout = $derived(source.options()['reel-layout']);
  const peek = $derived(source.options()['reel-peek'] === 'on');

  let measurer: CanvasRenderingContext2D | null = null;
  function widthAt100(el: HTMLElement, text: string): number {
    measurer ??= document.createElement('canvas').getContext('2d');
    if (!measurer) return 0;
    const style = getComputedStyle(el);
    measurer.font = `${style.fontWeight} 100px ${style.fontFamily}`;
    return measurer.measureText(text).width;
  }
  /** Run a fit now, once the fonts are in, and on every resize. */
  function refit(run: () => void) {
    run();
    let live = true;
    void document.fonts?.ready.then(() => {
      if (live) run();
    });
    window.addEventListener('resize', run);
    return () => {
      live = false;
      window.removeEventListener('resize', run);
    };
  }

  // Every piece's title fitted to the words' width, so the one on show takes
  // its own the moment it shows. The sizers never take one: they hold Wide's
  // title at its most from the first paint (`--_wide-max`).
  let wideSizes = $state<number[] | null>(null);
  $effect(() => {
    const el = source.titleEl();
    const titles = source.words().map((w) => w.title);
    if (layout !== 'wide' || !source.desktop() || !el) {
      wideSizes = null;
      return;
    }
    return refit(() => {
      const available = el.parentElement?.clientWidth ?? 0;
      wideSizes = titles.map((title) =>
        fitTitle(
          widthAt100(el, title),
          available,
          WIDE_TITLE.min,
          WIDE_TITLE.max
        )
      );
    });
  });
  const wideSize = $derived(wideSizes?.[source.shown()] ?? null);

  // The name as large as the width and its room let it be, never under
  // TYPE_FLOOR. Out of flow (a tall screen) the window moves nothing, so the
  // fit takes the room it has at its place, between the top bar and the
  // words. On a short screen CSS puts it in flow (the owner's floor): the
  // window fills the room between them, and CSS sets the name at the floor
  // there, so the hero grows only where the floor needs it. The fit sets the
  // name in that box and holds the box at what CSS drew (`nameBox`), so
  // nothing moves when the page hydrates.
  let nameFit = $state<NameLines | null>(null);
  let nameBox = $state<number | null>(null);
  $effect(() => {
    const el = source.windowEl();
    const max = source.desktop()
      ? peek
        ? NAME_MAX.deskPeek
        : NAME_MAX.desk
      : NAME_MAX.phone;
    // The words' slot is the room's foot: it moves with the pieces' words.
    void source.words();
    if (layout !== 'name' || !el) {
      nameFit = null;
      nameBox = null;
      return;
    }
    return refit(() => {
      const name = source.name();
      const measure = (text: string) => widthAt100(el, text);
      if (getComputedStyle(el).position === 'absolute') {
        nameBox = null;
        const room = roomAt(el);
        nameFit =
          room === null
            ? nameLines(name, measure, el.clientWidth, max)
            : nameInRoom(name, measure, el.clientWidth, max, room, TYPE_FLOOR);
        return;
      }
      const drawn = drawnName(el, name);
      const room = Math.max(drawn, rowRoom(el));
      const fit = nameInRoom(
        name,
        measure,
        el.clientWidth,
        max,
        room,
        TYPE_FLOOR
      );
      nameBox = drawn;
      // A name the canvas sets taller than CSS drew it keeps CSS's, so the
      // box never grows past the server's paint.
      nameFit = fit.lines.length * fit.size <= room + 0.5 ? fit : null;
    });
  });

  // The name as the film's window: drawn where the page lays it out, each
  // word on its baseline in its letter-spacing, at the window's size, white
  // on black (the compositor reads its red channel). The title's own
  // placement (`title-mask.ts`): one for both windows. Its
  // translateY(-50%) is where the name rests, so it stays in.
  function drawMask(el: HTMLElement) {
    showreelFeed.setNameMask(drawTitleMask(el, { undoTranslation: false }));
  }
  $effect(() => {
    const el = source.windowEl();
    if (!nameFit || !el) {
      showreelFeed.setNameMask(null);
      return;
    }
    let live = true;
    void tick().then(() => {
      if (live) drawMask(el);
    });
    return () => {
      live = false;
    };
  });
  $effect(() => () => showreelFeed.setNameMask(null));

  // ── the title as the film's window on Corner and Wide (the owner's choice) ──
  // "Through the name" runs on every layout: there the big title's words are
  // the letters (`title-mask.ts`). The Name window's mask stays the effect
  // above's: this one never draws on that layout, and draws after it.
  let titleMaskDrawn = false;
  const titleWindow = $derived(
    layout !== 'name' &&
      (source.options()['reel-opening'] === 'name' ||
        source.options()['reel-film'] === 'name')
  );
  $effect(() => {
    const el = source.titleEl();
    void source.title();
    void wideSize;
    if (layout === 'name') return;
    // The opening's own name is the window while it opens (below).
    if (source.openerEl()) return;
    if (!titleWindow || !el) {
      showreelFeed.setNameMask(null);
      return;
    }
    // Going out: the window stays where the last title sat until the next is in.
    if (source.swap() === 'out') return;
    let live = true;
    let stop = () => {};
    let idle: (() => void) | null = null;
    const draw = () => {
      if (!live) return;
      titleMaskDrawn = true;
      stop = refit(() => showreelFeed.setNameMask(drawTitleMask(el)));
    };
    void tick().then(() => {
      if (!live) return;
      // The first title's at once: the opening reads it from its first
      // frame. A later one once the page is idle: its window-sized draw and
      // upload landed inside every cut, and the transitions stalled (the
      // owner's testing, 2026-11-23). Only the opening and a press into the
      // film read it.
      if (!titleMaskDrawn) draw();
      else idle = whenIdle(draw);
    });
    return () => {
      live = false;
      idle?.();
      stop();
    };
  });

  // ── the opening's name on Corner and Wide: centred, as the Name window is ──
  // The film's window while the opening runs (the owner's, 2026-11-23: "the
  // Of Blood and Bones text in the middle, and then we zoom into one of the
  // letters"); the title takes the window back once the words come in.
  $effect(() => {
    const el = source.openerEl();
    if (!el) return;
    let live = true;
    let stop = () => {};
    void tick().then(() => {
      if (live)
        stop = refit(() =>
          showreelFeed.setNameMask(
            drawTitleMask(el, { undoTranslation: false })
          )
        );
    });
    return () => {
      live = false;
      stop();
    };
  });

  return {
    get wideSize() {
      return wideSize;
    },
    get nameFit() {
      return nameFit;
    },
    get nameBox() {
      return nameBox;
    },
  };
}

/**
 * The name in flow as CSS draws it, the server's paint: the height of one
 * run of text in the window's own rules (its size, `--_name-size`, the
 * floor; its tracking, in em), wrapped to the window's width. A hidden copy
 * of the window, with none of the fit's inline sizes, taken out at once.
 */
function drawnName(el: HTMLElement, name: string): number {
  const probe = el.cloneNode(false);
  if (!(probe instanceof HTMLElement)) return 0;
  probe.removeAttribute('style');
  probe.style.cssText = `position:absolute;top:0;left:0;width:${el.clientWidth}px;margin:0;visibility:hidden`;
  const run = document.createElement('span');
  run.textContent = name;
  probe.appendChild(run);
  el.insertAdjacentElement('afterend', probe);
  const height = probe.getBoundingClientRect().height;
  probe.remove();
  return height;
}
/**
 * The room the window in flow has as CSS lays it out: the second row as the
 * hero's least height leaves it, less the window's margins. Read from the
 * inner's other rows, which the window never sizes, so the name the fit set
 * last never inflates it.
 */
function rowRoom(el: HTMLElement): number {
  const inner = el.parentElement;
  if (!inner) return 0;
  const grid = getComputedStyle(inner);
  const own = getComputedStyle(el);
  const [bar = 0, , foot = 0] = grid.gridTemplateRows
    .split(' ')
    .map(Number.parseFloat);
  const room =
    Number.parseFloat(grid.minHeight) -
    Number.parseFloat(grid.paddingTop) -
    Number.parseFloat(grid.paddingBottom) -
    bar -
    foot -
    Number.parseFloat(own.marginTop) -
    Number.parseFloat(own.marginBottom);
  return Number.isFinite(room) ? Math.max(0, room) : 0;
}
/**
 * The room the name has out of flow, at its place (NAME_AT of the hero's
 * height, its centre): twice the less of its centre's reach up to the top
 * bar's foot and down to the words' slot. The window, out of flow, moves
 * neither. Null where nothing is laid out.
 */
function roomAt(el: HTMLElement): number | null {
  const inner = el.parentElement;
  const top = inner?.querySelector('.reel__top')?.getBoundingClientRect();
  const slot = inner?.querySelector('.reel__slot')?.getBoundingClientRect();
  const box = inner?.getBoundingClientRect();
  if (!top || !slot || !box || !(box.height > 0)) return null;
  const centre = box.top + NAME_AT * box.height;
  return Math.max(0, 2 * Math.min(centre - top.bottom, slot.top - centre));
}

/** What `useStandInRun` reads from the Showreel, each as it is now. */
interface StandInSource {
  /** The reel's root, holding the top bar. */
  readonly root: () => HTMLElement | undefined;
  /** A failed logo leading alone: the name stands in over its place. */
  readonly standIn: () => boolean;
}

/**
 * The run a failed logo's stand-in name is held to (`standInRun`), measured
 * as it shows and again whenever the bar or its meta resizes (the viewport's
 * width, Follow turning to Following, a face landing). Null until measured:
 * the stand-in shows once it is, so no frame paints it unbounded over the
 * meta. Call once, during the Showreel's init.
 */
export function useStandInRun(source: StandInSource): {
  readonly room: number | null;
} {
  let room = $state<number | null>(null);
  $effect(() => {
    const bar = source.root()?.querySelector<HTMLElement>('.reel__top');
    const sig = bar?.querySelector<HTMLElement>('.reel__sig');
    if (!source.standIn() || !bar || !sig) {
      room = null;
      return;
    }
    const meta = bar.querySelector<HTMLElement>('.reel__meta');
    const measure = () => {
      const box = bar.getBoundingClientRect();
      const style = getComputedStyle(bar);
      room = standInRun({
        sigLeft: sig.getBoundingClientRect().left,
        end: box.right - (Number.parseFloat(style.paddingRight) || 0),
        gap: Number.parseFloat(style.columnGap) || 0,
        meta: meta?.getBoundingClientRect() ?? null,
      });
    };
    measure();
    const resized = new ResizeObserver(measure);
    resized.observe(bar);
    if (meta) resized.observe(meta);
    return () => resized.disconnect();
  });
  return {
    get room() {
      return room;
    },
  };
}
