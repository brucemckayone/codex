/**
 * The Showreel on of-blood-and-bones' landing, without a DB write
 * (Codex-1yd58.6, .8): the landing's HTML is rewritten in the browser to set
 * the hero options the brand editor would save (`brandFineTune.tokenOverrides`,
 * the keys set last so they win). The server rendered the org's stored hero;
 * hydration redraws it as the Showreel, as a saved change would draw on the
 * next load. Shared by the Showreel's spec and its theatre's, so the setup
 * lives once; the origin comes from `origin.ts`, as every spec's does.
 *
 * A test that needs a kind of film or piece sets it the same way, so it runs
 * whatever the seed holds, opting in per test: `introFilm` sets an intro film
 * and how it plays, and `featureRecording` puts a recording with a preview in
 * the reel. Each FAILS, never skips, when the page has nothing to set it from.
 *
 * A fulfilled document has no address, so Chrome's Local Network Access counts
 * it public and blocks its requests to the local servers: a spec using this
 * passes `SHOWREEL_LAUNCH` to `test.use`.
 */
import {
  type Browser,
  type BrowserContextOptions,
  expect,
  type Page,
  test,
} from '@playwright/test';
import { orgOrigin } from './origin';

/** The org both specs set the Showreel on, as its landing is seeded. */
export const ORG = 'of-blood-and-bones';
/** `PIECE_MS` in reel-clock.svelte.ts: how long each piece plays. */
export const PIECE_MS = 7000;
/** A piece, plus the words' swap and a slow CI frame. */
export const MOVES_ON = PIECE_MS + 5000;

/**
 * Wait out the opening, if one plays: the reel's first turn starts when its
 * words come in (the clock holds while the opening holds them), so a test
 * timing a piece from the page's load waits for this first. Generous: a slow
 * GPU (CI's software WebGL) brings the shader up late, and the opening after.
 */
export async function openingEnded(page: Page): Promise<void> {
  await expect(page.locator('.reel'), 'the opening ended').not.toHaveAttribute(
    'data-opening',
    /.*/,
    { timeout: 30_000 }
  );
}

/**
 * `--disable-audio-output` plays sound into a fake device. Where Chrome can
 * open no real one (headless on a Mac), media with its sound on never starts
 * its clock: it sits on its first frame, not paused and with no error, while
 * the same media muted plays. The page still sees its sound on.
 */
export const SHOWREEL_LAUNCH = {
  launchOptions: {
    args: [
      '--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-audio-output',
    ],
  },
};

/** The brand's stored overrides in the page's data: a JSON string, or null. */
const PAYLOAD = /brandFineTune:\{tokenOverrides:("(?:[^"\\]|\\.)*"|null)/;

/**
 * The landing's HTML with these brand overrides stored, keyed as the editor
 * saves them (the stored ones kept, these set over them), or null when it
 * carries no brand payload to set them on. The org layout draws its
 * overrides again as the page hydrates, so a colour set here is the page's
 * from then on.
 */
function withOverrides(
  html: string,
  set: Record<string, string>
): string | null {
  const match = PAYLOAD.exec(html);
  if (!match) return null;
  const stored: Record<string, string> =
    match[1] === 'null' ? {} : JSON.parse(JSON.parse(match[1]));
  const literal = JSON.stringify(JSON.stringify({ ...stored, ...set })).replace(
    /</g,
    '\\u003C'
  );
  return html.replace(
    match[0],
    () => `brandFineTune:{tokenOverrides:${literal}`
  );
}

/**
 * The landing's HTML with these hero options set as the editor saves them,
 * or null when it carries no brand payload to set them on.
 */
export function withHeroOptions(
  html: string,
  keys: Record<string, string>
): string | null {
  return withOverrides(
    html,
    Object.fromEntries(
      Object.entries(keys).map(([key, value]) => [`hero-opt-${key}`, value])
    )
  );
}

/** A string as the page's data writes one. */
const STRING = String.raw`"(?:[^"\\]|\\.)*"`;
/** The org's intro film in the page's data: a flat object, or null. */
const INTRO_FILM = new RegExp(
  String.raw`introFilm:(\{(?:[^{}"]|${STRING})*\}|null)`
);
const FULL_FILM = /fullFilm:(?:true|false)/;

/** The first `key:"…"` in `text`, as written, or null. */
const stringAt = (text: string, key: string) =>
  new RegExp(`${key}:(${STRING})`).exec(text)?.[1] ?? null;

/** Where a test's intro film came from: the org's own, or a catalogue film's media. */
export type IntroFilmSource = 'real' | `injected:${string}`;

/**
 * The landing's HTML with an intro film played in full or as its preview, and
 * where the film came from, or null when there is none to play. The org's own
 * film is kept, only its `fullFilm` set. When it has none (CI's seed sets
 * none) the catalogue's newest film with a preview stands in. The page's
 * `fullFilm` is a hint: a press on a full film still asks the worker, which
 * re-checks and answers null when only the preview may play, and the player
 * then plays the preview.
 */
export function withIntroFilm(
  html: string,
  fullFilm: boolean
): { html: string; source: IntroFilmSource } | null {
  const match = INTRO_FILM.exec(html);
  if (!match) return null;
  const film =
    match[1] === 'null'
      ? standInFilm(html)
      : { text: match[1], source: 'real' as const };
  if (film === null || !FULL_FILM.test(film.text)) return null;
  const set = film.text.replace(FULL_FILM, `fullFilm:${fullFilm}`);
  return {
    html: html.replace(match[0], () => `introFilm:${set}`),
    source: film.source,
  };
}

/** The catalogue's newest film with a preview: its row, and that preview as written. */
function newestFilm(html: string): { text: string; previewUrl: string } | null {
  for (const { text } of catalogueRows(html)) {
    const previewUrl = stringAt(text, 'hlsPreviewUrl');
    if (text.includes('contentType:"video"') && previewUrl !== null)
      return { text, previewUrl };
  }
  return null;
}

/**
 * The catalogue's newest film with a preview, written as the page writes an
 * intro film and named by its media, or null. A row's first `title`,
 * `thumbnailUrl` and `mediaItemId` are its own: the objects inside it come
 * after them.
 */
function standInFilm(
  html: string
): { text: string; source: IntroFilmSource } | null {
  const film = newestFilm(html);
  if (!film) return null;
  const title = stringAt(film.text, 'title') ?? '""';
  const posterUrl = stringAt(film.text, 'thumbnailUrl') ?? 'null';
  const mediaId = stringAt(film.text, 'mediaItemId')?.slice(1, -1) ?? '?';
  return {
    text: `{title:${title},posterUrl:${posterUrl},previewUrl:${film.previewUrl},durationSeconds:30,fullFilm:false}`,
    source: `injected:${mediaId}`,
  };
}

/** The org's name in the page's data, as each of its rows names it. */
function orgName(html: string): string | null {
  const literal = new RegExp(`name:(${STRING}),slug:"${ORG}"`).exec(html)?.[1];
  return literal ? JSON.parse(literal) : null;
}

/**
 * The landing's HTML with the org named `name` wherever its seeded name is
 * (the markup's and the page data's), so the server and hydration both draw
 * it, or null when the page names no org. Plain names only: letters, digits,
 * spaces and `&`.
 *
 * Everywhere means everything titled with it too: OBB's first film carries
 * the org's name, so it is retitled with the rest (the words, the index, the
 * sizers). A test of the name reads the top bar's `.reel__name` alone, so the
 * film's title never decides it.
 */
function withOrgName(html: string, name: string): string | null {
  const seeded = orgName(html);
  if (!seeded) return null;
  const markup = (text: string) => text.replaceAll('&', '&amp;');
  return html
    .replaceAll(markup(seeded), () => markup(name))
    .replaceAll(seeded, () => name);
}

/** The title of the first piece in the server's own markup of the reel, or null. */
function serverFirstTitle(html: string): string | null {
  const span =
    /class="reel__item\b[^"]*"[^>]*>[\s\S]*?class="reel__t\b[^"]*"[^>]*>([\s\S]*?)<\/span>/.exec(
      html
    )?.[1];
  if (span === undefined) return null;
  return span
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/**
 * The catalogue's rows (`allContent`, newest first) as they stand in the
 * page's data, each with where it starts: the array's top-level objects,
 * read past strings so a brace inside one counts for nothing.
 */
function catalogueRows(html: string): { start: number; text: string }[] {
  const KEY = 'allContent:[';
  const at = html.indexOf(KEY);
  if (at < 0) return [];
  const rows: { start: number; text: string }[] = [];
  let depth = 0;
  let start = 0;
  let inString = false;
  for (let i = at + KEY.length; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}' || ch === ']') {
      if (depth === 0) break;
      depth--;
      if (depth === 0 && ch === '}')
        rows.push({ start, text: html.slice(start, i + 1) });
    }
  }
  return rows;
}

/**
 * A plain, bright picture (#F2F2F2, 128x123: the shape of OBB's own logo, so
 * the top bar lays out as it does with it) that every test of this file gets
 * in place of the catalogue's and the org's pictures.
 *
 * Those live on the dev CDN, which CI never starts: there every one fails,
 * and a failed still keeps its box unseen, so a test that needs a picture in
 * sight (the no-WebGL2 still, a recording's cover) failed on a fresh seed
 * while it passed on a local stack. A stand-in in every run keeps both on the
 * same path. Footage is left alone: the seed's previews hold no segments,
 * and the bundled Chromium decodes none.
 */
const STAND_IN_PICTURE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAIAAAAB7CAIAAAAzCR9GAAAAvUlEQVR42u3RMQEAAAzCMPzLRQH3FOxJJTSpXosFAAAIAAABACAAAAQAgAAAEAAAAgBAAAAIAAABACAAAAQAgAAAEAAAAgBAAAAIAAABACAAAAQAgAAAEAAAAgBAAAAIAAABACAAAAQAgAAAEAAAAgAAgAAAEAAAAgBAAAAIAAABACAAAAQAgAAAEAAAAgBAAAAIAAABACAAAAQAgAAAEAAAAgBAAAAIAAABACAAAAQAgAAAEAAAAgBAAADoNJptczOzXHqyAAAAAElFTkSuQmCC',
  'base64'
);
/** A picture by its path, for a request the browser types as something else. */
const PICTURE_PATH = /\.(?:avif|gif|jpe?g|png|svg|webp)$/i;

/**
 * The origin the catalogue's pictures are served from (the dev CDN, as the
 * seed writes their URLs), or null when no row has one.
 */
function picturesOrigin(html: string): string | null {
  for (const { text } of catalogueRows(html)) {
    const literal = stringAt(text, 'thumbnailUrl');
    if (literal === null) continue;
    try {
      return new URL(JSON.parse(literal)).origin;
    } catch {
      // not an absolute URL: the next row's
    }
  }
  return null;
}

/**
 * The landing's HTML with its newest recording that has a preview marked
 * featured, so the reel plays it, or null when the catalogue has no such
 * recording or no film with a preview. Its preview becomes the newest film's:
 * a seeded recording's own may be missing from the dev CDN (Sound Therapy's
 * 404s locally), and the theatre draws a recording as one whatever its
 * stream. A query of its own keeps it apart from the intro film's preview,
 * as `buildReel` drops a row whose preview is the film's. A row's own
 * `featured` is its only one: the objects inside it (its media, org and
 * creator) carry none.
 */
export function withRecordingFeatured(html: string): string | null {
  const film = newestFilm(html);
  const row = catalogueRows(html).find(
    ({ text }) =>
      text.includes('contentType:"audio"') &&
      stringAt(text, 'hlsPreviewUrl') !== null
  );
  if (!film || !row) return null;
  const url = film.previewUrl.slice(0, -1);
  const previewUrl = `${url}${url.includes('?') ? '&' : '?'}as=recording"`;
  const text = row.text
    .replace('featured:false', 'featured:true')
    .replace(
      new RegExp(`hlsPreviewUrl:${STRING}`),
      () => `hlsPreviewUrl:${previewUrl}`
    );
  return (
    html.slice(0, row.start) + text + html.slice(row.start + row.text.length)
  );
}

export interface ShowreelOptions {
  context?: BrowserContextOptions;
  keys?: Record<string, string>;
  /** Brand overrides besides the hero's, keyed as the editor saves them. */
  tokens?: Record<string, string>;
  init?: () => void;
  /**
   * An intro film, played in full (true) or as its preview (false). Opt-in:
   * a test that leaves it out sees the page's own film, or none.
   */
  introFilm?: { fullFilm: boolean };
  /** Put a recording with a preview in the reel. */
  featureRecording?: boolean;
  /** The org's name instead of its seeded one (`withOrgName`). */
  name?: string;
  /**
   * The top bar's logo request is held until this settles, then aborted, as
   * a logo whose CDN is down fails (CI starts no dev CDN, so there every
   * seeded logo fails). The test settles it once the page has hydrated and
   * painted, which is when dropping the logo's box would move the bar. The
   * page is opened at DOMContentLoaded: its load event waits on the logo.
   */
  failLogo?: Promise<unknown>;
  /**
   * Fail on what breaks the page as it loads (`loadBreaks`), as `introFilm`
   * and `featureRecording` do: for a test whose server paint and client draw
   * agree, where a `hydration_mismatch` is the page's, not the rewrite's.
   */
  guardHydration?: boolean;
}

/**
 * The landing as the Showreel (Corner unless `keys` say otherwise). Fails when
 * the page has no brand payload to set it on, or nothing to set `introFilm` or
 * `featureRecording` from.
 */
export async function openShowreel(
  browser: Browser,
  baseURL: string | undefined,
  {
    context: contextOptions = {},
    keys = {},
    tokens,
    init,
    introFilm,
    featureRecording = false,
    name,
    failLogo,
    guardHydration = false,
  }: ShowreelOptions = {}
): Promise<Page> {
  const url = `${orgOrigin(ORG, baseURL)}/`;
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ...contextOptions,
  });
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  // A rewrite of the reel's own data leaves the server's markup and the
  // client's apart, so its load must not break the page doing it.
  const broken =
    introFilm || featureRecording || guardHydration ? loadBreaks(page) : null;
  let served = 'no response';
  const unset: string[] = [];
  // Set in the route handler, so typed past the narrowing of `null`.
  let film = null as { source: IntroFilmSource; name: string | null } | null;
  let serverFirst = null as string | null;
  let pictures = null as string | null;
  // Every picture from the catalogue's origin is the stand-in
  // (`STAND_IN_PICTURE`). Registered first, so a later route wins over it:
  // `failLogo`'s hold on the logo.
  await context.route(
    (target) => pictures !== null && target.origin === pictures,
    (route) => {
      const request = route.request();
      const picture =
        request.resourceType() === 'image' ||
        PICTURE_PATH.test(new URL(request.url()).pathname);
      return picture
        ? route.fulfill({
            contentType: 'image/png',
            headers: { 'access-control-allow-origin': '*' },
            body: STAND_IN_PICTURE,
          })
        : route.fallback();
    }
  );
  await page.route(url, async (route) => {
    const response = await route.fetch();
    const html = await response.text();
    pictures = picturesOrigin(html);
    let body = withHeroOptions(html, {
      purpose: 'consume',
      comp: 'showreel',
      'reel-layout': 'corner',
      ...keys,
    });
    served = `HTTP ${response.status()}`;
    serverFirst = serverFirstTitle(html);
    if (body === null) unset.push('a brand payload');
    const set = (
      what: string,
      rewrite: (html: string) => string | null
    ): void => {
      if (body === null) return;
      const next = rewrite(body);
      if (next === null) unset.push(what);
      else body = next;
    };
    // First, so every rewrite after it reads the name the page will draw.
    if (name) set('an org name', (doc) => withOrgName(doc, name));
    if (tokens) set('brand overrides', (doc) => withOverrides(doc, tokens));
    if (introFilm)
      set('an intro film', (doc) => {
        const done = withIntroFilm(doc, introFilm.fullFilm);
        if (done) film = { source: done.source, name: orgName(doc) };
        return done?.html ?? null;
      });
    if (featureRecording)
      set('a recording with a preview', withRecordingFeatured);
    if (failLogo) {
      const logo = /class="reel__sig[^"]*">(?:<!--[^>]*-->)?<img src="([^"]+)"/
        .exec(body ?? html)?.[1]
        ?.replaceAll('&amp;', '&');
      if (logo)
        await context.route(
          (target) => target.href === logo,
          async (logoRoute) => {
            await failLogo;
            await logoRoute.abort();
          }
        );
      else unset.push('a logo in the top bar to fail');
    }
    await route.fulfill({ response, body: body ?? undefined });
  });
  await page.goto(url, failLogo ? { waitUntil: 'domcontentloaded' } : {});
  // An error page has no payload either, so the status says which this is.
  expect(unset, `what ${ORG}'s landing (${served}) lacks`).toEqual([]);
  await expect(page.locator('.reel')).toBeVisible({ timeout: 30_000 });
  // The server draws the Showreel too (the consume default), so in sight is
  // not yet hydrated, and a click then does nothing. The bar's first write
  // (`--_progress`) is the browser's own: the reel is live from there. It is
  // written as the reel hydrates, so no other mark comes sooner: missing, the
  // page itself was slow to hydrate (a loaded dev server), not the reel.
  await expect(
    page.locator('.reel'),
    'server-drawn, not hydrated after 30 s'
  ).toHaveAttribute('style', /--_progress/, { timeout: 30_000 });
  if (film) await filmLeads(page, film, serverFirst);
  if (broken) expect(broken, 'what broke as the page loaded').toEqual([]);
  return page;
}

/**
 * What breaks a page as it loads: an uncaught error, or Svelte giving up on
 * the server's markup (`hydration_mismatch`), which it repairs by drawing the
 * page again. An attribute it keeps at the server's value
 * (`hydration_attribute_changed`) is noted on the test, not failed: the
 * rewrite moves which piece sits where.
 */
function loadBreaks(page: Page): string[] {
  const broken: string[] = [];
  page.on('pageerror', (error) => broken.push(`uncaught: ${error.message}`));
  page.on('console', (message) => {
    const text = message.text();
    if (/hydration_mismatch|hydration failed/i.test(text))
      broken.push(`${message.type()}: ${text}`);
    else if (/hydration_attribute_changed/.test(text))
      test.info().annotations.push({ type: 'hydration', description: text });
  });
  return broken;
}

/**
 * The intro film leads the reel (`buildReel`), its title the org's name: in
 * the hydrated page always, and in the server's own markup when it is the
 * org's real film. An injected film is the browser's alone, as the server
 * rendered before the rewrite. Which ran is noted on the test.
 */
async function filmLeads(
  page: Page,
  film: { source: IntroFilmSource; name: string | null },
  serverFirst: string | null
): Promise<void> {
  test.info().annotations.push(
    { type: 'intro film', description: film.source },
    {
      type: "server's first piece",
      description: serverFirst ?? '(no reel in the markup)',
    }
  );
  expect(film.name, `${ORG}'s name in the page's data`).not.toBeNull();
  await expect(
    page.locator('.reel .reel__item .reel__t').first(),
    'the hydrated reel leads with the film'
  ).toHaveText(film.name ?? '');
  if (film.source === 'real')
    expect(serverFirst, "the server's markup leads with the film").toBe(
      film.name
    );
}

/** The piece the index says is playing. */
export const currentPiece = (page: Page) =>
  page.locator('.reel [aria-current="true"] .reel__t');

/** Somewhere over the frame, off the words, the index and the strip. */
export const offTheWords = (page: Page) => page.mouse.move(720, 220);
