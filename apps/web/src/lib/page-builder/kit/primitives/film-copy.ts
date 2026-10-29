/**
 * Visitor-facing words the kit's films render themselves (`InlineFilm`).
 * They belong in `kit/model/copy.ts` (contract A1) and live here only until
 * that shared file takes them — it is outside the films' own files. The
 * theatre's are paraglide's (`player_*`): it is an app component.
 */
export const FILM_COPY = {
  again: 'Watch again',
  /** Beside the play button when the player's code did not arrive: a press tries again. */
  failed: 'The film could not load. Try again.',
} as const;
