import type { IntroFilm, PublicMediaItem } from '@codex/shared-types';
import { describe, expect, it } from 'vitest';
import type { OrgHeroPiece } from './hero-config';
import { buildReel, type ReelEntry, reelQualifies } from './reel';

const FILM: IntroFilm = {
  title: 'Of Blood & Bones',
  posterUrl: 'https://cdn.test/film/poster.webp',
  previewUrl: 'https://preview.test/film/preview.m3u8',
  durationSeconds: 30,
  fullFilm: true,
};

type Media = Partial<Pick<OrgHeroPiece, 'imageUrl' | 'previewUrl'>>;

/** A piece with a picture and, for a film or recording, a preview. */
function piece(
  slug: string,
  kind: OrgHeroPiece['kind'] = 'video',
  media: Media = {}
): OrgHeroPiece {
  const hasPreview = kind === 'video' || kind === 'audio';
  return {
    kind,
    kicker: 'piece',
    title: slug,
    meta: 'A piece',
    line: null,
    href: `/content/${slug}`,
    imageUrl: `https://cdn.test/${slug}.webp`,
    previewUrl: hasPreview ? `https://preview.test/${slug}.m3u8` : null,
    durationSeconds: hasPreview ? 600 : null,
    cta: 'Open',
    ...media,
  };
}

/** A catalogue row: its media item carries the piece's picture and preview. */
interface Row {
  featured: boolean;
  mediaItem: PublicMediaItem | null;
  piece: OrgHeroPiece;
}

function row(
  slug: string,
  kind: Exclude<OrgHeroPiece['kind'], 'portal'> = 'video',
  media: Media = {},
  featured = false
): Row {
  const p = piece(slug, kind, media);
  return {
    featured,
    mediaItem:
      kind === 'article'
        ? null
        : {
            durationSeconds: p.durationSeconds,
            thumbnailUrl: p.imageUrl,
            hlsPreviewUrl: p.previewUrl,
          },
    piece: p,
  };
}

const pick = (
  slug: string,
  kind: Exclude<OrgHeroPiece['kind'], 'portal'> = 'video',
  media: Media = {}
) => row(slug, kind, media, true);

/** A featured portal, as the landing words it. */
const portal = (slug: string, media: Media = {}) => ({
  ...piece(slug, 'portal', media),
  kicker: 'portal',
});

/** The reel of an org with only what each case names. The kicker says the mode. */
const reelOf = (input: {
  film?: IntroFilm | null;
  rows?: Row[];
  portals?: OrgHeroPiece[];
}) =>
  buildReel({
    film: input.film ?? null,
    rows: input.rows ?? [],
    portals: input.portals ?? [],
    toPiece: (r, mode) => ({ ...r.piece, kicker: mode }),
  });

const title = (entry: ReelEntry) =>
  entry.type === 'film' ? 'film' : entry.piece.title;

/** What plays, in order: "film", or a piece's title. */
const play = (input: Parameters<typeof reelOf>[0]) => reelOf(input).map(title);

/** Where each piece came from: its kicker, "featured" or "latest". */
const sources = (input: Parameters<typeof reelOf>[0]) =>
  reelOf(input).flatMap((entry) =>
    entry.type === 'piece' ? [entry.piece.kicker] : []
  );

describe('buildReel', () => {
  it('plays the film first, then the featured pieces in their order, five at most', () => {
    const rows = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((s) => pick(s));
    expect(play({ film: FILM, rows: [...rows, row('new')] })).toEqual([
      'film',
      'a',
      'b',
      'c',
      'd',
      'e',
    ]);
  });

  it('plays featured content first, then featured portals', () => {
    const input = {
      rows: [pick('c1'), row('x'), pick('c2', 'article')],
      portals: [portal('p1'), portal('p2')],
    };
    expect(play(input)).toEqual(['c1', 'c2', 'p1', 'p2']);
    expect(sources(input)).toEqual([
      'featured',
      'featured',
      'portal',
      'portal',
    ]);
  });

  it('plays the featured pieces only when at least two can be shown, else the latest, never mixed', () => {
    const latest = ['n1', 'n2', 'n3', 'n4'].map((s) => row(s));
    // one featured portal and four latest: the four latest
    const onePortal = { portals: [portal('p1')], rows: latest };
    expect(play(onePortal)).toEqual(['n1', 'n2', 'n3', 'n4']);
    expect(sources(onePortal)).toEqual([
      'latest',
      'latest',
      'latest',
      'latest',
    ]);
    expect(reelQualifies(reelOf(onePortal))).toBe(true);
    // one featured row plays among the latest, as one of them
    const oneRow = { rows: [row('n1'), pick('f1'), row('n2')] };
    expect(play(oneRow)).toEqual(['n1', 'f1', 'n2']);
    expect(sources(oneRow)).toEqual(['latest', 'latest', 'latest']);
    // two featured: the featured only
    expect(play({ rows: [pick('f1'), row('n1'), pick('f2')] })).toEqual([
      'f1',
      'f2',
    ]);
    // the same rule with the film
    expect(play({ film: FILM, ...onePortal })).toEqual([
      'film',
      'n1',
      'n2',
      'n3',
      'n4',
    ]);
    // a featured piece with nothing to show does not count
    const blank = pick('blank', 'article', { imageUrl: null });
    expect(play({ rows: [blank, pick('f1'), row('n1')] })).toEqual([
      'f1',
      'n1',
    ]);
  });

  it('plays a lone featured piece when there is nothing newer, which alone does not qualify', () => {
    // never mixed, and the org keeps its only showable piece (team lead, 2026-11-19)
    const alone = reelOf({ portals: [portal('p1')] });
    expect(alone.map(title)).toEqual(['p1']);
    expect(reelQualifies(alone)).toBe(false);
    expect(reelQualifies(reelOf({ film: FILM, portals: [portal('p1')] }))).toBe(
      true
    );
  });

  it('plays a film’s footage, and shows every other piece’s picture', () => {
    const reel = reelOf({
      film: FILM,
      rows: [
        pick('poster-only', 'video', { previewUrl: null }),
        pick('footage-only', 'video', { imageUrl: null }),
        pick('recording', 'audio'),
        pick('essay', 'article'),
      ],
      portals: [portal('portal')],
    });
    expect(reel.map((entry) => [title(entry), entry.show])).toEqual([
      ['film', 'footage'], // the intro film's preview
      ['poster-only', 'still'],
      ['footage-only', 'footage'],
      // a recording shows its cover; its preview is for the theatre
      ['recording', 'still'],
      ['essay', 'still'],
      ['portal', 'still'],
    ]);
  });

  it('leaves out a piece with nothing to show', () => {
    expect(
      play({
        rows: [
          row('bare-film', 'video', { imageUrl: null, previewUrl: null }),
          // its preview is heard, not seen: with no cover there is no picture
          row('bare-recording', 'audio', { imageUrl: null }),
          row('bare-essay', 'article', { imageUrl: null }),
          row('shown', 'article'),
        ],
        portals: [portal('bare-portal', { imageUrl: null })],
      })
    ).toEqual(['shown']);
  });

  it('shows the film’s poster when it has no preview, and leaves out a film with nothing to show', () => {
    const posterOnly = { ...FILM, previewUrl: null };
    expect(reelOf({ film: posterOnly })).toEqual([
      { type: 'film', film: posterOnly, show: 'still' },
    ]);
    expect(
      reelOf({ film: { ...FILM, previewUrl: null, posterUrl: null } })
    ).toEqual([]);
  });

  it('plays the org’s film once when it is also one of its pieces', () => {
    const others = [pick('b'), pick('c')];
    // matched by its preview
    const byPreview = pick('same', 'video', { previewUrl: FILM.previewUrl });
    expect(play({ film: FILM, rows: [byPreview, ...others] })).toEqual([
      'film',
      'b',
      'c',
    ]);
    // a film offered in full with no preview: matched by its poster
    const fullOnly = { ...FILM, previewUrl: null };
    const byPoster = pick('same', 'video', { imageUrl: FILM.posterUrl });
    expect(play({ film: fullOnly, rows: [byPoster, ...others] })).toEqual([
      'film',
      'b',
      'c',
    ]);
    // among the latest too
    expect(
      play({
        film: FILM,
        rows: [
          row('same', 'video', { previewUrl: FILM.previewUrl }),
          row('n1'),
        ],
      })
    ).toEqual(['film', 'n1']);
    // with no film in the reel, the row plays as itself
    expect(play({ rows: [byPreview, ...others] })).toEqual(['same', 'b', 'c']);
  });
});

describe('reelQualifies', () => {
  it('needs the intro film, or at least two pieces', () => {
    expect(reelQualifies(reelOf({ film: FILM }))).toBe(true);
    expect(reelQualifies(reelOf({ rows: [row('a'), row('b')] }))).toBe(true);
    expect(reelQualifies(reelOf({ rows: [row('a')] }))).toBe(false);
    expect(reelQualifies([])).toBe(false);
  });
});
