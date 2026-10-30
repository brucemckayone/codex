/**
 * The public pages' `requestFilm` (owner P10, "Full film unless it's paid"):
 * what a press on a film the server marked `fullFilm` calls for that film's
 * 10-minute signed stream. A course sales page asks for one of its films
 * (`createFilmRequester`); the org landing, for its intro film
 * (`createOrgFilmRequester`, Codex-376dl).
 *
 * It ALWAYS SETTLES, and never rejects or throws. The player waits on it with
 * the film loading, so a refusal, a failure and a hang must all end as `null`,
 * which plays the 30-second preview. The server's own hop to the worker gives
 * up first, at 6s (`COURSE_FILM_TIMEOUT_MS` in `createServerApi`), as a logged
 * 408; the browser's request to the remote function has no bound of its own,
 * and {@link FILM_REQUEST_TIMEOUT_MS} is that bound. A late answer after it is
 * dropped: the preview is already playing.
 *
 * PURE: the remote call is passed in, so this is testable without SvelteKit
 * and imports nothing from the editor (CE-4).
 */
import type { SalesFilm } from '@codex/validation';

/** How long a press waits for the full film before the preview plays. */
export const FILM_REQUEST_TIMEOUT_MS = 8000;

/** The signed stream, and when its links run out (ISO), so the player renews it. */
type FilmStream = { playlistUrl: string; expiresAt?: string } | null;

/** The remote command a requester asks (`requestCourseFilm`). */
type AskForFilm = (input: {
  organizationId: string;
  courseId: string;
  film: SalesFilm;
}) => Promise<FilmStream>;

/** The remote command the org landing asks (`requestOrgFilm`). */
type AskForOrgFilm = (input: { organizationId: string }) => Promise<FilmStream>;

/** `ask`'s answer, or `null` on a throw, a rejection, or `timeoutMs`. */
function settled(
  ask: () => Promise<FilmStream>,
  timeoutMs: number
): Promise<FilmStream> {
  let answered: Promise<FilmStream>;
  try {
    answered = ask().catch(() => null);
  } catch {
    return Promise.resolve(null);
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  return Promise.race([answered, timedOut]).finally(() => clearTimeout(timer));
}

/**
 * A `requestFilm` for one course's sales page. With no organisation (a page
 * that resolved none) every film plays its preview.
 */
export function createFilmRequester(
  ids: { organizationId: string | null | undefined; courseId: string },
  ask: AskForFilm,
  timeoutMs: number = FILM_REQUEST_TIMEOUT_MS
): (film: SalesFilm) => Promise<FilmStream> {
  return (film) => {
    const { organizationId, courseId } = ids;
    if (!organizationId) return Promise.resolve(null);
    return settled(() => ask({ organizationId, courseId, film }), timeoutMs);
  };
}

/** The org landing's intro film, asked for in full on each press. */
export function createOrgFilmRequester(
  organizationId: string,
  ask: AskForOrgFilm,
  timeoutMs: number = FILM_REQUEST_TIMEOUT_MS
): () => Promise<FilmStream> {
  return () => settled(() => ask({ organizationId }), timeoutMs);
}
