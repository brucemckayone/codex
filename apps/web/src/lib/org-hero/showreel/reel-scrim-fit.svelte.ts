/**
 * The Showreel's scrims fitted to its inks, wired: the hook the Showreel calls
 * once, at init, where its effect belongs in its order (after the type fit,
 * before the stand-in's run).
 *
 * `useScrimFit` measures the laid-out reel and writes what `reel-scrim.ts`
 * solves: the scrims' tint (`--_scrim`), the shades' peaks and ellipses, each
 * group's glow and halo, a control's fill, the lift of a colour that cannot
 * keep its floor (`data-lifted`) or its ring in its own pole
 * (`data-own-pole`), the focus ring's colour and the scrims' reach. It marks
 * the root `data-fit` once a fit has run with the fonts in, and fits again
 * for each piece, on a resize, once the fonts are in, when a failed logo's
 * stand-in shows, and whenever the inks may have turned.
 *
 * Its contract with the Showreel's markup is the class lists below
 * (`SCRIMMED`, `FILLED`, `GROUPED`) and the top bar, `.reel__top`.
 */
import { tick } from 'svelte';
import { logger } from '$lib/observability';
import type { HeroOptions } from '$lib/org-hero/hero-config';
import { themeState } from '$lib/theme.svelte';
import { type GlyphBox, glyphBox } from './glyph-box';
import {
  focusInk,
  glowLeaves,
  groundPoles,
  growShades,
  haloAlpha,
  type Ink,
  liftedNodes,
  liftStep,
  MAX_SCRIM_ALPHA,
  type Need,
  outlineAlpha,
  over,
  ownPole,
  type Rgb,
  ringCarries,
  ringHalo,
  SHADE_PEAK_MAX,
  SHADES,
  type Shade,
  scrimAlpha,
  scrimTint,
  secondCarrier,
  shadeFloor,
  shadeProps,
  wordRoom,
} from './reel-scrim';

/** What a scrim covers: its words, and the controls drawn in their ink. */
const SCRIMMED = '[data-ink], .reel__round, .reel__ghost';
/** Room the scrims keep past the last word, before they ease away. */
const SCRIM_MARGIN = 24;
/** The controls whose own glass fill carries their label or icon. */
const FILLED = '.reel__ghost, .reel__round';
/** The groups of words that read as one block: one outline strength each. */
const GROUPED =
  '.reel__sig, .reel__meta, .reel__words, .reel__index, .reel__strip';

/** The shortfalls (a solved tint and the roles it leaves short) reported this page load (review R6, r6 L1). */
const warnedShortfalls = new Set<string>();

/** The shades as solved: each scrim's peak, and its two ellipses. */
function drawShades(root: HTMLElement, shades: readonly Shade[]) {
  for (const [prop, value] of Object.entries(shadeProps(shades))) {
    root.style.setProperty(prop, value);
  }
}

/** The ratio each scrimmed thing keeps: large text and the round icon
 *  control 3:1 (WCAG 1.4.3, 1.4.11), body text and the ghost's label 4.5:1. */
function ratioOf(el: HTMLElement): number {
  if (el.dataset.ink) return el.dataset.ink === 'large' ? 3 : 4.5;
  return el.classList.contains('reel__round') ? 3 : 4.5;
}

/** A CSS transition of `color` (a `CSSTransition`). */
function easesColour(motion: Animation): boolean {
  return (
    'transitionProperty' in motion && motion.transitionProperty === 'color'
  );
}

/** What `useScrimFit` reads from the Showreel, each as it is now. */
interface ScrimFitSource {
  /** The reel's root: what the fit measures and writes. */
  readonly root: () => HTMLElement | undefined;
  /** How each word stands off the film: a soft shadow, or a ring. */
  readonly edge: () => HeroOptions['reel-edge'];
  /** What the fit runs again on: the layout, the peek, the piece on show and the stand-in showing. */
  readonly layout: () => HeroOptions['reel-layout'];
  readonly peek: () => boolean;
  readonly shown: () => number;
  readonly showsStandIn: () => boolean;
}

/**
 * Fit the reel's scrims to its inks, now and whenever they may have
 * changed. Call once, during the Showreel's init.
 */
export function useScrimFit(source: ScrimFitSource): void {
  let probe: CanvasRenderingContext2D | null = null;
  function rgba(color: string): { rgb: Rgb; alpha: number } | null {
    probe ??= document
      .createElement('canvas')
      .getContext('2d', { willReadFrequently: true });
    if (!probe || !color) return null;
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = '#010203';
    probe.fillStyle = color;
    if (probe.fillStyle === '#010203') return null;
    probe.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0, a = 255] = probe.getImageData(0, 0, 1, 1).data;
    return { rgb: [r, g, b], alpha: a / 255 };
  }
  /**
   * The scrims' tint and least opacity for the inks as resolved, and how far
   * each must hold it. No bands (owner, 2026-11-20): soft radial shades at
   * the header's corners and rising in from the foot's (`HEADER_SHADE`,
   * `FOOT_SHADE`), and each word's own halo (or a control's own fill) as
   * strong as its ink still needs over what the shades lay at its weakest
   * point. The header is its words and controls, and any control lying wholly
   * above the header's foot (the phone's pause); the foot is the rest. Each holds the least
   * opacity its own inks need. Below the foot's lowest word it clears over
   * all the room left (no margin: the held opacity already covers that word's
   * whole line box), so the hand-over to the page is as long and soft as the
   * layout allows.
   */
  function fitScrims(root: HTMLElement): boolean {
    const ground = rgba(
      getComputedStyle(root).getPropertyValue('--color-background')
    );
    if (!ground) return false;
    // An earlier fit's lifts and own poles come off FIRST, before any colour
    // is read, so every colour is the brand's as it set it. Read after them,
    // the last fit's lift counted as the brand's colour and each fit drew a
    // new tint, creeping toward black (review, 2026-11-21).
    for (const node of root.querySelectorAll<HTMLElement>(
      '[data-lifted], [data-own-pole]'
    )) {
      node.style.removeProperty('color');
      node.style.removeProperty('--_ring-tint');
      node.style.removeProperty('--_halo');
      node.style.removeProperty('--_ring2');
      node.style.removeProperty('--_soft');
      delete node.dataset.lifted;
      delete node.dataset.ownPole;
    }
    // The first paint's pole ink (until `data-fit`) stands aside while the
    // fit reads the brand's colours: within this task, so never painted.
    root.dataset.fitting = '';
    try {
      // A colour easing back from its lift reads as the lift (a transition's
      // start value), which the fit would take for the brand's (review R1).
      // The reel's words ease no colour; should one ever, it lands here at
      // once, so every colour read is the brand's own. `getAnimations`
      // flushes style, so the ease the removal starts is listed (Chrome,
      // calibrated 2026-11-21); jsdom has no Web Animations. Only the words
      // the fit reads: a theatre's hover or the film layer's ease, inside the
      // same reel, keeps its own 100 ms (wp4-review r3).
      for (const node of root.querySelectorAll<HTMLElement>(
        `${SCRIMMED}, :is(${SCRIMMED}) *`
      )) {
        for (const motion of node.getAnimations?.() ?? []) {
          if (easesColour(motion)) motion.finish();
        }
      }
      solveScrims(root, ground.rgb);
    } finally {
      delete root.dataset.fitting;
    }
    return true;
  }
  function solveScrims(root: HTMLElement, ground: Rgb) {
    const edge = source.edge();
    const box = root.getBoundingClientRect();
    const laid = [...root.querySelectorAll<HTMLElement>(SCRIMMED)]
      // In 'shadow', each word judged where its glyphs sit (`glyphBox`, review
      // R4), never its block's far end. In 'outline' by its box: the ring and
      // its halo reach past the glyphs, and judged by them alone the index's
      // "02" fell short (4.47:1 on OBB). A control by its own box, which its
      // fill covers.
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          el,
          r,
          glyphs: el.matches(FILLED) || edge === 'outline' ? r : glyphBox(el),
        };
      })
      // Out of sight (the screen readers' name) or not laid out.
      .filter(({ r }) => r.width > 1 && r.height > 1);
    const inHeader = (el: HTMLElement) => el.closest('.reel__top') !== null;
    // The header bar's own box, laid out even when it shows no words (Name
    // on a phone), so the pause above it still counts as the header's.
    const bar = root.querySelector('.reel__top')?.getBoundingClientRect();
    const headerFoot = Math.max(
      0,
      bar && bar.height > 1 ? bar.bottom - box.top : 0,
      ...laid
        .filter(({ el }) => inHeader(el))
        .map(({ r }) => r.bottom - box.top)
    );
    // A box as fractions of the reel's.
    const span = (r: GlyphBox) => ({
      left: (r.left - box.left) / box.width,
      top: (r.top - box.top) / box.height,
      right: (r.right - box.left) / box.width,
      bottom: (r.bottom - box.top) / box.height,
    });
    // Each word's ink, with the most it may need where its glyphs sit
    // (`wordRoom`, review r3 n1, n3); a control's fill has the scrim's cap.
    const allInks: { ink: Ink; ratio: number; room?: number }[] = [];
    let top = 0;
    let foot = 0;
    let gap = box.height;
    for (const { el, r, glyphs } of laid) {
      const header = inHeader(el) || r.bottom - box.top <= headerFoot;
      const ink = rgba(getComputedStyle(el).color);
      if (ink) {
        const room = el.matches(FILLED)
          ? undefined
          : wordRoom(edge, span(glyphs));
        allInks.push({ ink, ratio: ratioOf(el), room });
      }
      if (header) top = Math.max(top, r.bottom - box.top);
      else {
        foot = Math.max(foot, box.bottom - r.top);
        gap = Math.min(gap, box.bottom - r.bottom);
      }
    }
    // The veil's pole from the ground alone, by the switch CSS draws the first
    // paint with (`--_light`: `--_gy`, 0 when unset, at the 0.1791 pivot):
    // a dark brand keeps a dark veil whatever its inks are (owner,
    // 2026-11-21), and every colour that fails is lifted toward white.
    const groundY = Number.parseFloat(
      getComputedStyle(root).getPropertyValue('--_gy')
    );
    const { veil, ink: pole } = groundPoles(
      Number.isFinite(groundY) ? groundY : 0
    );
    // Whole channels, as CSS will paint them: the alpha is solved for these.
    // A colour no scrim of the veil's pole can carry (a player text the
    // creator set, as #CB213C on #0F0000) is lifted below toward `pole`, or
    // ringed in its own: `scrimTint` solves it as that pole.
    const [r, g, b] = scrimTint(ground, veil, allInks, pole);
    const tint: Rgb = [Math.round(r), Math.round(g), Math.round(b)];
    root.style.setProperty('--_scrim', `rgb(${tint.join(' ')})`);
    // Each scrimmed thing's own need (`scrimAlpha` for its COMPUTED ink, with
    // FLOOR_MARGIN; a brand colour is solved as it is, never as an assumed
    // white or dark), over its glyphs. Null: no scrim of the tint can carry it.
    // A colour that cannot keep its floor where it sits is lifted toward the
    // ink pole opposite the veil (`pole`: white over a dark brand's), a
    // twentieth at a time, just far enough, over the footage only
    // (owner, 2026-11-20); never toward the reel's own ink, which a creator
    // may set to that very colour (review, 2026-11-21). What it must pass:
    // in 'shadow', a shade must carry it; a control's own fill carries any
    // colour a scrim of the tint carries by MAX_SCRIM_ALPHA; in 'outline', a
    // word no scrim carries keeps its colour inside a ring of its own pole,
    // so it needs only a ring that can. Each group of words glows softly in
    // the brand's dark at its strongest word's need (GLOW_SHARE, from the
    // 1 px ring probe), and the corner shades grow only as far as each word
    // still needs past it.
    const carried = (ink: Ink, ratio: number) => {
      const need = scrimAlpha([{ ink, ratio }], tint);
      return need !== null && glowLeaves(need, need) <= SHADE_PEAK_MAX;
    };
    const solvable = (ink: Ink, ratio: number) =>
      scrimAlpha([{ ink, ratio }], tint) !== null;
    // A control's fill may cover the film as far as any scrim may.
    const filled = (ink: Ink, ratio: number) => {
      const need = scrimAlpha([{ ink, ratio }], tint);
      return need !== null && need <= MAX_SCRIM_ALPHA;
    };
    const ringed = (ink: Ink, ratio: number, under: number) =>
      solvable(ink, ratio) ||
      outlineAlpha({ ink, ratio }, under, tint, ownPole([{ ink, ratio }])) !==
        null;
    const roles = laid.flatMap(({ el, glyphs }) => {
      // Its own ink and any child's in another (the kicker's number), so the
      // strictest of them is solved.
      const ratio = ratioOf(el);
      const fill = el.matches(FILLED);
      const at = span(glyphs);
      const drawn = shadeFloor(at, SHADES);
      const fits = (ink: Ink) =>
        fill
          ? filled(ink, ratio)
          : edge === 'shadow'
            ? carried(ink, ratio)
            : ringed(ink, ratio, drawn);
      const nodes = [el, ...el.querySelectorAll<HTMLElement>('*')].flatMap(
        (node) => {
          const ink = rgba(getComputedStyle(node).color);
          return ink ? [{ node, ink }] : [];
        }
      );
      if (nodes.length === 0) return [];
      // The nodes that cannot pass as they are: the ones a lift moves, from
      // the least step that passes each, or the pole itself.
      const lifted = nodes.filter(({ ink }) => !fits(ink));
      let step = 0;
      for (const { ink } of lifted)
        step = Math.max(step, liftStep(ink, pole, fits) ?? 20);
      return [{ el, span: at, ratio, fill, nodes, lifted, step }];
    });
    type Role = (typeof roles)[number];
    const inksOf = (role: Role) =>
      role.nodes.map(({ ink }) => ({
        ink: role.lifted.some((l) => l.ink === ink)
          ? { rgb: over(pole, role.step / 20, ink.rgb), alpha: ink.alpha }
          : ink,
        ratio: role.ratio,
      }));
    const needOf = (role: Role) => scrimAlpha(inksOf(role), tint);
    const groupOf = (el: HTMLElement) => el.closest<HTMLElement>(GROUPED) ?? el;
    let shades: readonly Shade[] = SHADES;
    const glows = new Map<HTMLElement, number>();
    // A word short where it sits, of what is drawn under it: in 'shadow', its
    // shades with its group's glow (a shade that falls short is no solve,
    // review R4); in 'outline', its ring, which past solid lays less than its
    // need asks (`ringCarries`, review r5).
    const short = (role: Role) => {
      const need = needOf(role);
      if (need === null || role.fill) return false;
      const under = shadeFloor(role.span, shades);
      if (edge === 'outline') return !ringCarries(need, under);
      return glowLeaves(need, glows.get(groupOf(role.el)) ?? 0) > under + 1e-9;
    };
    for (let round = 0; round <= 20; round++) {
      glows.clear();
      for (const role of roles) {
        const need = needOf(role);
        if (role.fill || need === null) continue;
        const group = groupOf(role.el);
        glows.set(group, Math.max(glows.get(group) ?? 0, need));
      }
      if (edge === 'outline') {
        // No shade grows in 'outline': a word short of its ring lifts its
        // failing nodes one step further, a twentieth at a time, as one short
        // of its shades does below.
        const further = roles.flatMap((role) => {
          if (role.step >= 20 || !short(role)) return [];
          const under = shadeFloor(role.span, shades);
          role.lifted = liftedNodes(role.nodes, role.lifted, (ink) => {
            const need = scrimAlpha([{ ink, ratio: role.ratio }], tint);
            return need === null || !ringCarries(need, under);
          });
          return role.lifted.length > 0 ? [role] : [];
        });
        if (further.length === 0) break;
        for (const role of further) role.step += 1;
        continue;
      }
      const asked = new Map<Need, Role>();
      for (const role of roles) {
        const need = needOf(role);
        if (role.fill || need === null) continue;
        const left = glowLeaves(need, glows.get(groupOf(role.el)) ?? 0);
        if (left <= SHADE_PEAK_MAX)
          asked.set({ span: role.span, need: left }, role);
      }
      // A word its carrier leaves short takes a second, bounded so the
      // header still reads as a shadow from each side (`secondCarrier`; a
      // phone's top-bar name, 2026-11-22).
      const needs = [...asked.keys()];
      const grown = secondCarrier(needs, growShades(needs).shades);
      shades = grown.shades;
      // A word still short where it sits: one step further, and again. A
      // colour carried as it is but short here (review r3 M1) starts at its
      // failing nodes, from step 0, a twentieth at a time like any lift;
      // only one still short at the pole itself wears it outright (below).
      const further = grown.short.flatMap((n) => {
        const role = asked.get(n);
        if (!role || role.step >= 20) return [];
        // Its failing nodes taken again each round, with those it already
        // lifts (review r4 LOW): as a lift lowers one node's need, the
        // group's glow can fall and a node that passed turn short.
        const under = shadeFloor(role.span, shades);
        const glow = glows.get(groupOf(role.el)) ?? 0;
        role.lifted = liftedNodes(role.nodes, role.lifted, (ink) => {
          const need = scrimAlpha([{ ink, ratio: role.ratio }], tint);
          return need === null || glowLeaves(need, glow) > under + 1e-9;
        });
        return role.lifted.length > 0 ? [role] : [];
      });
      if (further.length === 0) break;
      for (const role of further) role.step += 1;
    }
    // Checked, never assumed: every role must now have a solved need that
    // what is drawn under it meets (never `short`), or, in 'outline', a ring
    // of its own pole that carries it. One that does not wears the pole
    // outright; one the pole cannot rescue either is reported.
    const solved = (role: Role) => {
      if (needOf(role) !== null) return !short(role);
      if (role.fill || edge === 'shadow') return false;
      const under = shadeFloor(role.span, shades);
      const inks = inksOf(role);
      const own = ownPole(inks);
      return inks.every((ink) => outlineAlpha(ink, under, tint, own) !== null);
    };
    const unrescued: string[] = [];
    for (const role of roles) {
      if (solved(role)) continue;
      role.lifted = role.nodes;
      role.step = 20;
      if (!solved(role)) unrescued.push(role.el.className);
    }
    // Once per shortfall a page load (review R6): every fit of it would say
    // the same. Keyed on the roles too, so a later fit under the same tint
    // that leaves a different role short says so (wp4-review r6 L1).
    const brand = tint.join(' ');
    const shortRoles = unrescued.join(' | ');
    const shortfall = `${brand} ${shortRoles}`;
    if (unrescued.length > 0 && !warnedShortfalls.has(shortfall)) {
      warnedShortfalls.add(shortfall);
      logger.warn(
        'Showreel: inks the reel cannot carry over every frame, even in its pole',
        {
          tint: brand,
          edge,
          roles: shortRoles,
        }
      );
    }
    drawShades(root, shades);
    for (const role of roles) {
      for (const { node, ink } of role.lifted) {
        const [lr, lg, lb] = over(pole, role.step / 20, ink.rgb).map(
          Math.round
        );
        node.style.setProperty(
          'color',
          `rgb(${lr} ${lg} ${lb} / ${ink.alpha})`,
          'important'
        );
        node.dataset.lifted = '';
      }
    }
    // A control's fill, exactly what its label still needs. In 'outline', one
    // strength per group (its strongest word's), so each group reads as one
    // block; a word no scrim of the tint can carry (red on a dark brand)
    // keeps its colour and is outlined in its own pole instead.
    const groups = new Map<HTMLElement, number>();
    let pool = 0;
    for (const role of roles) {
      const { el, span: at, fill } = role;
      const inks = inksOf(role);
      const need = needOf(role);
      const under = shadeFloor(at, shades);
      if (need !== null) pool = Math.max(pool, need);
      if (fill) {
        el.style.setProperty('--_halo', String(haloAlpha(need ?? 1, under)));
        continue;
      }
      if (edge !== 'outline') continue;
      if (need === null) {
        const own = ownPole(inks);
        const alpha = Math.max(
          ...inks.map((ink) => outlineAlpha(ink, under, tint, own) ?? 1)
        );
        el.style.setProperty('--_ring-tint', `rgb(${own.join(' ')})`);
        el.style.setProperty('--_halo', String(alpha));
        // Its own pole stays close to its glyphs: a second solid ring and no
        // soft glow, so a pale ring never washes the white words beside it.
        el.style.setProperty('--_ring2', '1');
        el.style.setProperty('--_soft', '0');
        el.dataset.ownPole = '';
        continue;
      }
      const group = groupOf(el);
      // Its ring at the solved halo and RING_MARGIN more (review r4 "02").
      groups.set(
        group,
        Math.max(groups.get(group) ?? 0, ringHalo(need, under))
      );
    }
    // The most any word needs, after its lift: what a word not yet fitted
    // holds meanwhile. Never a solid scrim taken for a colour the lift rescued.
    root.style.setProperty('--_pool', String(pool));
    for (const [group, halo] of groups)
      group.style.setProperty('--_halo', String(halo));
    for (const [group, glow] of glows)
      group.style.setProperty('--_glow', String(glow));
    // The ring from the brand's focus colour as the page has it (the
    // parent's: the reel's own is this one), and the reel's ink. It is drawn
    // on its own band of the solid scrim (the focus rule's box-shadow), so
    // that is what it keeps 3:1 against, whatever the frame.
    const focus = rgba(
      getComputedStyle(root.parentElement ?? root).getPropertyValue(
        '--color-focus'
      )
    );
    const ink = rgba(getComputedStyle(root).color);
    if (focus && ink) {
      const ring = focusInk(focus.rgb, ink.rgb, tint, 1).map(Math.round);
      root.style.setProperty('--color-focus', `rgb(${ring.join(' ')})`);
    }
    root.style.setProperty(
      '--_top-reach',
      `${Math.ceil(top + SCRIM_MARGIN)}px`
    );
    root.style.setProperty(
      '--_foot-reach',
      `${Math.ceil(foot + SCRIM_MARGIN)}px`
    );
    root.style.setProperty(
      '--_foot-clear',
      `${Math.max(0, Math.floor(gap))}px`
    );
  }
  // Again for each piece (its words differ), on a resize, once the fonts are
  // in, when a failed logo's stand-in shows (a word the header's shade must
  // carry), and whenever the inks may have turned: the theme toggled, or the
  // brand repainted in place (the editor's live preview, hydration's own
  // brand). Once a frame at most, however many arrive in it.
  $effect(() => {
    const root = source.root();
    void source.layout();
    void source.peek();
    void source.shown();
    void source.edge();
    void source.showsStandIn();
    void themeState.theme;
    if (!root) return;
    let live = true;
    let frame = 0;
    // `data-fit`: a fit has run since the fonts were in (what a probe waits on).
    let fontsIn = !document.fonts;
    const refit = () => {
      if (!live || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!live) return;
        if (fitScrims(root) && fontsIn) root.dataset.fit = '';
      });
    };
    void tick().then(refit);
    void document.fonts?.ready.then(() => {
      fontsIn = true;
      refit();
    });
    // `ready` is one promise, and it can resolve before a face has begun to
    // load (a fast hydration beats the webfont). A face that lands later moves
    // the words the fit measured: fit again whenever one does (2026-11-21).
    document.fonts?.addEventListener('loadingdone', refit);
    const resized = new ResizeObserver(refit);
    resized.observe(root);
    const restyled = new MutationObserver(refit);
    const brand = root.closest('[data-org-brand]');
    if (brand)
      restyled.observe(brand, {
        attributes: true,
        attributeFilter: ['style', 'class'],
      });
    // A colour still easing (a link's `--transition-colors`) reads as its
    // in-between value: measure again once it has landed. Never for a lift's
    // own ease, which the fit lands itself (`fitScrims`): fitting again on
    // it, every fit's lift would ask for the next one (review R1).
    const landed = (event: TransitionEvent) => {
      if (event.propertyName !== 'color') return;
      if (
        event.target instanceof Element &&
        event.target.closest('[data-lifted]')
      )
        return;
      refit();
    };
    root.addEventListener('transitionend', landed);
    return () => {
      live = false;
      cancelAnimationFrame(frame);
      document.fonts?.removeEventListener('loadingdone', refit);
      resized.disconnect();
      restyled.disconnect();
      root.removeEventListener('transitionend', landed);
    };
  });
}
