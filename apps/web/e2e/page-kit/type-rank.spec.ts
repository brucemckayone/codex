/**
 * Words drawn at their rank (docs/design/landing-builder/03-expressive-contract.md
 * X55), on the seeded reference page a visitor sees, signed out, at 1440×900:
 *
 *   the change     Ancestral Threads · transformation `toggle`, wide: the after
 *                  lines are the loudest thing in the section (the heading's
 *                  face, larger than the before lines)
 *   the promises   Ancestral Threads · benefits `grid`: each item's name at a
 *                  middle size, two fifths of the way from the Style's title
 *                  size to its heading's (three to a row)
 *
 * Both subjects are pinned on their sections in seed-portals.ts
 * (`PortalSpec.pins`); a missing subject fails, it never skips.
 */
import { expect, type Locator, type Page, test } from '@playwright/test';
import {
  expectSellPageRendered,
  journeyFixture,
  journeyUrl,
} from '../helpers/journeys';

test.describe.configure({ mode: 'default' });
test.use({ viewport: { width: 1440, height: 900 } });

const ANCESTRAL = journeyFixture('of-blood-and-bones', 'ancestral-threads');

async function sectionOf(
  page: Page,
  type: string,
  layout: string
): Promise<Locator> {
  const section = page.locator(
    `.lp-section[data-lp-type="${type}"][data-lp-layout="${layout}"]`
  );
  await expect(
    section,
    `ancestral-threads has no ${type} section in the \`${layout}\` layout — seed-portals.ts pins it there (PortalSpec.pins); run db:seed:portals`
  ).toHaveCount(1);
  return section;
}

test.describe('type at its rank · Ancestral Threads', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await page.goto(journeyUrl(baseURL as string, ANCESTRAL));
    await expectSellPageRendered(page, ANCESTRAL);
  });

  test('the change: the after lines are the loudest thing in the section', async ({
    page,
  }) => {
    const section = await sectionOf(page, 'transformation', 'toggle');
    // Measured once the page's script has placed it, never before: a phone
    // width shows the switch (the script is live), and wide again the columns.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(section.getByRole('tablist')).toHaveCount(1);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(section.getByRole('tablist')).toHaveCount(0);
    const read = await section.evaluate((root) => {
      const type = (selector: string) => {
        const element = root.querySelector(selector);
        if (!element) return null;
        const style = getComputedStyle(element);
        return {
          size: Number.parseFloat(style.fontSize),
          family: style.fontFamily,
        };
      };
      return {
        heading: type('.lp-heading'),
        before: type('.tf-col[data-side="before"] li'),
        after: type('.tf-col[data-side="after"] li'),
      };
    });
    expect(read.before).not.toBeNull();
    expect(read.after).not.toBeNull();
    // In the heading's face, so the change is told in type as well as colour.
    expect(read.after?.family).toBe(read.heading?.family);
    expect(read.before?.family).not.toBe(read.heading?.family);
    // A step up from the before lines, not a nudge.
    expect(read.after?.size ?? 0).toBeGreaterThanOrEqual(
      (read.before?.size ?? Number.POSITIVE_INFINITY) * 1.2
    );
  });

  test('the promises: each name at a middle size in the Style’s own scale', async ({
    page,
  }) => {
    const section = await sectionOf(page, 'benefits', 'grid');
    const names = section.locator('.benefits-grid .lp-heading');
    await expect(names).toHaveCount(3);
    const read = await names.evaluateAll((elements) =>
      elements.map((name) => {
        // The Style's two sizes, resolved where the name is (their `cqi`
        // against the same container), by drawing each as a width.
        const probe = (size: string) => {
          const ruler = document.createElement('div');
          ruler.style.cssText = `position:absolute;visibility:hidden;inline-size:${size}`;
          name.parentElement?.append(ruler);
          const width = ruler.getBoundingClientRect().width;
          ruler.remove();
          return width;
        };
        return {
          size: Number.parseFloat(getComputedStyle(name).fontSize),
          title: probe('var(--lp-size-title)'),
          heading: probe('var(--lp-size-heading)'),
        };
      })
    );
    for (const { size, title, heading } of read) {
      expect(heading).toBeGreaterThan(title);
      expect(size).toBeCloseTo(title + (heading - title) * 0.4, 0);
    }
  });
});
