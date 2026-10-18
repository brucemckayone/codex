/**
 * Every heading's fit knows the line its layout gives it (Codex-61zsk.69;
 * 03 X66, X71): what Heading divides a run's weight into (`--_column`, the
 * section's column or the room a layout names) is never wider than the line
 * the heading is drawn on. A room reckoned too wide lets a word long enough
 * to engage the fit, in a wide face or a large Type, run past its line: the
 * story's scroll fitted its titles to the section's 699px at 768 in a words
 * column of 340px, and drew "Transformation" 363px wide in Unbounded under
 * Bold's Type.
 *
 * OPT-IN, LOCAL: `HEADING_ROOM=1 pnpm exec playwright test heading-room`. It
 * drives the page kit's gallery (`/studio/page-kit`), a development route
 * that a production build (CI's) does not have. Run it on any change to a
 * layout's columns, a card's padding or a strip's items, and with
 * `louder-fit`, which reads the words themselves in every face and Type on
 * the sample page and the layouts with titles: a room is the Style's, never
 * a Type's (03 X73), so this reads each Style once, in its own Type.
 *
 * Every layout of every type but the hero (whose fit `type-fit` reads), in
 * each Style at five widths, with the gallery's pictures and without them
 * (`media=off`): page k draws every type at its k-th layout. Each heading is
 * set to a long run of short words, so a box that shrinks to its words (a
 * centred band's) fills its room, and again to one word longer than any
 * room, so a box that grows from its words (the offer's band, 03 X70) wraps
 * its row and takes its room: a line is short only if it is short in both.
 * It is read unrounded, from its used width (untransformed: Studio tilts its
 * cards). A flex item's minimum is its longest word, which wraps what sits
 * beside it instead, so its line is its row's. Two lines are not a room: a heading held at its size
 * (`--lp-heading-hold`) is not fitted, and a heading capped in its own `ch`
 * (a closing band's 18ch) is a count of characters, not a room the fit can
 * know (louder-fit reads the words against it).
 *
 * `HEADING_ROOM_STYLES`, `HEADING_ROOM_WIDTHS` and `HEADING_ROOM_PAGES`
 * (0–4) narrow the run, to calibrate a plant fast; `ROOM_OUT=<file.json>`
 * writes every heading's room and line.
 */
import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { SECTION_LAYOUTS } from '../../src/lib/page-builder/kit/model/ids';
import { captureSeededCreatorCookies } from '../helpers/subscription';

test.skip(
  !process.env.HEADING_ROOM,
  'opt-in: HEADING_ROOM=1 (a development route, ~2 h)'
);
test.setTimeout(150 * 60_000);

const narrow = (name: string) => (value: string | number) =>
  !process.env[name] || process.env[name].split(',').includes(String(value));
const STYLES = [
  'bold',
  'clean',
  'soft',
  'cinematic',
  'path',
  'poster',
  'studio',
  'quiet',
].filter(narrow('HEADING_ROOM_STYLES'));
const WIDTHS = [360, 390, 768, 1024, 1440].filter(
  narrow('HEADING_ROOM_WIDTHS')
);
const TYPES = (
  Object.keys(SECTION_LAYOUTS) as (keyof typeof SECTION_LAYOUTS)[]
).filter((type) => type !== 'hero');
const MOST = Math.max(...TYPES.map((type) => SECTION_LAYOUTS[type].length));
/** Page k draws every type at its k-th layout, wrapping, so each is drawn. */
const PAGES = Array.from({ length: MOST }, (_, k) => {
  const layout = TYPES.map((type) => {
    const layouts = SECTION_LAYOUTS[type];
    return `${type}:${layouts[k % layouts.length]}`;
  }).join(',');
  return { k, extra: `only=${TYPES.join(',')}&layout=${layout}&offer=tiers` };
}).filter(({ k }) => narrow('HEADING_ROOM_PAGES')(k));
/** A long run of short words: it fills whatever room its box may take. */
const FILL = Array.from({ length: 40 }, () => 'mm').join(' ');
/** One word longer than any room, for the second read. */
const LONG = 'm'.repeat(160);

test('a heading is fitted to the line its layout gives it', async ({
  browser,
}) => {
  const cookies = await captureSeededCreatorCookies();
  const faults: string[] = [];
  const rows: Record<string, unknown>[] = [];
  let read = 0;
  for (const width of WIDTHS) {
    // Reduced motion, so no entrance moves a heading while it is read.
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      reducedMotion: 'reduce',
    });
    await context.addCookies(cookies);
    const page = await context.newPage();
    for (const style of STYLES)
      for (const { k, extra } of PAGES)
        for (const bare of [false, true]) {
          const at = `${width} ${style} p${k}${bare ? ' bare' : ''}`;
          // A page that does not load is a fault, not the end of the run.
          // The first section (a Video with no film) may draw nothing
          // visible, so the page is waited for, not its first band.
          try {
            await page.goto(
              `http://studio-alpha.lvh.me:5173/studio/page-kit?style=${style}&brand=0&theme=light&chrome=0&${extra}${bare ? '&media=off' : ''}`
            );
            await page
              .locator('.lp .lp-section')
              .first()
              .waitFor({ state: 'attached', timeout: 60_000 });
          } catch (error) {
            faults.push(
              `${at}: the gallery did not load: ${String(error).split('\n')[0]}`
            );
            console.log(`FAULT ${faults.at(-1)}`);
            continue;
          }
          await page.evaluate(() => document.fonts.ready);
          const headings = await page.evaluate(
            async ({ fill, long }) => {
              const root = document.querySelector('.lp') as HTMLElement;
              const all = [
                ...root.querySelectorAll<HTMLElement>(
                  '.lp-section .lp-heading'
                ),
              ].filter(
                (h) =>
                  h.closest('.lp-section')?.getAttribute('data-lp-type') !==
                  'hero'
              );
              // A grid item's box is held to its room, as louder-fit holds it.
              for (const h of all) {
                h.style.transition = 'none';
                if (
                  h.parentElement &&
                  /grid/.test(getComputedStyle(h.parentElement).display)
                )
                  h.style.minInlineSize = '0';
                h.textContent = fill;
              }
              await new Promise((done) =>
                requestAnimationFrame(() => requestAnimationFrame(done))
              );
              const content = (el: HTMLElement) => {
                const cs = getComputedStyle(el);
                const width = Number.parseFloat(cs.width);
                return cs.boxSizing === 'border-box'
                  ? width -
                      [
                        cs.paddingLeft,
                        cs.paddingRight,
                        cs.borderLeftWidth,
                        cs.borderRightWidth,
                      ].reduce((sum, px) => sum + Number.parseFloat(px), 0)
                  : width;
              };
              // A length as the heading resolves it: a probe drawn at it, in
              // the face it is read in. The fit's room is read in `font-size`,
              // where a `ch` or an `em` is the PARENT's face (a head box's 62ch
              // is the body's); a cap on the heading's own box is its own.
              const px = (
                h: HTMLElement,
                value: string,
                face?: HTMLElement
              ) => {
                const probe = document.createElement('span');
                probe.style.cssText = `position:absolute;visibility:hidden;display:block;inline-size:${value}`;
                if (face) {
                  const fcs = getComputedStyle(face);
                  for (const key of [
                    'fontFamily',
                    'fontSize',
                    'fontWeight',
                    'fontStretch',
                    'fontStyle',
                    'fontVariationSettings',
                  ] as const)
                    probe.style[key] = fcs[key];
                }
                h.appendChild(probe);
                const w = probe.getBoundingClientRect().width;
                probe.remove();
                return w;
              };
              const lineOf = (h: HTMLElement) => {
                const parent = h.parentElement as HTMLElement;
                return /flex/.test(getComputedStyle(parent).display)
                  ? content(parent)
                  : content(h);
              };
              const read = all.map((h) => {
                const cs = getComputedStyle(h);
                const parent = h.parentElement as HTMLElement;
                const section = h.closest('.lp-section') as HTMLElement;
                return {
                  where: `${section.dataset.lpType}/${section.dataset.lpLayout} ${h.dataset.size}`,
                  holder: parent.className
                    .split(' ')
                    .filter((c) => c && !c.startsWith('s-'))
                    .join('.'),
                  room: px(h, 'var(--_column)', parent),
                  line: lineOf(h),
                  cap:
                    cs.maxInlineSize === 'none'
                      ? null
                      : px(h, cs.maxInlineSize),
                  held: cs.getPropertyValue('--lp-heading-hold').trim() === '1',
                  grown: 0,
                };
              });
              // Read again with one word longer than any room: a box that grows
              // from its words (a band's head beside its price, 03 X70) wraps
              // its row and takes its room, while a track it cannot leave still
              // holds it. Over is a line short of its room in both reads.
              for (const h of all) h.textContent = long;
              await new Promise((done) =>
                requestAnimationFrame(() => requestAnimationFrame(done))
              );
              all.forEach((h, i) => {
                read[i].grown = lineOf(h);
              });
              return read;
            },
            { fill: FILL, long: LONG }
          );
          read++;
          for (const h of headings) {
            rows.push({ width, style, page: k, bare, ...h });
            const ownCap = h.cap !== null && Math.abs(h.cap - h.line) <= 0.5;
            const short = Math.max(h.line, h.grown);
            if (!h.held && !ownCap && h.room > short + 0.5) {
              faults.push(
                `${at} ${h.where} (${h.holder}): the fit reckons ${h.room.toFixed(1)}px for a line of ${short.toFixed(1)}px`
              );
              console.log(`FAULT ${faults.at(-1)}`);
            }
          }
          // A layout page draws every type but a Picture with no picture.
          expect(headings.length, `${at} has headings`).toBeGreaterThan(15);
        }
    await context.close();
  }
  console.log(`${read} pages read, ${faults.length} faults`);
  if (process.env.ROOM_OUT)
    writeFileSync(process.env.ROOM_OUT, JSON.stringify(rows));
  expect(faults, faults.join('\n')).toEqual([]);
});
