/**
 * The Showreel's motion, frame by frame: the four motion settings, turned into
 * the values the window's shader draws the film with.
 *
 * The hero's settings name one effect per axis (`reel-trans`, `reel-pointer`,
 * `reel-opening`, `reel-film`: `motionChoice`). The compositor composes the
 * film pass for that choice (`composeFilmPass`, through `createFilmMotionPasses`),
 * after the phone, reduced-motion and no-name fallbacks, and writes what it
 * runs back as `FilmMotion.running`. This driver moves the motion uniforms
 * for what RUNS, never for what was chosen, so a fallback never animates a
 * value no pass reads, or holds one a pass does read:
 *
 *   between pieces  the cut (`RevealClock`): `u_reveal`, `u_cut`, and the
 *                   piece the stage shows, which changes at the cut's bottom
 *   the pointer     its trail (`PointerTrail`): `u_trail` in the running
 *                   style, `u_pointerOn`; smoke with inertia drifts on
 *   the opening     through the name, once the canvas shows the film
 *                   (`openingAt`)
 *   into the film   while the film plays (`intoAt`), and back (`leaveAt`)
 *
 * PURE but for its own state: time is handed in, the GL is the compositor's,
 * and the Showreel's hook (`reel-motion.svelte.ts`) runs the frames.
 */
import type { FilmFrameId } from '$lib/components/ui/ShaderHero/compositor/effects/ids';
import type {
  IntoId,
  MotionChoice,
} from '$lib/components/ui/ShaderHero/compositor/effects/motion-ids';
import { restMotion } from '$lib/components/ui/ShaderHero/compositor/effects/motion-uniforms';
import type { FilmMotion } from '$lib/components/ui/ShaderHero/compositor/film-motion';
import { NAME_FADE_PX } from '$lib/components/ui/ShaderHero/compositor/stage';
import type { HeroOptions } from '../hero-config';
import {
  deepestPoint,
  diveDepth,
  type MaskPixels,
  type NamePoint,
} from './deepest-point';
import {
  intoAt,
  intoLength,
  LEAVE_MS,
  leaveAt,
  type NameFrame,
  openingAt,
} from './name-motion';
import { CUT_TIMING, REDUCED_CUT_TIMING, RevealClock } from './reel-reveal';
import { PHONE_TRAIL_POINTS, PointerTrail, SwipeGate } from './reel-trail';

/** The hero's four motion settings. */
export type MotionSettings = Pick<
  HeroOptions,
  'reel-trans' | 'reel-pointer' | 'reel-opening' | 'reel-film'
>;

/** The motion the hero's settings choose, one effect per axis. PURE. */
export function motionChoice(options: MotionSettings): MotionChoice {
  return {
    trans: options['reel-trans'],
    pointer: options['reel-pointer'],
    opening: options['reel-opening'],
    into: options['reel-film'],
  };
}

const sameChoice = (a: MotionChoice, b: MotionChoice) =>
  a.trans === b.trans &&
  a.pointer === b.pointer &&
  a.opening === b.opening &&
  a.into === b.into;

const sameKeys = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((key, i) => key === b[i]);

export interface ReelMotionSetup {
  /** The four motion settings (`motionChoice`). */
  readonly choice: MotionChoice;
  /** The Showreel's film frame: its layout's. */
  readonly frame: FilmFrameId;
  /** Under 768 CSS px wide: fewer trail points. */
  readonly phone: boolean;
  readonly reducedMotion: boolean;
  /** The reel moves on by itself (not the static path), so it may open. */
  readonly moves: boolean;
}

export interface ReelMotionOptions {
  /** A small copy of the org's name mask, for where a dive falls in. */
  readonly maskPixels?: () => MaskPixels | null;
}

/** A trail with a phone's fewer points, or the full set. */
const trailFor = (phone: boolean) =>
  new PointerTrail(phone ? PHONE_TRAIL_POINTS : undefined);

/** The name at rest: as drawn, all of it, no dive. */
const NAME_REST: NameFrame = { zoom: 1, alpha: 1, weight: 0, dive: 0 };

/**
 * How long an opening waits for the pass to say what it runs
 * (`FilmMotion.running` still null: a new choice the compositor has not
 * drawn yet). Its frames meanwhile make a frozen hero draw, so the pass
 * says within a frame or two; past this it never will (no film pass at
 * all), and the letters show at rest.
 */
export const OPEN_DEFER_MS = 1000;

export class ReelMotion {
  #motion: FilmMotion;
  #setup: ReelMotionSetup;
  #trail: PointerTrail;
  readonly #swipe = new SwipeGate();
  readonly #reveal = new RevealClock(0);
  readonly #maskPixels: () => MaskPixels | null;

  /** The reel's entries, by key, as the cuts were last told them. */
  #keys: readonly string[] = [];
  /** The piece the stage shows (it changes at a cut's bottom). */
  #stage = 0;
  #paused = false;

  /**
   * The opening is due: until it starts (or turns out not to run) the
   * letters stay dark, so the film never shows in them for a frame first.
   */
  #openingDue = false;
  #openingFrom: number | null = null;
  /** The canvas showed the film, or the film opened: once a visit. */
  #opened = false;
  /** The canvas showed the film while the pass had not said what it runs. */
  #openWaitFrom: number | null = null;
  #openAspect = 1;
  /** The opening holds the reel's words back (`wordsHeld`). */
  #wordsHeld = false;

  #intoFrom: number | null = null;
  #intoKind: IntoId | null = null;
  #leaveFrom: number | null = null;
  #point: NamePoint | null = null;
  #depth = 1;

  constructor(setup: ReelMotionSetup, options: ReelMotionOptions = {}) {
    this.#setup = setup;
    this.#motion = {
      choice: setup.choice,
      values: restMotion(),
      running: null,
    };
    this.#trail = trailFor(setup.phone);
    this.#maskPixels = options.maskPixels ?? (() => null);
    this.#apply(setup);
  }

  /** What the window's shader draws the film with (`showreelFeed.setMotion`). */
  get motion(): FilmMotion {
    return this.#motion;
  }

  /** The piece the stage shows: it changes at the bottom of each cut. */
  get stage(): number {
    return this.#stage;
  }

  /**
   * The key of the piece the stage shows, or null before the first `follow`.
   * A page holding it finds the piece's place in a refreshed reel itself,
   * before this driver hears of the refresh.
   */
  get stageKey(): string | null {
    return this.#keys[this.#stage] ?? null;
  }

  /**
   * The opening holds the reel's words, its bar and its shades back: while it
   * is due, and once it runs until its words come in (`wordsIn`), so the
   * letters open on their own. Read after each frame.
   */
  get wordsHeld(): boolean {
    return this.#wordsHeld;
  }

  /**
   * New settings or circumstances. A new choice is a new `FilmMotion` (the
   * compositor composes its pass); its values carry on. A phone's change of
   * side gets a trail with its own number of points.
   */
  configure(setup: ReelMotionSetup): void {
    const was = this.#setup;
    this.#setup = setup;
    if (!sameChoice(was.choice, setup.choice)) {
      this.#motion = {
        choice: setup.choice,
        values: this.#motion.values,
        running: null,
      };
    }
    if (was.phone !== setup.phone) {
      this.#trail.clear();
      this.#trail = trailFor(setup.phone);
    }
    this.#apply(setup);
  }

  /** The opening and the way in dive through the name (Corner and Wide). */
  get #dives(): boolean {
    return this.#setup.frame !== 'film-name';
  }

  #apply(setup: ReelMotionSetup): void {
    this.#trail.motion = setup.reducedMotion ? 'still' : 'drift';
    this.#reveal.timing = setup.reducedMotion ? REDUCED_CUT_TIMING : CUT_TIMING;
    // Before the canvas shows the film, or while the opening waits for its
    // pass: once it has started, or been ruled out, never again.
    const mayOpen =
      (!this.#opened || this.#openWaitFrom !== null) &&
      setup.choice.opening === 'name' &&
      setup.moves &&
      !setup.reducedMotion;
    this.#openingDue = mayOpen && this.#openingFrom === null;
  }

  /** Aim a dive: the name's deepest point, and how deep to go for `aspect`. */
  #aimDive(aspect: number): void {
    const mask = this.#maskPixels();
    this.#point = mask ? deepestPoint(mask) : null;
    this.#depth = this.#point ? diveDepth(this.#point, aspect) : 1;
  }

  /**
   * The reel's entries and the one the clock is on. A refresh that moves the
   * entry on show (a piece added before it) shows it at its new place with
   * no cut; any other change of piece is a cut. While the reel is paused, a
   * piece picked from the index shows at once: the visitor stopped the
   * motion, not their own choice (a cut held at its start would leave the
   * words on the new piece over the old one's picture until play).
   */
  follow(keys: readonly string[], index: number, now: number): void {
    if (!sameKeys(keys, this.#keys)) {
      const onStage = this.#keys[this.#stage];
      this.#keys = [...keys];
      const at = onStage === undefined ? -1 : keys.indexOf(onStage);
      const to = at >= 0 ? at : index;
      if (to !== this.#stage || onStage === undefined) {
        this.#reveal.jump(to);
        this.#stage = to;
      }
    }
    if (this.#paused) {
      this.#reveal.jump(index);
      this.#stage = index;
      return;
    }
    this.#reveal.cut(index, now);
  }

  /**
   * The reel paused: its pause, a press held, the hero off screen. A cut under
   * way ends at once on the piece it was going to, a pick waiting in its rise
   * included, as a pick made while paused shows at once (`follow`). The visitor
   * stopped the motion, and the words, which come in with their piece's
   * picture, must never wait out a pause hidden, their film button reachable by
   * Tab but unseen (WCAG 2.2.2, 2.4.7).
   */
  pause(now: number): void {
    this.#paused = true;
    const to = this.#reveal.headingTo(now);
    this.#reveal.jump(to);
    this.#stage = to;
    this.#reveal.pause(now);
  }

  play(now: number): void {
    this.#paused = false;
    this.#reveal.play(now);
  }

  /** A mouse or pen over the reel, at (x, y) in output uv. */
  pointerMove(x: number, y: number, now: number, aspect: number): void {
    this.#trail.move(x, y, now, aspect);
  }

  pointerLeave(now: number): void {
    this.#trail.leave(now);
  }

  /** A touch went down at (px, py), CSS px. */
  touchDown(px: number, py: number): void {
    this.#swipe.down(px, py);
  }

  /**
   * A touch moved: it drives the pointer effect only once its gesture is
   * sideways (`SwipeGate`); a vertical swipe stays the page's scroll.
   */
  touchMove(
    px: number,
    py: number,
    x: number,
    y: number,
    now: number,
    aspect: number
  ): void {
    if (this.#swipe.move(px, py)) this.#trail.move(x, y, now, aspect);
  }

  /** The touch lifted: a flick of smoke carries on. */
  touchUp(now: number): void {
    this.#swipe.up();
    this.#trail.leave(now);
  }

  /**
   * The canvas shows the film for the first time: the opening starts, when
   * one is due and the pass runs it; otherwise the letters show at once.
   * One shot a visit, whatever the choice is now: an opening chosen later
   * (the editor's live preview) never holds the letters dark, the canvas
   * having shown the film already. While the pass has not said what it
   * runs, the opening waits for it (`OPEN_DEFER_MS` at most), never ruled
   * out on a null. On the Corner and Wide layouts it dives through the
   * name, deep enough for the letter to cover the `aspect`-wide output.
   */
  open(now: number, aspect: number): void {
    if (this.#opened) return;
    this.#opened = true;
    if (!this.#openingDue) return;
    this.#openWaitFrom = now;
    this.#openAspect = aspect;
    this.#settleOpening(now);
  }

  /** The opening the canvas asked for, once the pass says what it runs. */
  #settleOpening(now: number): void {
    const from = this.#openWaitFrom;
    if (from === null) return;
    const running = this.#motion.running;
    if (this.#openingDue && running === null && now - from < OPEN_DEFER_MS)
      return;
    this.#openWaitFrom = null;
    const runs = this.#openingDue && running?.opening === 'name';
    this.#openingDue = false;
    if (!runs) return;
    this.#openingFrom = now;
    if (this.#dives) this.#aimDive(this.#openAspect);
  }

  /**
   * The film opened (in the hero or the phone's pop-up): the way into it runs.
   * Through the name, the dive falls into the name's thickest stroke, deep
   * enough for the letter to cover the `aspect`-wide output. `scrolled` past
   * the letters' fade (`NAME_FADE_PX`), there are no letters to dive through,
   * and the canvas holds them where the page sat at the top: it starts where
   * the film fills its stage.
   */
  enterFilm(now: number, aspect: number, scrolled = false): void {
    const kind = this.#motion.running?.into ?? null;
    const straight = kind === 'name' && scrolled;
    this.#intoFrom = straight
      ? now - intoLength('name', this.#setup.frame)
      : now;
    this.#intoKind = kind;
    this.#leaveFrom = null;
    // The opening gives way to the film.
    this.#endOpening();
    if (kind === 'name' && !straight) this.#aimDive(aspect);
  }

  /**
   * The page scrolled to `y`. Past the letters' fade (`NAME_FADE_PX`) there
   * are no letters to open through, so an opening running, or waiting to
   * run, ends at once in its last frame: the film filling its stage, with no
   * dive, as a film pressed there starts. Back under the fade nothing
   * restarts: the opening is one shot a visit. True when that changes what
   * is drawn.
   */
  scroll(y: number): boolean {
    if (y < NAME_FADE_PX) return false;
    const ended = this.#openingFrom !== null || this.#openingDue;
    this.#endOpening();
    return ended;
  }

  /** No opening, now or later this visit. */
  #endOpening(): void {
    this.#openingFrom = null;
    this.#openingDue = false;
    this.#openWaitFrom = null;
    this.#opened = true;
    this.#wordsHeld = false;
  }

  /** The film closed: the band and the letters come back. */
  leaveFilm(now: number): void {
    if (this.#intoFrom === null) return;
    this.#intoFrom = null;
    this.#intoKind = null;
    this.#leaveFrom = now;
  }

  /**
   * Write this frame's values into `motion.values`. True while something
   * still moves, so the loop asks for another frame.
   */
  frame(now: number): boolean {
    const v = this.#motion.values;
    const running = this.#motion.running;

    const cut = this.#reveal.at(now);
    v.u_reveal = cut.reveal;
    v.u_cut = cut.cuts;
    this.#stage = cut.shown;
    // Frames while a cut is due, not only while its picture moves: the first
    // frame after a pick can read it still in full (that frame began before
    // the pick was made), and stopping there leaves the stage on the last
    // piece, its words never coming in.
    let busy = !this.#paused && this.#reveal.cutting(now);

    const pointer = running?.pointer;
    if (pointer === 'liquid' || pointer === 'smoke') {
      this.#trail.pack(now, pointer, v.u_trail);
      busy = this.#trail.active(now) || busy;
    } else {
      v.u_trail.fill(0);
    }
    v.u_pointerOn = this.#trail.pointer ? 1 : 0;

    return this.#name(now) || busy;
  }

  /** The name's values, the way in and the opening. True while they move. */
  #name(now: number): boolean {
    const v = this.#motion.values;
    const frame = this.#setup.frame;
    this.#settleOpening(now);
    v.u_nameCentre = this.#point ? [this.#point.x, this.#point.y] : [0.5, 0.5];

    if (this.#intoFrom !== null && this.#intoKind !== null) {
      const into = intoAt(
        now - this.#intoFrom,
        this.#intoKind,
        frame,
        this.#depth
      );
      this.#setName(into);
      v.u_into = into.into;
      v.u_fill = into.fill;
      // Past the hand-off it holds: the film fills its stage.
      return !into.handOff;
    }
    v.u_into = 0;
    let busy = false;
    if (this.#leaveFrom !== null) {
      const ms = now - this.#leaveFrom;
      v.u_fill = leaveAt(ms);
      if (ms >= LEAVE_MS) this.#leaveFrom = null;
      else busy = true;
    } else {
      v.u_fill = 0;
    }

    if (this.#openingFrom !== null) {
      if (this.#motion.running?.opening !== 'name') {
        // The pass stopped running it (reduced motion, the mask went).
        this.#openingFrom = null;
      } else {
        const opening = openingAt(
          now - this.#openingFrom,
          this.#dives,
          this.#depth
        );
        if (opening.done) this.#openingFrom = null;
        else {
          this.#wordsHeld = !opening.wordsIn;
          this.#setName(opening);
          return true;
        }
      }
    }
    this.#wordsHeld = this.#openingDue;
    // Waiting to open: the opening's own first frame, so it starts from
    // exactly what shows (the letters dark, the film already held to them).
    this.#setName(
      this.#openingDue ? openingAt(0, this.#dives, this.#depth) : NAME_REST
    );
    // Waiting for the pass: frames, so a frozen hero draws and it says.
    return busy || this.#openWaitFrom !== null;
  }

  #setName(name: NameFrame): void {
    const v = this.#motion.values;
    v.u_nameZoom = name.zoom;
    v.u_nameAlpha = name.alpha;
    v.u_nameWeight = name.weight;
    v.u_dive = name.dive;
  }
}
