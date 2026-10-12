/**
 * Path's route stops on each section's heading (Codex-61zsk.26), on the seeded
 * Path page a visitor sees, signed out: of-blood-and-bones' Return to the
 * Shoreline, at a phone's width and wide.
 *
 * The stop's height is `--_path-y` (`style-path.css`), worked out from the
 * section's padding, its eyebrow and its heading's size, never measured. So a
 * section that puts anything above its heading moves the heading and not the
 * stop: the guide's split, stacked, puts its portrait there, and its stop sat
 * 412px above "Meet your guide" at 390. The stop is read here as the route
 * reads it (the length resolved on the section) and held to the middle of its
 * heading's first line, as drawn at rest, in every section. Each seeded section is
 * pinned (`SEEDED_SECTIONS`); the guide's portrait is asserted, so its stacked
 * case is measured, never skipped.
 *
 * Except a cover hero, which the seed pins for this org. Its words are set at
 * the foot of the band (`align-content: end`), so where its headline starts
 * depends on how tall the words run, which no length worked out from the top
 * can know. Path sets its route out from the cover's foot instead
 * (`style-path.css`, the cover rule). The cover is held to that: its stop sits
 * below the last of its words, so the route never runs through them, and
 * inside its own band.
 */
import { expect, test } from '@playwright/test';
import {
  expectSellPageRendered,
  journeyFixture,
  journeyUrl,
} from '../helpers/journeys';

test.describe.configure({ mode: 'default' });

const SHORELINE = journeyFixture(
  'of-blood-and-bones',
  'return-to-the-shoreline'
);

/** How far a stop may sit from its line's middle: rounding, never a layout. */
const SLACK = 2;

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
]) {
  test(`return-to-the-shoreline at ${viewport.width}: each route stop sits on its section's heading`, async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto(journeyUrl(baseURL as string, SHORELINE));
    await expectSellPageRendered(page, SHORELINE);
    await expect(page.locator('.lp')).toHaveAttribute('data-lp-style', 'path');
    await expect(
      page.locator(
        ".lp-section[data-lp-type='instructor'] > .lp-inner > .guide-split > .guide__portrait"
      ),
      'the guide is drawn split, with its portrait'
    ).toHaveCount(1);
    // At rest: the hero's words rise into place as the page opens
    // (`lp-rise-soft`, 800ms), and a heading read mid-rise sits up to 16px
    // low. The route's own animations run on the scroll and never end; none
    // of them moves a heading.
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(
        document
          .getAnimations()
          .filter(
            (animation) =>
              animation.timeline === document.timeline &&
              Number.isFinite(
                Number(animation.effect?.getComputedTiming().endTime)
              )
          )
          .map((animation) => animation.finished.catch(() => undefined))
      );
    });

    const stops = await page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          '.lp-page > .lp-section[data-lp-type]'
        ),
      ].map((section) => {
        // The length as the route's marks resolve it, inside the section.
        const probe = document.createElement('div');
        probe.style.cssText =
          'position:absolute;visibility:hidden;inset-block-start:0;block-size:var(--_path-y)';
        section.appendChild(probe);
        const stop = probe.getBoundingClientRect().height;
        probe.remove();
        const heading = section.querySelector('h1, h2');
        const box = section.getBoundingClientRect();
        const line = heading
          ? heading.getBoundingClientRect().top -
            box.top +
            Number.parseFloat(getComputedStyle(heading).lineHeight) / 2
          : null;
        // A cover's words: from its headline to the foot of its last line.
        const copy = section.querySelector('.hero-cover__copy');
        const words = copy?.lastElementChild?.getBoundingClientRect();
        return {
          type: section.dataset.lpType ?? '',
          cover: copy !== null,
          stop: Math.round(stop * 10) / 10,
          line: line === null ? null : Math.round(line * 10) / 10,
          wordsEnd: words
            ? Math.round((words.bottom - box.top) * 10) / 10
            : null,
          height: Math.round(box.height * 10) / 10,
        };
      })
    );

    expect(stops.map((s) => s.type)).toEqual(SHORELINE.sections);
    for (const { type, cover, stop, line, wordsEnd, height } of stops) {
      expect(line, `${type} has a heading`).not.toBeNull();
      if (type === 'hero' && cover) {
        expect(
          stop,
          `the cover's stop at ${stop}px sets out below its words (to ${wordsEnd}px)`
        ).toBeGreaterThan(wordsEnd ?? Number.POSITIVE_INFINITY);
        expect(
          stop,
          `the cover's stop at ${stop}px is inside its band (${height}px)`
        ).toBeLessThan(height);
        continue;
      }
      expect(
        Math.abs(stop - (line ?? 0)),
        `${type}: the stop at ${stop}px, its heading's first line at ${line}px`
      ).toBeLessThanOrEqual(SLACK);
    }
  });
}
