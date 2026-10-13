/**
 * An entrance's clip cuts no glyph of any Type its page may take
 * (Codex-61zsk.56; 03 X74, the data design's H2).
 *
 * OPT-IN, LOCAL: `TYPE_LIFT=1 pnpm exec playwright test type-lift`. It
 * drives the page kit's gallery (`/studio/page-kit`), a development route
 * that a production build (CI's) does not have, with its proof override
 * (`?type=`). Run it on any change to an entrance's keyframes, to a Type's
 * leading or case, or to the allow-list (`TYPE_FACET_BASES`).
 *
 * Some entrances draw a headline through a clip: Bold's lift rises through a
 * line under its last baseline, and Poster's wipe crosses it. The hero's keeps
 * its last frame (`fill-mode: both`), so its clip stays on the words for as
 * long as the page is open, an overhang past the line box tuned at the page's
 * own leading. A borrowed Type brings its own (Poster's 0.88, in capitals).
 * Bold's section headings lift the same way, and their clip goes once the
 * lift ends (the stage settles them), so their last frame is what is read.
 *
 * On each base and each Type it may take, once every entrance has ended, each
 * clipped headline is set to texts with descenders, ascenders and accents
 * over capitals, and pictured with its clip and again with none: any pixel
 * that differs is ink the clip cuts. The faces: the gallery's brands 0 and 3
 * (Archivo Black, Syne), and Anton and Unbounded, the narrowest and the
 * widest the brand editor offers, at 1440 and 390.
 *
 * A clip is the base's Motion, which no Type brings, so a base whose own
 * page clips no headline at a width is read once there and passed over.
 *
 * `TYPE_LIFT_ALL=1` reads every Type on every base, offered or not;
 * `TYPE_LIFT_BASES`, `TYPE_LIFT_FACES` and `TYPE_LIFT_WIDTHS` narrow the run.
 */
import { expect, type Page, test } from '@playwright/test';
import {
  TYPE_FACET_BASES,
  TYPE_FACETS,
} from '../../src/lib/page-builder/kit/model/ids';
import { captureSeededCreatorCookies } from '../helpers/subscription';

test.skip(!process.env.TYPE_LIFT, 'opt-in: TYPE_LIFT=1 (a development route)');
test.describe.configure({ mode: 'serial' });
test.setTimeout(120 * 60_000);

const BASES = (
  process.env.TYPE_LIFT_BASES ?? 'bold,clean,soft,cinematic,poster,quiet'
).split(',');
const WIDTHS = (process.env.TYPE_LIFT_WIDTHS ?? '1440,390')
  .split(',')
  .map(Number);
/** The page's own Type (`''`), then each it may take. */
function typesOf(base: string): string[] {
  const offered = process.env.TYPE_LIFT_ALL
    ? TYPE_FACETS.filter((type) => type !== base)
    : TYPE_FACET_BASES[base as keyof typeof TYPE_FACET_BASES];
  return ['', ...offered];
}
/** `TYPE_LIFT_FACES=Anton,3` narrows them (a face, or a brand's own). */
const FACES = [
  { brand: '0' },
  { brand: '3' },
  { brand: '0', face: 'Anton' },
  { brand: '0', face: 'Unbounded' },
].filter(
  ({ brand, face }) =>
    !process.env.TYPE_LIFT_FACES ||
    process.env.TYPE_LIFT_FACES.split(',').includes(face ?? brand)
);
/** Descenders, then ascenders, then accents over capitals. */
const TEXTS = [
  'Gypsy jugglers quietly pack',
  'Find the bold, lit hill',
  'Élan, Ångström and Öl',
];

async function useFace(page: Page, family: string) {
  await page.evaluate(async (family) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}:wght@400;700&display=block`;
    document.head.appendChild(link);
    await new Promise((done) => {
      link.onload = done;
      setTimeout(done, 8000);
    });
    const root = document.querySelector('.lp') as HTMLElement;
    root.style.setProperty('--brand-font-heading', `'${family}'`);
    root.style.setProperty('--font-heading', `'${family}'`);
    await document.fonts.load(`700 100px "${family}"`, 'ABC');
  }, family);
}

/** Every entrance played and ended: each section reached, then waited out. */
async function enterAll(page: Page) {
  await page.evaluate(async () => {
    // The site scrolls smoothly where motion is allowed (`base.css`): a box
    // read mid-scroll is off the screen, and two shots of a moving page
    // differ where nothing was cut.
    document.documentElement.style.scrollBehavior = 'auto';
    await document.fonts.ready;
    const step = window.innerHeight * 0.6;
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((done) => setTimeout(done, 150));
    }
    await new Promise((done) => setTimeout(done, 500));
    // Only what is running: an entrance the stage armed and never played
    // waits paused, and its `finished` never settles. Bounded all the same.
    await Promise.race([
      Promise.all(
        document
          .getAnimations()
          .filter(
            (a) =>
              a.playState === 'running' &&
              Number.isFinite(Number(a.effect?.getComputedTiming().endTime))
          )
          .map((a) => a.finished.catch(() => undefined))
      ),
      new Promise((done) => setTimeout(done, 10_000)),
    ]);
    window.scrollTo(0, 0);
  });
}

/**
 * Marks each clipped headline for reading, and returns how many: the hero's,
 * if its entrance kept a clip, and on Bold each section heading its lift
 * takes, given the lift's last frame (read from the sheet, so a change to the
 * keyframes is read too).
 */
async function markClipped(page: Page, base: string) {
  return page.evaluate((base) => {
    let n = 0;
    const hero = document.querySelector<HTMLElement>('.hero__enter-h');
    const heroClipped = Boolean(
      hero && getComputedStyle(hero).clipPath !== 'none'
    );
    if (hero && heroClipped) hero.dataset.liftProbe = String(n++);
    let lastFrame = '';
    if (base === 'bold') {
      for (const sheet of document.styleSheets) {
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        for (const rule of rules)
          if (rule instanceof CSSKeyframesRule && rule.name === 'lp-bold-lift')
            lastFrame =
              (rule.findRule('to') as CSSKeyframeRule | null)?.style.clipPath ??
              '';
      }
      for (const heading of document.querySelectorAll<HTMLElement>(
        '.lp-section:not([data-lp-type="hero"]) .lp-heading:is([data-size="display"], [data-size="heading"])'
      )) {
        // Not one the lift skips, and not one with no box (a closed panel's).
        if (
          heading.getClientRects().length === 0 ||
          heading.matches(
            '[data-lp-build], :is([data-lp-reveal], [data-lp-build], [data-lp-parallax]) *'
          )
        )
          continue;
        heading.style.clipPath = lastFrame;
        heading.dataset.liftProbe = String(n++);
      }
    }
    return { n, heroClipped, lastFrame };
  }, base);
}

/** How many pixels two shots differ by, and their first and last rows. */
async function differ(page: Page, a: Buffer, b: Buffer) {
  return page.evaluate(
    async ([a, b]) => {
      const bitmap = (b64: string) =>
        createImageBitmap(
          new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], {
            type: 'image/png',
          })
        );
      const [x, y] = await Promise.all([bitmap(a), bitmap(b)]);
      const canvas = new OffscreenCanvas(x.width, x.height);
      const g = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
      g.drawImage(x, 0, 0);
      const p = g.getImageData(0, 0, x.width, x.height).data;
      g.clearRect(0, 0, x.width, x.height);
      g.drawImage(y, 0, 0);
      const q = g.getImageData(0, 0, x.width, x.height).data;
      let n = 0;
      let top = Number.POSITIVE_INFINITY;
      let bottom = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < p.length; i += 4)
        if (p[i] !== q[i] || p[i + 1] !== q[i + 1] || p[i + 2] !== q[i + 2]) {
          n++;
          const row = Math.floor(i / 4 / x.width);
          top = Math.min(top, row);
          bottom = Math.max(bottom, row);
        }
      return { n, top, bottom };
    },
    [a.toString('base64'), b.toString('base64')] as const
  );
}

test('an entrance’s clip cuts no glyph of any Type', async ({ browser }) => {
  const cookies = await captureSeededCreatorCookies();
  const faults: string[] = [];
  let read = 0;
  for (const width of WIDTHS) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      reducedMotion: 'no-preference',
    });
    await context.addCookies(cookies);
    const page = await context.newPage();
    for (const base of BASES) {
      let clips = true;
      for (const type of typesOf(base))
        for (const { brand, face } of FACES) {
          if (!clips) continue;
          const name = `${width} ${base} as ${type || 'its own'} in ${face ?? `brand ${brand}`}`;
          await page.goto(
            `http://studio-alpha.lvh.me:5173/studio/page-kit?style=${base}${type ? `&type=${type}` : ''}&brand=${brand}&media=off&theme=light&chrome=0`
          );
          await page
            .locator('.lp .lp-section')
            .first()
            .waitFor({ timeout: 60_000 });
          if (face) await useFace(page, face);
          await enterAll(page);
          const { n, heroClipped, lastFrame } = await markClipped(page, base);
          if (n === 0 && !type) {
            clips = false;
            console.log(`ok ${name}: no entrance clips a headline here`);
            continue;
          }
          if (base === 'bold' && (!heroClipped || !lastFrame))
            faults.push(
              `${name}: the lift kept no clip to read (hero ${heroClipped}, last frame "${lastFrame}")`
            );
          let cut = 0;
          let unread = 0;
          for (const text of TEXTS)
            for (let i = 0; i < n; i++) {
              const probe = page.locator(`[data-lift-probe="${i}"]`);
              const box = await probe.evaluate((node, text) => {
                const heading = node.matches('.lp-heading')
                  ? node
                  : node.querySelector('.lp-heading');
                if (heading) heading.textContent = text;
                node.scrollIntoView({ block: 'center', behavior: 'instant' });
                const r = node.getBoundingClientRect();
                const em = Number.parseFloat(
                  getComputedStyle(heading ?? node).fontSize
                );
                return {
                  x: r.left - em * 0.6,
                  y: r.top - em * 0.8,
                  right: r.right + em * 0.6,
                  bottom: r.bottom + em * 0.8,
                  top: r.top,
                  foot: r.bottom,
                  em,
                };
              }, text);
              const x = Math.max(0, box.x);
              const y = Math.max(0, box.y);
              const clip = {
                x,
                y,
                width: Math.min(box.right, width) - x,
                height: Math.min(box.bottom, 900) - y,
              };
              const which = `${name}: headline ${i}${i === 0 && heroClipped ? ' (the hero)' : ''} "${text}"`;
              if (clip.width < 1 || clip.height < 1) {
                unread++;
                faults.push(`${which} could not be pictured`);
                continue;
              }
              const shot = () =>
                page.screenshot({ clip, animations: 'disabled' });
              const clipped = await shot();
              // The whole is drawn through a clip too, one too wide to cut:
              // no clip at all is drawn on another path, which moves pixels
              // where nothing was cut.
              const kept = await probe.evaluate((node) => {
                const was = node.style.clipPath;
                node.style.setProperty(
                  'clip-path',
                  'inset(-5em -5em)',
                  'important'
                );
                return was;
              });
              const whole = await shot();
              await probe.evaluate((node, kept) => {
                node.style.removeProperty('clip-path');
                if (kept) node.style.clipPath = kept;
              }, kept);
              read++;
              if (clipped.equals(whole)) continue;
              if (!clipped.equals(await shot())) {
                faults.push(`${which} drew differently twice, so was not read`);
                continue;
              }
              const lost = await differ(page, clipped, whole);
              const above = box.top - y - lost.top;
              const below = lost.bottom - (box.foot - y);
              const em = (px: number) =>
                `${Math.round(px)}px (${(px / box.em).toFixed(2)}em)`;
              cut++;
              faults.push(
                `${which} loses ${lost.n} pixels to its clip, from ${em(above)} above its box to ${em(below)} below it`
              );
              console.log(`CUT ${faults[faults.length - 1]}`);
            }
          // The instrument sees a cut: a clip into the first headline's own
          // box must lose ink, or every "whole" above proves nothing.
          if (n > 0) {
            const first = page.locator('[data-lift-probe="0"]');
            const region = await first.evaluate((node) => {
              node.scrollIntoView({ block: 'center', behavior: 'instant' });
              const r = node.getBoundingClientRect();
              return {
                x: Math.max(0, r.left),
                y: Math.max(0, r.top),
                width: Math.max(1, Math.min(r.width, innerWidth - r.left)),
                height: Math.max(1, Math.min(r.height, innerHeight - r.top)),
              };
            });
            const set = (value: string) =>
              first.evaluate(
                (node, value) =>
                  node.style.setProperty('clip-path', value, 'important'),
                value
              );
            await set('inset(0 0 50% 0)');
            const planted = await page.screenshot({
              clip: region,
              animations: 'disabled',
            });
            await set('inset(-5em -5em)');
            const open = await page.screenshot({
              clip: region,
              animations: 'disabled',
            });
            await first.evaluate((node) =>
              node.style.removeProperty('clip-path')
            );
            if (planted.equals(open))
              faults.push(
                `${name}: a planted cut was not seen, so nothing was read`
              );
          }
          console.log(
            `${cut ? 'FAULT' : 'ok'} ${name}: ${n} clipped headlines (hero ${heroClipped}), ${cut} cut, ${unread} off the page`
          );
        }
    }
    await context.close();
  }
  expect(read).toBeGreaterThan(0);
  expect(faults, faults.slice(0, 30).join('\n')).toEqual([]);
});
