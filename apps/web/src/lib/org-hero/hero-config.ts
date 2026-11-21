/**
 * Org home hero — purpose-first configuration (round 2 of the org home hero
 * work; design pages in docs/handover/org-landing-sources/round2, git-ignored).
 *
 * The model, in four layers:
 *   1. the org's FACTS (what it has: a logo, a shader, a film, featured work);
 *   2. a PURPOSE (what the front page is for), which sets every default;
 *   3. OPTIONS the org changed (only those are stored);
 *   4. FALLBACKS, so an option the org can't support quietly becomes one it can.
 *
 * Storage: every value lives in the branding `tokenOverrides` JSON as a
 * `hero-opt-<key>` entry, beside today's `hero-hide-*` flags. Like those flags
 * they are configuration, not CSS: `css-injection.ts` never emits them as
 * custom properties. An org is on the new hero exactly when it has a
 * `hero-opt-purpose`; with none, the page renders the classic hero unchanged.
 *
 * Pure and framework-free: the brand editor (studio document) and the landing
 * page (public bundle) both import it, and the tests drive it directly. Its
 * words come from the message catalogue, called at render time, never cached
 * in a module-level constant.
 */

import * as m from '$paraglide/messages';

export const HERO_OPT_PREFIX = 'hero-opt-';

export const HERO_PURPOSES = [
  'consume',
  'grow',
  'intro',
  'library',
  'follow',
  'spotlight',
] as const;
export type HeroPurpose = (typeof HERO_PURPOSES)[number];

/** Every option and the values it can take. The first value is never implied. */
export const HERO_OPTION_VALUES = {
  // 'showreel': the intro film, then the featured pieces, played one at a time
  // through the brand shader (Codex-1yd58); its own options are the reel-* keys
  comp: ['statement', 'centre', 'showcase', 'split', 'billboard', 'showreel'],
  align: ['start', 'center', 'end'],
  height: ['full', 'tall', 'compact'],
  bg: ['shader', 'film', 'gradient', 'pattern', 'plain'],
  veil: ['auto', 'soft', 'strong'],
  ambient: ['drift', 'still'],
  grain: ['on', 'off'],
  lead: ['both', 'logo', 'name'],
  line: ['desc', 'none'],
  search: ['on', 'off'],
  main: ['consume', 'explore', 'join', 'film', 'follow'],
  second: ['auto', 'none'],
  micro: ['on', 'off'],
  bstyle: ['solid', 'outline', 'pill', 'link'],
  // 'film': the org's intro film fills the frame (Showcase only), looping silently
  spot: ['featured', 'latest', 'film', 'none'],
  proof: ['facts', 'shelf', 'none'],
  type: ['classic', 'expressive', 'caps', 'oversized'],
  accent: ['none', 'underline', 'highlight'],
  entrance: ['rise', 'reveal', 'fade', 'none'],
  logo: ['s', 'm', 'l'],
  // The Showreel's own options. Every other composition leaves them unread.
  'reel-layout': ['corner', 'wide', 'name'],
  // the first featured pieces rise just above the fold
  'reel-peek': ['off', 'on'],
  'reel-pointer': ['liquid', 'smoke', 'glitch', 'none'],
  // between pieces
  'reel-trans': ['burn', 'liquid', 'glitch'],
  // a treatment over every picture and film
  'reel-surface': ['none', 'grain', 'halftone', 'reeded', 'red', 'shader'],
  // where the film gives way to the shader: its foot evenly ('fade', the
  // default: owner, 2026-11-20), its foot through the smoke ('under'), all
  // round ('edges'), or nowhere
  'reel-band': ['fade', 'under', 'edges', 'none'],
  // how the words keep their contrast over the footage (owner, 2026-11-20):
  // the corner shadows grown as far as each word needs ('shadow', the
  // default), or the shadows as they are and an outline round each word's
  // glyphs ('outline')
  'reel-edge': ['shadow', 'outline'],
  'reel-opening': ['name', 'none'],
  // how "Watch our film" opens into the full frame
  'reel-film': ['name', 'smoke', 'liquid'],
  'reel-loop': ['on', 'off'],
} as const;

export type HeroOptionKey = keyof typeof HERO_OPTION_VALUES;
export type HeroOptions = {
  -readonly [K in HeroOptionKey]: (typeof HERO_OPTION_VALUES)[K][number];
};
export const HERO_OPTION_KEYS = Object.keys(
  HERO_OPTION_VALUES
) as HeroOptionKey[];

/** Which alignments each composition can draw well. */
export const HERO_ALIGN_ALLOWED: Record<
  HeroOptions['comp'],
  readonly HeroOptions['align'][]
> = {
  statement: ['start', 'center', 'end'],
  centre: ['center'],
  showcase: ['start', 'end'],
  split: ['start', 'end'],
  billboard: ['start', 'center'],
  // the reel's layout places the words
  showreel: ['start'],
};

/** What the org actually has: the inputs every fallback is decided from. */
export interface HeroFacts {
  hasLogo: boolean;
  /** A shader preset other than 'none' is set. */
  hasShader: boolean;
  /** An intro film the visitor can press play on. */
  hasFilm: boolean;
  /** The film has a public preview that can loop silently as a background. */
  hasFilmLoop: boolean;
  /** A featured portal or piece exists. */
  hasFeatured: boolean;
  /** At least one published piece exists. */
  hasLatest: boolean;
  /** The featured piece has a picture to fill a panel or a billboard. */
  hasFeaturedImage: boolean;
  /** The latest piece has a picture to fill a panel or a billboard. */
  hasLatestImage: boolean;
  /** The facts line has at least one count worth showing. */
  hasFacts: boolean;
  hasDescription: boolean;
  /** Subscriptions are on AND a plan is on sale, so Join has somewhere to go. */
  canJoin: boolean;
  /** The org hid its name in the hero's Layout control (`hero-hide-title`). */
  hideTitle: boolean;
  /**
   * The Showreel has something to play: the intro film, or at least two
   * pieces it can show (`reelQualifies` in reel.ts).
   */
  hasReel: boolean;
}

export interface HeroSettings {
  purpose: HeroPurpose | null;
  /** Only the options the org changed from its purpose. */
  options: Partial<HeroOptions>;
}

const optKey = (key: HeroOptionKey | 'purpose') => `${HERO_OPT_PREFIX}${key}`;

function isValue<K extends HeroOptionKey>(
  key: K,
  value: unknown
): value is HeroOptions[K] {
  return (
    typeof value === 'string' &&
    (HERO_OPTION_VALUES[key] as readonly string[]).includes(value)
  );
}

/**
 * The stored branding `tokenOverrides` (a JSON string) as a map. A missing,
 * malformed or non-object value reads as no overrides, so the page renders the
 * classic hero. That is a state a row can stay in: the save schema lets text
 * that isn't JSON through on purpose, and the studio saves it back unchanged
 * (`tokenOverridesJsonSchema`, Codex-cijzb).
 */
export function parseHeroOverrides(
  raw: string | null | undefined
): Readonly<Record<string, unknown>> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Read the hero settings out of a tokenOverrides map. Anything unknown or
 * malformed is ignored, so a stale or hand-edited key can never break the page.
 */
export function readHeroSettings(
  overrides: Readonly<Record<string, unknown>> | null | undefined
): HeroSettings {
  const source = overrides ?? {};
  const rawPurpose = source[optKey('purpose')];
  const purpose =
    typeof rawPurpose === 'string' &&
    (HERO_PURPOSES as readonly string[]).includes(rawPurpose)
      ? (rawPurpose as HeroPurpose)
      : null;
  const options: Partial<HeroOptions> = {};
  for (const key of HERO_OPTION_KEYS) {
    const value = source[optKey(key)];
    if (isValue(key, value)) (options as Record<string, string>)[key] = value;
  }
  return { purpose, options };
}

/** The org's own starting point, before any purpose. */
function baseOptions(facts: HeroFacts): HeroOptions {
  return {
    comp: 'statement',
    align: 'start',
    height: 'tall',
    bg: facts.hasShader ? 'shader' : 'gradient',
    veil: 'auto',
    ambient: 'drift',
    grain: 'off',
    lead: facts.hasLogo ? 'both' : 'name',
    line: facts.hasDescription ? 'desc' : 'none',
    search: 'off',
    main: 'consume',
    second: 'auto',
    micro: 'on',
    bstyle: 'solid',
    spot: 'none',
    proof: facts.hasFacts ? 'facts' : 'none',
    type: 'classic',
    accent: 'none',
    entrance: 'rise',
    logo: 'm',
    'reel-layout': 'corner',
    'reel-peek': 'off',
    'reel-pointer': 'liquid',
    'reel-trans': 'burn',
    'reel-surface': 'none',
    'reel-band': 'fade',
    'reel-edge': 'shadow',
    'reel-opening': 'name',
    'reel-film': 'name',
    'reel-loop': 'on',
  };
}

/**
 * What each purpose changes from the base, given what the org has. Only the
 * changes: a value the base already sets is not repeated here.
 */
function purposeDefaults(
  purpose: HeroPurpose,
  facts: HeroFacts
): Partial<HeroOptions> {
  switch (purpose) {
    case 'consume': {
      // Media first: the Showreel plays the org's film and pieces when it has
      // a reel, shader or not. Else the film fills the Showcase frame when it
      // can loop, else the latest piece does: in the FRAME, never behind the
      // words. No small print.
      const frame =
        facts.hasFilmLoop || facts.hasLatest ? 'showcase' : 'statement';
      return {
        comp: facts.hasReel ? 'showreel' : frame,
        spot: facts.hasFilmLoop ? 'film' : 'latest',
        micro: 'off',
      };
    }
    case 'grow':
      return {
        comp: 'centre',
        align: 'center',
        height: 'full',
        main: 'join',
      };
    case 'intro': {
      const picture = pictureFor(spotPiece('featured', facts), facts);
      return {
        comp: picture ? 'split' : 'centre',
        align: picture ? 'start' : 'center',
        height: 'full',
        main: facts.hasFilm ? 'film' : 'explore',
        spot: facts.hasFeatured ? 'featured' : 'latest',
        proof: 'none',
      };
    }
    case 'library':
      return {
        height: 'compact',
        search: 'on',
        main: 'explore',
        line: 'none',
        proof: 'none',
      };
    case 'follow':
      return {
        main: 'follow',
        proof: facts.hasLatest ? 'shelf' : 'none',
      };
    case 'spotlight':
      return {
        comp: facts.hasFeatured || facts.hasLatest ? 'showcase' : 'statement',
        height: 'full',
        spot: facts.hasFeatured ? 'featured' : 'latest',
        main: 'explore',
      };
  }
}

/** The purpose's defaults with nothing changed: what an "Auto" choice means. */
export function defaultOptions(
  purpose: HeroPurpose,
  facts: HeroFacts
): HeroOptions {
  return applyFallbacks(
    { ...baseOptions(facts), ...purposeDefaults(purpose, facts) },
    facts
  );
}

/** Base → purpose → the org's own changes → fallbacks. */
export function resolveHero(
  purpose: HeroPurpose,
  options: Partial<HeroOptions>,
  facts: HeroFacts
): HeroOptions {
  // A chosen Showreel with nothing to play is set aside, so the purpose's own
  // hero draws: what an org saw before the Showreel existed. This is the
  // Showreel's only fallback; applyFallbacks has none.
  const { comp, ...rest } = options;
  const chosen = comp === 'showreel' && !facts.hasReel ? rest : options;
  return applyFallbacks(
    { ...baseOptions(facts), ...purposeDefaults(purpose, facts), ...chosen },
    facts
  );
}

/**
 * The piece a spot lands on once the fallbacks have run: the chosen one when
 * it exists, else the other. A picture composition with no piece chosen
 * ('none', or the film it cannot hold) is filled featured-first.
 */
function spotPiece(
  spot: HeroOptions['spot'],
  facts: HeroFacts
): 'featured' | 'latest' | null {
  if (spot === 'latest') {
    if (facts.hasLatest) return 'latest';
    return facts.hasFeatured ? 'featured' : null;
  }
  if (facts.hasFeatured) return 'featured';
  return facts.hasLatest ? 'latest' : null;
}

function pictureFor(
  piece: 'featured' | 'latest' | null,
  facts: HeroFacts
): boolean {
  if (piece === 'featured') return facts.hasFeaturedImage;
  if (piece === 'latest') return facts.hasLatestImage;
  return false;
}

/**
 * Whatever the org can't support falls back to the nearest thing it can, so
 * no combination draws an empty frame or a dead button.
 */
function applyFallbacks(input: HeroOptions, facts: HeroFacts): HeroOptions {
  const c = { ...input };
  // A Showreel reaching here has a reel: the consume default asks for one,
  // and resolveHero sets aside a chosen Showreel without one, so the
  // purpose's own hero draws instead.
  if (c.comp === 'showreel') {
    // The reel plays in the brand shader's ground, or on a plain one when the
    // org has no shader (owner, 2026-11-19). It takes the spotlight's place:
    // no spotlight, and no shelf repeating the pieces its index lists.
    c.bg = facts.hasShader ? 'shader' : 'plain';
    c.spot = 'none';
    if (c.proof === 'shelf') c.proof = 'facts';
  }
  // the shader surface and the shader band are drawn by the shader
  if (!facts.hasShader) {
    if (c['reel-surface'] === 'shader') c['reel-surface'] = 'none';
    c['reel-band'] = 'none';
  }
  if (c.bg === 'shader' && !facts.hasShader) c.bg = 'gradient';
  if (c.bg === 'film' && !facts.hasFilmLoop)
    c.bg = facts.hasShader ? 'shader' : 'gradient';
  // The composition first (what can this org fill?), then which piece fills it:
  // the other order handed a bare org a spotlight on a piece it doesn't have.
  const anyPiece = facts.hasFeatured || facts.hasLatest;
  if (c.spot === 'film' && !facts.hasFilmLoop) c.spot = 'none';
  // A billboard or a panel draws ONE piece's picture: check the piece the spot
  // lands on, not whichever piece happens to have one.
  if (
    (c.comp === 'billboard' || c.comp === 'split') &&
    !pictureFor(spotPiece(c.spot, facts), facts)
  ) {
    c.comp = anyPiece ? 'showcase' : 'statement';
  }
  if (c.comp === 'showcase' && !anyPiece && c.spot !== 'film')
    c.comp = 'statement';
  // only a Showcase frame can hold the film; a panel or billboard wants a picture
  if (c.spot === 'film' && c.comp !== 'showcase') c.spot = 'none';
  // the film fills the frame, so it never also loops behind the words
  if (c.bg === 'film' && c.comp === 'showcase' && c.spot === 'film')
    c.bg = facts.hasShader ? 'shader' : 'gradient';
  if (c.spot === 'featured' && !facts.hasFeatured)
    c.spot = facts.hasLatest ? 'latest' : 'none';
  if (c.spot === 'latest' && !facts.hasLatest)
    c.spot = facts.hasFeatured ? 'featured' : 'none';
  // showcase, split and billboard are drawn around a piece; one exists by now
  if (
    (c.comp === 'showcase' || c.comp === 'split' || c.comp === 'billboard') &&
    c.spot === 'none'
  ) {
    c.spot = facts.hasFeatured ? 'featured' : 'latest';
  }
  if (c.main === 'film' && !facts.hasFilm) c.main = 'explore';
  if (c.main === 'join' && !facts.canJoin) c.main = 'explore';
  if (c.proof === 'facts' && !facts.hasFacts) c.proof = 'none';
  if (c.proof === 'shelf' && !facts.hasLatest) c.proof = 'none';
  if (c.line === 'desc' && !facts.hasDescription) c.line = 'none';
  // the classic hero's "hide the name" switch: the logo leads alone, and the
  // name stays in the page for screen readers
  if (facts.hideTitle) c.lead = 'logo';
  if (c.lead !== 'name' && !facts.hasLogo) c.lead = 'name';
  // With the logo leading alone the name is out of sight, so the reel never
  // plays through it: no name window, no opening or way into the film by it.
  if (c.lead === 'logo') {
    if (c['reel-layout'] === 'name') c['reel-layout'] = 'corner';
    if (c['reel-opening'] === 'name') c['reel-opening'] = 'none';
    if (c['reel-film'] === 'name') c['reel-film'] = 'smoke';
  }
  // the peek lifts the featured row, so it needs one
  if (c['reel-peek'] === 'on' && !facts.hasFeatured) c['reel-peek'] = 'off';
  if (!HERO_ALIGN_ALLOWED[c.comp].includes(c.align))
    c.align = HERO_ALIGN_ALLOWED[c.comp][0];
  return c;
}

/**
 * Whether these settings can put a Join button in the hero. The landing waits
 * for the org's plans only then, so the button is right in the server HTML.
 */
export function heroMayOfferJoin(settings: HeroSettings): boolean {
  if (!settings.purpose) return false;
  return (
    settings.options.main === 'join' ||
    (settings.purpose === 'grow' && settings.options.main === undefined)
  );
}

/**
 * How many hero settings the org has stored beyond its purpose, counted from
 * the stored keys, so a stale or renamed value still counts and Reset clears it.
 */
export function storedHeroChanges(
  overrides: Readonly<Record<string, unknown>>
): number {
  const purpose = optKey('purpose');
  return Object.keys(overrides).filter(
    (key) => key.startsWith(HERO_OPT_PREFIX) && key !== purpose
  ).length;
}

/**
 * Set one hero setting in a tokenOverrides map, returning a new map. `null`
 * removes it, which means "Auto: whatever the purpose sets".
 */
export function writeHeroSetting(
  overrides: Readonly<Record<string, string | null>>,
  key: HeroOptionKey | 'purpose',
  value: string | null
): Record<string, string | null> {
  const next = { ...overrides };
  if (value === null) delete next[optKey(key)];
  else next[optKey(key)] = value;
  return next;
}

/** Remove the org's changes (keeping the purpose), or every hero setting. */
export function clearHeroSettings(
  overrides: Readonly<Record<string, string | null>>,
  { keepPurpose }: { keepPurpose: boolean }
): Record<string, string | null> {
  const next: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (!key.startsWith(HERO_OPT_PREFIX)) next[key] = value;
    else if (keepPurpose && key === optKey('purpose')) next[key] = value;
  }
  return next;
}

/** One piece the hero can show: in the spotlight frame, a billboard, or the shelf. */
export interface OrgHeroPiece {
  kind: 'portal' | 'video' | 'audio' | 'article';
  /** "Featured portal", "New film" … (already in the reader's language) */
  kicker: string;
  title: string;
  /** A plain sentence: "A portal in 3 stages, with 4 practices", "A 12-minute film" … */
  meta: string;
  /** What the piece is about, in the creator's words (a portal's tagline, a piece's description). */
  line?: string | null;
  href: string;
  imageUrl: string | null;
  /**
   * Its public 30-second preview (HLS): silent in the Showreel, with sound in
   * its theatre. Null for an essay or a portal, or a piece without one.
   */
  previewUrl: string | null;
  /** The whole piece's length; null when unknown or it has none. */
  durationSeconds: number | null;
  /** What following the link does: "Enter the portal", "Watch the film" … */
  cta: string;
}

/** The spotlight frame takes the shape of what it holds. */
export type HeroFrameShape = 'arch' | 'wide' | 'page';

export function frameShapeFor(kind: OrgHeroPiece['kind']): HeroFrameShape {
  // A portal is a threshold you step through; a film is landscape footage; an
  // essay or a recording's cover sits like a page.
  if (kind === 'portal') return 'arch';
  if (kind === 'video') return 'wide';
  return 'page';
}

const stages = (n: number) =>
  n === 1
    ? m.org_hero_stages_one()
    : m.org_hero_stages_other({ count: String(n) });
const practices = (n: number) =>
  n === 1
    ? m.org_hero_practices_one()
    : m.org_hero_practices_other({ count: String(n) });

/** "A portal in 3 stages, with 4 practices". */
export function portalMeta(stageCount: number, practiceCount: number): string {
  if (stageCount > 0 && practiceCount > 0) {
    return m.org_hero_meta_portal_both({
      stages: stages(stageCount),
      practices: practices(practiceCount),
    });
  }
  if (stageCount > 0)
    return m.org_hero_meta_portal_stages({ stages: stages(stageCount) });
  if (practiceCount > 0)
    return m.org_hero_meta_portal_practices({
      practices: practices(practiceCount),
    });
  return m.org_hero_meta_portal();
}

/** "A 12-minute film", "An essay", "A recording". */
export function pieceMeta(
  kind: Exclude<OrgHeroPiece['kind'], 'portal'>,
  minutes: number | null
): string {
  if (kind === 'article') return m.org_hero_meta_essay();
  if (!minutes)
    return kind === 'audio'
      ? m.org_hero_meta_recording()
      : m.org_hero_meta_film();
  const count = { minutes: String(minutes) };
  return kind === 'audio'
    ? m.org_hero_meta_recording_minutes(count)
    : m.org_hero_meta_film_minutes(count);
}

/** What the org mostly publishes decides the verbs. */
export type HeroContentKind = 'watch' | 'listen' | 'read';

/**
 * Everything that turns on what the org mostly publishes: the consume button's
 * words, the line under it when some pieces are free, the "consume" purpose's
 * name in the brand editor, and the explore filter the button opens.
 */
const HERO_KIND: Record<
  HeroContentKind,
  {
    start: () => string;
    freeNote: () => string;
    purpose: () => string;
    contentType: 'video' | 'audio' | 'written';
  }
> = {
  watch: {
    start: () => m.org_hero_start_watching(),
    freeNote: () => m.org_hero_free_note_watch(),
    purpose: () => m.branding_hero_purpose_consume_watch(),
    contentType: 'video',
  },
  listen: {
    start: () => m.org_hero_start_listening(),
    freeNote: () => m.org_hero_free_note_listen(),
    purpose: () => m.branding_hero_purpose_consume_listen(),
    contentType: 'audio',
  },
  read: {
    start: () => m.org_hero_start_reading(),
    freeNote: () => m.org_hero_free_note_read(),
    purpose: () => m.branding_hero_purpose_consume_read(),
    contentType: 'written',
  },
};

/** The consume button's words: "Start watching", "Start listening", "Start reading". */
export const heroConsumeLabel = (kind: HeroContentKind): string =>
  HERO_KIND[kind].start();

/** The line under the consume button when some pieces are free. */
export const heroFreeNote = (kind: HeroContentKind): string =>
  HERO_KIND[kind].freeNote();

/** The content type the consume button filters the explore page to. */
export const heroContentType = (kind: HeroContentKind) =>
  HERO_KIND[kind].contentType;

/** How the brand editor names each purpose, and the hint beneath it. */
export const HERO_PURPOSE_COPY: Record<
  HeroPurpose,
  { label: (kind: HeroContentKind) => string; hint: () => string }
> = {
  consume: {
    label: (kind) => HERO_KIND[kind].purpose(),
    hint: () => m.branding_hero_purpose_consume_hint(),
  },
  grow: {
    label: () => m.branding_hero_purpose_grow(),
    hint: () => m.branding_hero_purpose_grow_hint(),
  },
  intro: {
    label: () => m.branding_hero_purpose_intro(),
    hint: () => m.branding_hero_purpose_intro_hint(),
  },
  library: {
    label: () => m.branding_hero_purpose_library(),
    hint: () => m.branding_hero_purpose_library_hint(),
  },
  follow: {
    label: () => m.branding_hero_purpose_follow(),
    hint: () => m.branding_hero_purpose_follow_hint(),
  },
  spotlight: {
    label: () => m.branding_hero_purpose_spotlight(),
    hint: () => m.branding_hero_purpose_spotlight_hint(),
  },
};

/** Pick the content kind from the counts the public stats already carry. */
export function contentKindFrom(
  counts:
    | { video?: number; audio?: number; written?: number }
    | null
    | undefined
): HeroContentKind {
  const video = counts?.video ?? 0;
  const audio = counts?.audio ?? 0;
  const written = counts?.written ?? 0;
  if (audio > video && audio >= written) return 'listen';
  if (written > video && written > audio) return 'read';
  return 'watch';
}

/**
 * The words for "start consuming" follow the SPOTLIGHT when it is one piece, so
 * the hero tells one story ("Start watching" beside a film), and fall back to
 * the counts for a portal (which holds every kind) or no spotlight (owner, 11-18).
 */
export function contentKindForHero(
  spot: Pick<OrgHeroPiece, 'kind'> | null | undefined,
  counts:
    | { video?: number; audio?: number; written?: number }
    | null
    | undefined
): HeroContentKind {
  if (spot?.kind === 'video') return 'watch';
  if (spot?.kind === 'audio') return 'listen';
  if (spot?.kind === 'article') return 'read';
  return contentKindFrom(counts);
}

/**
 * The facts line: only counts that help. A count under two undersells
 * ("1 creator"), so it is dropped; minutes read as minutes, never "42m Hours".
 */
export function heroFacts(input: {
  portals: number;
  videos: number;
  audio: number;
  written: number;
  totalSeconds: number;
}): string[] {
  // every count shown is two or more, so each message is the plural form
  const out: string[] = [];
  if (input.portals >= 2)
    out.push(m.org_hero_facts_portals({ count: String(input.portals) }));
  const films = input.videos + input.audio;
  if (films >= 2) {
    const count = { count: String(films) };
    out.push(
      input.audio && input.videos
        ? m.org_hero_facts_films_recordings(count)
        : input.audio
          ? m.org_hero_facts_recordings(count)
          : m.org_hero_facts_films(count)
    );
  }
  if (input.written >= 2)
    out.push(m.org_hero_facts_essays({ count: String(input.written) }));
  const minutes = Math.round(input.totalSeconds / 60);
  if (minutes >= 10) {
    out.push(
      minutes < 90
        ? m.org_hero_facts_minutes({ count: String(minutes) })
        : m.org_hero_facts_hours({
            count: String(Math.round((minutes / 60) * 2) / 2),
          })
    );
  }
  return out;
}
