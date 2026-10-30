/**
 * Which film a press plays (owner P10, "Full film unless it's paid"), for
 * every film a visitor starts with a press: a sales page's (`film-source.ts`
 * in the page kit) and the org landing's intro film.
 *
 * The full film when there is one to ask for (`ask`); the 30-second preview
 * otherwise, and whenever asking fails — a `null` (the film may not play in
 * full), a rejection, an empty address, or a throw. The visitor pressed
 * play: they always get a film, when there is a preview to fall back on.
 *
 * A film offered in full may have NO preview (an intro film with no
 * `previewUrl`). Then a failed ask has nothing to play, and the source
 * REJECTS, so the player shows its error at once (`begin` fails on a
 * rejected source): never a made-up address, which hls.js would load (the
 * page itself) as a playlist.
 *
 * Called in the press's own tick and handed to the player as it mounts, so
 * the player's `play()` unlocks the `<video>` before anything awaits the
 * answer (`start.ts`). Nothing is asked on page load.
 */

/** A full film's signed stream, and when its links run out (ISO), if known. */
export interface SignedStream {
  playlistUrl: string;
  expiresAt?: string;
}

/** The preview's address, or the full film once the page answers. */
export type PressSource = string | Promise<string | SignedStream>;

/** How a press asks for the full film; `null` when it may not play in full. */
export type AskForFull = () => Promise<SignedStream | null>;

/** Why a source with neither a full film nor a preview rejects. */
const NO_FILM = 'No full film and no preview to play';

export function pressSource(
  preview: string | null,
  ask: AskForFull | undefined
): PressSource {
  // The preview, or the rejection that says there is nothing to play.
  const fallback = (): string | Promise<never> =>
    preview ?? Promise.reject(new Error(NO_FILM));
  if (!ask) return fallback();
  try {
    return ask().then(
      (full) => (full?.playlistUrl ? full : fallback()),
      fallback
    );
  } catch {
    return fallback();
  }
}

/**
 * How a playing full film asks again as its links run out (the player's
 * RENEWAL): the same question, settled, so a rejection or a throw answers
 * `null` and the film ends where it stands. `undefined` when no full film
 * can be asked for: a preview is public and never renewed.
 */
export function pressRenewal(
  ask: AskForFull | undefined
): AskForFull | undefined {
  if (!ask) return undefined;
  return async () => {
    try {
      return await ask();
    } catch {
      return null;
    }
  };
}
