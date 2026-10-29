/**
 * Starting a film from a press, with sound (owner P7).
 *
 * A browser lets a page start sound only from a user gesture, and Safari
 * keeps that activation only for a `play()` called in the press's own tick.
 * So the player calls `playNow` as it mounts, BEFORE it awaits anything (the
 * full film's address, hls.js, the manifest), and hands the promise here.
 * That pending play resolves once the stream attaches and the first frames
 * arrive; a browser that refuses sound rejects it with `NotAllowedError`, and
 * the film plays muted instead.
 */

/** How the press's film ended up playing. */
type Started = 'sound' | 'muted' | 'failed';

type Attempt = 'played' | 'refused' | 'failed';

/**
 * `play()`, as a promise every time: jsdom's returns nothing, and an old
 * engine's may throw where a current one rejects.
 */
export function playNow(media: HTMLMediaElement): Promise<void> {
  try {
    return Promise.resolve(media.play());
  } catch (error) {
    return Promise.reject(error);
  }
}

const refused = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'name' in error &&
  error.name === 'NotAllowedError';

async function attempt(play: Promise<void>): Promise<Attempt> {
  try {
    await play;
    return 'played';
  } catch (error) {
    return refused(error) ? 'refused' : 'failed';
  }
}

/**
 * Settle a press's `play()`.
 *
 * - It plays: `sound`.
 * - Sound is refused: muted, and played again — `muted` (the mute button then
 *   reads "Tap for sound").
 * - It failed some other way, most often an `AbortError` when attaching the
 *   stream reset the pending play: the press already unlocked the element,
 *   so it is asked once more, and that answer decides.
 *
 * `wanted` is the visitor's own say: a pause before the film started means
 * it is not played again behind their back.
 */
export async function settleStart(
  media: HTMLMediaElement,
  unlock: Promise<void>,
  wanted: () => boolean
): Promise<Started> {
  let outcome = await attempt(unlock);
  if (outcome === 'failed' && wanted()) outcome = await attempt(playNow(media));
  if (outcome === 'played') return 'sound';
  if (outcome === 'failed' || !wanted()) return 'failed';
  media.muted = true;
  return (await attempt(playNow(media))) === 'played' ? 'muted' : 'failed';
}
