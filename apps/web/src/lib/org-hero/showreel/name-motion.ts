/**
 * The reel's timed motion: the opening through the name, and the way into the
 * film. Each is a pure function of the time since it began, giving the motion
 * uniforms it moves (the rest stay at `restMotion`), so every moment is under
 * test.
 *
 * The dives follow the letter-dive research: a zoom of constant speed,
 * `zoom = depth ^ p`, with `p` easing in, never longer than 900 ms.
 */
import type { FilmFrameId } from '$lib/components/ui/ShaderHero/compositor/effects/ids';
import type { IntoId } from '$lib/components/ui/ShaderHero/compositor/effects/motion-ids';
import { easeIn, easeInOut, easeOut, through } from './reel-ease';

/** The name's uniforms, and how far into the film. */
export interface NameFrame {
  /** `u_nameZoom` */
  readonly zoom: number;
  /** `u_nameAlpha` */
  readonly alpha: number;
  /** `u_nameWeight` (the Corner and Wide layouts only read it). */
  readonly weight: number;
  /** `u_dive` */
  readonly dive: number;
}

export interface OpeningFrame extends NameFrame {
  /** The words come in. */
  readonly wordsIn: boolean;
  /** The opening is over: the reel plays on from its first piece. */
  readonly done: boolean;
}

export interface IntoFrame extends NameFrame {
  /** `u_into` */
  readonly into: number;
  /** `u_fill` */
  readonly fill: number;
  /** The player takes over: it shows from here, over the canvas. */
  readonly handOff: boolean;
}

/** The longest a dive lasts (the research's limit for large motion). */
export const DIVE_MS = 900;
/** The letters fade in. */
const LETTERS_MS = 800;
/** The opening's slow breath before it dives. */
const BREATH_ENDS = 2600;
const BREATH_ZOOM = 1.03;

/** A dive `p` of the way (0-1) from `start` to `depth` zoom. */
function dived(p: number, start: number, depth: number): number {
  return start * (depth / start) ** easeIn(p);
}

/**
 * The opening at `ms`. On the Name layout the film fades into the letters
 * and stays there (`dives` false); on the Corner and Wide layouts it then
 * breathes and dives through the name's thickest stroke into the stage,
 * `depth` deep.
 */
export function openingAt(
  ms: number,
  dives: boolean,
  depth: number
): OpeningFrame {
  const alpha = easeOut(through(ms, 0, LETTERS_MS));
  if (!dives)
    return {
      zoom: 1,
      alpha,
      weight: 1,
      dive: 0,
      wordsIn: ms >= 1100,
      done: ms >= 1300,
    };
  const diveEnds = BREATH_ENDS + DIVE_MS;
  const done = ms >= diveEnds + 400;
  if (done)
    return { zoom: 1, alpha: 1, weight: 0, dive: 0, wordsIn: true, done };
  const breath = 1 + (BREATH_ZOOM - 1) * through(ms, 0, BREATH_ENDS);
  const p = through(ms, BREATH_ENDS, DIVE_MS);
  return {
    zoom: ms < BREATH_ENDS ? breath : dived(p, BREATH_ZOOM, depth),
    alpha,
    // Inside the letter, the name gives way to the stage.
    weight: 1 - easeInOut(through(ms, diveEnds, 400)),
    dive: ms < BREATH_ENDS ? 0 : p,
    wordsIn: ms >= diveEnds + 200,
    done,
  };
}

/** How long each way into the film takes, to the hand-off. */
export function intoLength(kind: IntoId, frame: FilmFrameId): number {
  if (kind === 'name') return frame === 'film-name' ? 150 + DIVE_MS : 1200;
  return kind === 'fade' ? 300 : 1200;
}

/** Where the way into the film turns (the film fills the stage from there). */
const TURN: Record<Exclude<IntoId, 'name'>, number> = {
  smoke: 520,
  liquid: 480,
  fade: 150,
};

/**
 * The way into the film at `ms`, on `frame`. Through the name: on the
 * Corner and Wide layouts the film first draws into the letters; then the
 * dive, `depth` deep. The others rise to their turn, where the film fills
 * the stage, and settle back.
 */
export function intoAt(
  ms: number,
  kind: IntoId,
  frame: FilmFrameId,
  depth: number
): IntoFrame {
  const length = intoLength(kind, frame);
  const handOff = ms >= length;
  if (kind === 'name') {
    const windowed = frame === 'film-name';
    const diveFrom = windowed ? 150 : 400;
    const p = through(ms, diveFrom, length - diveFrom);
    return {
      zoom: dived(p, 1, depth),
      alpha: 1,
      weight: windowed ? 1 : easeOut(through(ms, 0, 300)),
      dive: ms < diveFrom || handOff ? 0 : p,
      into: 0,
      fill: handOff ? 1 : 0,
      handOff,
    };
  }
  const turn = TURN[kind];
  const into =
    ms < turn
      ? easeIn(through(ms, 0, turn))
      : 1 - easeOut(through(ms, turn, length - turn));
  return {
    zoom: 1,
    alpha: 1,
    weight: 0,
    dive: 0,
    into,
    fill: ms >= turn ? 1 : 0,
    handOff,
  };
}

/** How long the film's frame takes to come back when the player closes. */
export const LEAVE_MS = 500;

/** `u_fill` as the player closes, `ms` ago: the band and letters return. */
export function leaveAt(ms: number): number {
  return 1 - easeInOut(through(ms, 0, LEAVE_MS));
}
