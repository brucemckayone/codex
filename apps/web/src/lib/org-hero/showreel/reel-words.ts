/**
 * What the Showreel says about each entry (Codex-1yd58.6): its number, the
 * kicker over the title, the index's one word for it, and its button.
 *
 * The film is the org's own: its title is the org's name and its line the
 * org's description, as in the v4 mock. Its button follows Codex-0hkkt's
 * rule: "Watch our film" only when a press plays the film in full, else
 * "Play the preview", so the label never promises more than the press plays.
 */
import * as m from '$paraglide/messages';
import type { OrgHeroPiece } from '../hero-config';
import type { ReelEntry } from '../reel';

export type ReelAction =
  /** Opens the org's film: in full, or its preview with sound. */
  | { kind: 'film'; label: string }
  | { kind: 'link'; label: string; href: string };

export interface ReelWords {
  /** "01", "02" … */
  number: string;
  /** Over the title: "Our film, 12 min", "A portal in 3 stages" … */
  kicker: string;
  /** The index's word: Film, Recording, Essay, Portal. */
  kind: string;
  title: string;
  line: string | null;
  action: ReelAction;
}

const KIND: Record<OrgHeroPiece['kind'], () => string> = {
  video: m.org_hero_reel_kind_film,
  audio: m.org_hero_reel_kind_recording,
  article: m.org_hero_reel_kind_essay,
  portal: m.org_hero_reel_kind_portal,
};

/** The film button's words (Codex-0hkkt). */
export function filmButtonLabel(
  fullFilm: boolean,
  duration: string | null
): string {
  if (!fullFilm) return m.org_hero_play_preview();
  return duration
    ? m.org_hero_watch_film_duration({ duration })
    : m.org_hero_watch_film();
}

export function reelWords(
  entry: ReelEntry,
  index: number,
  org: { name: string; description: string; filmDuration: string | null }
): ReelWords {
  const number = String(index + 1).padStart(2, '0');
  if (entry.type === 'film') {
    const duration = org.filmDuration;
    return {
      number,
      kicker: duration
        ? m.org_hero_reel_film_kicker_duration({ duration })
        : m.org_hero_reel_film_kicker(),
      kind: m.org_hero_reel_kind_film(),
      title: org.name,
      line: org.description || null,
      action: {
        kind: 'film',
        label: filmButtonLabel(entry.film.fullFilm, duration),
      },
    };
  }
  const { piece } = entry;
  return {
    number,
    kicker: piece.meta,
    kind: KIND[piece.kind](),
    title: piece.title,
    line: piece.line ?? null,
    action: { kind: 'link', label: piece.cta, href: piece.href },
  };
}
