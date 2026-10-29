/**
 * Which film a press plays (owner P10, "Full film unless it's paid"), for
 * every film a visitor starts with a press: a sales page's (`film-source.ts`
 * in the page kit) and the org landing's intro film.
 *
 * The full film when there is one to ask for (`ask`); the 30-second preview
 * otherwise, and whenever asking fails — a `null` (the film may not play in
 * full), a rejection, an empty address, or a throw. The visitor pressed
 * play: they always get a film.
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

export function pressSource(
  preview: string,
  ask: AskForFull | undefined
): PressSource {
  if (!ask) return preview;
  try {
    return ask().then(
      (full) => (full?.playlistUrl ? full : preview),
      () => preview
    );
  } catch {
    return preview;
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
