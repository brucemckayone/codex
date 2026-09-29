/**
 * The page kit's interactive components in a real browser
 * (docs/design/landing-builder/03-expressive-contract.md §7; §11 "keyboard
 * tests for tabs, disclosure, marquee pause and strip buttons"), on the seeded
 * portal pages a visitor sees, signed out. `db:seed:portals` runs in CI's E2E
 * Web job, so every test here runs in CI:
 *
 *   the journey map     Return to the Shoreline · curriculum `map`
 *   before and after    Ancestral Threads · transformation `toggle`
 *   a strip             Bone Deep · gallery `strip`
 *
 * Each subject is PINNED on its section in seed-portals.ts (`PortalSpec.pins`),
 * never left to a Style's default, and each test first asserts that its
 * subject is there: a missing subject fails, it never skips.
 *
 * The marquee is on no seeded page (the portals carry no testimonials), so its
 * pause control is covered beside the component instead
 * (`blocks/testimonials/TestimonialsBlock.svelte.test.ts`).
 *
 * One page at a time, in order: parallel loads have 503'd before.
 */
import { expect, type Locator, type Page, test } from '@playwright/test';
import {
  expectSellPageRendered,
  type JourneyFixture,
  journeyFixture,
  journeyUrl,
} from '../helpers/journeys';

test.describe.configure({ mode: 'default' });
test.use({ viewport: { width: 1440, height: 900 } });

const SHORELINE = journeyFixture(
  'of-blood-and-bones',
  'return-to-the-shoreline'
);
const ANCESTRAL = journeyFixture('of-blood-and-bones', 'ancestral-threads');
const BONE_DEEP = journeyFixture('of-blood-and-bones', 'bone-deep');

/**
 * Open a seeded page and return its `type` section in `layout`, failing with
 * the way back when the seed has lost it.
 */
async function openSubject(
  page: Page,
  baseURL: string | undefined,
  fixture: JourneyFixture,
  type: string,
  layout: string
): Promise<Locator> {
  await page.goto(journeyUrl(baseURL as string, fixture));
  await expectSellPageRendered(page, fixture);
  const section = page.locator(
    `.lp-section[data-lp-type="${type}"][data-lp-layout="${layout}"]`
  );
  await expect(
    section,
    `${fixture.org}/${fixture.pageSlug} has no ${type} section in the \`${layout}\` layout — seed-portals.ts pins it there (PortalSpec.pins); run db:seed:portals`
  ).toHaveCount(1);
  return section;
}

/** Keyboard focus shows a ring (§7, R14). */
async function expectFocusRing(target: Locator): Promise<void> {
  expect(
    await target.evaluate(
      (element) =>
        element.matches(':focus-visible') &&
        getComputedStyle(element).outlineStyle !== 'none'
    )
  ).toBe(true);
}

test.describe('journey map · Return to the Shoreline', () => {
  let map: Locator;

  test.beforeEach(async ({ page, baseURL }) => {
    const section = await openSubject(
      page,
      baseURL,
      SHORELINE,
      'curriculum',
      'map'
    );
    map = section.locator('ol.map');
  });

  const stops = () => map.locator('details.map__stop');

  test('is an ordered list of stops; the first that holds anything starts open', async () => {
    await expect(map.locator(':scope > li.map__stage')).toHaveCount(3);
    // Every seeded stage holds practices, so every stop is a disclosure.
    await expect(stops()).toHaveCount(3);
    expect(
      await stops().evaluateAll((all) =>
        all.map((stop) => (stop as HTMLDetailsElement).open)
      )
    ).toEqual([true, false, false]);
    // A summary carries the stage's number, its name and its practice count.
    const summary = stops().first().locator('summary');
    await expect(summary.locator('.map__marker')).toContainText('1');
    await expect(summary.locator('.map__name')).not.toBeEmpty();
    await expect(summary.locator('.map__count')).not.toBeEmpty();
    // The drawn route is decoration.
    expect(
      await map
        .locator('svg')
        .evaluateAll((all) =>
          all.every((svg) => svg.getAttribute('aria-hidden') === 'true')
        )
    ).toBe(true);
  });

  test('choosing a stop opens it and shows its practices', async () => {
    const second = stops().nth(1);
    const inside = second.locator('.map__inside');
    await expect(inside).toBeHidden();
    await second.locator('summary').click();
    await expect(second).toHaveAttribute('open', '');
    await expect(inside).toBeVisible();
    await expect(inside.locator('li').first()).toBeVisible();
  });

  test('keyboard: Tab reaches the next stop, Enter opens it and Space closes it', async ({
    page,
  }) => {
    await stops().nth(1).locator('summary').focus();
    await page.keyboard.press('Tab');
    const third = stops().nth(2);
    const summary = third.locator('summary');
    await expect(summary).toBeFocused();
    await expectFocusRing(summary);
    await page.keyboard.press('Enter');
    await expect(third).toHaveAttribute('open', '');
    await page.keyboard.press('Space');
    await expect(third).not.toHaveAttribute('open', '');
  });
});

test.describe('before and after · Ancestral Threads', () => {
  let toggle: Locator;

  test.beforeEach(async ({ page, baseURL }) => {
    const section = await openSubject(
      page,
      baseURL,
      ANCESTRAL,
      'transformation',
      'toggle'
    );
    toggle = section.locator('.tf-toggle');
    await expect(
      toggle,
      'the toggle stayed two columns: at 1440×900 it starts below the fold, where the page’s script turns it into tabs (03 §13 X8)'
    ).toHaveAttribute('data-tabs', '');
  });

  const panel = (side: 'before' | 'after') =>
    toggle.locator(`.tf-toggle__panel[data-side="${side}"]`);

  test('tabs that switch between the two sides, and say which is shown', async () => {
    const tabs = toggle.getByRole('tab');
    await expect(tabs).toHaveCount(2);
    const [before, after] = [tabs.nth(0), tabs.nth(1)];
    await expect(toggle.getByRole('tablist')).toHaveAttribute(
      'aria-label',
      /\S/
    );
    for (const [tab, side] of [
      [before, 'before'],
      [after, 'after'],
    ] as const) {
      await expect(tab).toHaveAttribute(
        'aria-controls',
        (await panel(side).getAttribute('id')) ?? 'missing'
      );
      await expect(panel(side)).toHaveAttribute(
        'aria-labelledby',
        (await tab.getAttribute('id')) ?? 'missing'
      );
    }

    await expect(before).toHaveAttribute('aria-selected', 'true');
    await expect(before).toHaveAttribute('tabindex', '0');
    await expect(after).toHaveAttribute('aria-selected', 'false');
    await expect(after).toHaveAttribute('tabindex', '-1');
    await expect(panel('before')).toBeVisible();
    await expect(panel('after')).toBeHidden();

    await after.click();
    await expect(after).toHaveAttribute('aria-selected', 'true');
    await expect(before).toHaveAttribute('aria-selected', 'false');
    await expect(panel('after')).toBeVisible();
    await expect(panel('before')).toBeHidden();
  });

  test('keyboard: the arrow keys, Home and End move the selection with the focus', async ({
    page,
  }) => {
    const tabs = toggle.getByRole('tab');
    const [before, after] = [tabs.nth(0), tabs.nth(1)];
    const selected = async (tab: Locator) => {
      await expect(tab).toBeFocused();
      await expect(tab).toHaveAttribute('aria-selected', 'true');
    };

    await before.focus();
    await page.keyboard.press('ArrowRight');
    await selected(after);
    await expectFocusRing(after);
    await expect(panel('after')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await selected(before);
    await page.keyboard.press('ArrowLeft');
    await selected(after);
    await page.keyboard.press('Home');
    await selected(before);
    await page.keyboard.press('End');
    await selected(after);
    await expect(panel('before')).toBeHidden();
  });
});

test.describe('before and after · without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('both sides read side by side, as the columns layout', async ({
    page,
    baseURL,
  }) => {
    const section = await openSubject(
      page,
      baseURL,
      ANCESTRAL,
      'transformation',
      'toggle'
    );
    await expect(section.getByRole('tablist')).toHaveCount(0);
    for (const side of ['before', 'after']) {
      const column = section.locator(`.tf-col[data-side="${side}"]`);
      await expect(column).toBeVisible();
      await expect(column.locator('li')).toHaveCount(3);
    }
  });
});

test.describe('strip · Bone Deep', () => {
  let strip: Locator;

  test.beforeEach(async ({ page, baseURL }) => {
    const section = await openSubject(
      page,
      baseURL,
      BONE_DEEP,
      'gallery',
      'strip'
    );
    strip = section.locator('.lp-strip');
  });

  const region = () => strip.getByRole('region');
  const buttons = () => strip.locator('.lp-strip__move');
  const scrollLeft = () =>
    region().evaluate((element) => Math.round(element.scrollLeft));

  /** Where each item sits from the first, and the furthest the row scrolls. */
  const geometry = () =>
    region().evaluate((track) => {
      const items = [
        ...track.querySelectorAll(':scope > .lp-strip__items > li'),
      ];
      const origin = items[0].getBoundingClientRect().left + track.scrollLeft;
      return {
        starts: items.map((item) =>
          Math.round(
            item.getBoundingClientRect().left + track.scrollLeft - origin
          )
        ),
        max: track.scrollWidth - track.clientWidth,
      };
    });

  test('is a labelled region that snaps, and the keyboard can focus and scroll', async ({
    page,
  }) => {
    await expect(region()).toHaveAttribute('aria-label', /\S/);
    expect(
      await region().evaluate((track) => getComputedStyle(track).scrollSnapType)
    ).toBe('x mandatory');
    await region().focus();
    await expect(region()).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect.poll(scrollLeft).toBeGreaterThan(0);
  });

  test('the buttons move one item at a time and rest, still focusable, at each end', async ({
    page,
  }) => {
    const [previous, next] = [buttons().first(), buttons().last()];
    // "next" stops resting once the page's script has measured the row.
    await expect(previous).toHaveAttribute('aria-disabled', 'true');
    await expect(next).toHaveAttribute('aria-disabled', 'false');
    const { starts, max } = await geometry();
    expect(max, 'the row must be wider than the screen').toBeGreaterThan(0);

    // From the region, Tab reaches the buttons: the resting one too.
    await region().focus();
    await page.keyboard.press('Tab');
    await expect(previous).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(next).toBeFocused();
    await expectFocusRing(next);

    await page.keyboard.press('Enter');
    await expect.poll(scrollLeft).toBe(Math.min(starts[1], Math.round(max)));
    await expect(previous).toHaveAttribute('aria-disabled', 'false');

    // On to the end: the button rests there and keeps the keyboard's place.
    for (let step = 2; step < starts.length; step++) {
      if ((await next.getAttribute('aria-disabled')) === 'true') break;
      const before = await scrollLeft();
      await page.keyboard.press('Enter');
      await expect.poll(scrollLeft).toBeGreaterThan(before);
    }
    await expect(next).toHaveAttribute('aria-disabled', 'true');
    await expect(next).toBeFocused();
    const atEnd = await scrollLeft();
    await page.keyboard.press('Enter');
    expect(await scrollLeft()).toBe(atEnd);

    await previous.click();
    await expect.poll(scrollLeft).toBeLessThan(atEnd);
    await expect(next).toHaveAttribute('aria-disabled', 'false');
  });

  test('a move glides, and under reduced motion it jumps', async ({ page }) => {
    // The sections are in the server's HTML before the page's script runs;
    // "next" stops resting only once the script has measured the row.
    await expect(buttons().last()).toHaveAttribute('aria-disabled', 'false');
    // Read in the same task as the click: a smooth scroll has not begun yet;
    // an instant one is already there.
    const clickAndRead = (button: 'previous' | 'next') =>
      strip.evaluate(
        (row, index) => {
          const track = row.querySelector<HTMLElement>('.lp-strip__track');
          const move =
            row.querySelectorAll<HTMLElement>('.lp-strip__move')[index];
          if (!track || !move)
            throw new Error('the strip has no track or buttons');
          move.click();
          return Math.round(track.scrollLeft);
        },
        button === 'next' ? 1 : 0
      );
    const { starts, max } = await geometry();
    const second = Math.min(starts[1], Math.round(max));

    expect(await clickAndRead('next')).toBe(0);
    // Let the glide finish before the next move, so no scroll overlaps it.
    await expect.poll(scrollLeft).toBe(second);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await clickAndRead('previous')).toBe(0);
  });
});
