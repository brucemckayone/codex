/**
 * The Showreel on of-blood-and-bones' landing, without a DB write
 * (Codex-1yd58.6, .8): the landing's HTML is rewritten in the browser to set
 * the hero options the brand editor would save (`brandFineTune.tokenOverrides`,
 * the keys set last so they win). The server rendered the org's stored hero;
 * hydration redraws it as the Showreel, as a saved change would draw on the
 * next load. Shared by the Showreel's spec and its theatre's, so the setup
 * lives once; the origin comes from `origin.ts`, as every spec's does.
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

export const SHOWREEL_LAUNCH = {
  launchOptions: {
    args: [
      '--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights',
      '--autoplay-policy=no-user-gesture-required',
    ],
  },
};

/** The brand's stored overrides in the page's data: a JSON string, or null. */
const PAYLOAD = /brandFineTune:\{tokenOverrides:("(?:[^"\\]|\\.)*"|null)/;

/**
 * The landing's HTML with these hero options set as the editor saves them,
 * or null when it carries no brand payload to set them on.
 */
export function withHeroOptions(
  html: string,
  keys: Record<string, string>
): string | null {
  const match = PAYLOAD.exec(html);
  if (!match) return null;
  const stored: Record<string, string> =
    match[1] === 'null' ? {} : JSON.parse(JSON.parse(match[1]));
  const set = Object.fromEntries(
    Object.entries(keys).map(([key, value]) => [`hero-opt-${key}`, value])
  );
  const literal = JSON.stringify(JSON.stringify({ ...stored, ...set })).replace(
    /</g,
    '\\u003C'
  );
  return html.replace(
    match[0],
    () => `brandFineTune:{tokenOverrides:${literal}`
  );
}

/** The landing as the Showreel (Corner unless `keys` say otherwise); skips when OBB has no brand payload. */
export async function openShowreel(
  browser: Browser,
  baseURL: string | undefined,
  {
    context: contextOptions = {},
    keys = {},
    init,
  }: {
    context?: BrowserContextOptions;
    keys?: Record<string, string>;
    init?: () => void;
  } = {}
): Promise<Page> {
  const url = `${orgOrigin(ORG, baseURL)}/`;
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ...contextOptions,
  });
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  let rewritten = false;
  await page.route(url, async (route) => {
    const response = await route.fetch();
    const body = withHeroOptions(await response.text(), {
      purpose: 'consume',
      comp: 'showreel',
      'reel-layout': 'corner',
      ...keys,
    });
    rewritten = body !== null;
    await route.fulfill({ response, body: body ?? undefined });
  });
  await page.goto(url);
  test.skip(
    !rewritten,
    `${ORG}'s landing has no brand payload to set the Showreel on`
  );
  await expect(page.locator('.reel')).toBeVisible({ timeout: 30_000 });
  // The server draws the Showreel too (the consume default), so in sight is
  // not yet hydrated, and a click then does nothing. The bar's first write
  // (`--_progress`) is the browser's own: the reel is live from there.
  await expect(page.locator('.reel')).toHaveAttribute('style', /--_progress/, {
    timeout: 30_000,
  });
  return page;
}

/** The piece the index says is playing. */
export const currentPiece = (page: Page) =>
  page.locator('.reel [aria-current="true"] .reel__t');

/** Somewhere over the frame, off the words, the index and the strip. */
export const offTheWords = (page: Page) => page.mouse.move(720, 220);
