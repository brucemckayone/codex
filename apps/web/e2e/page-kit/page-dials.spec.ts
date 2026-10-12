/**
 * The corners dial in the browser (docs/design/landing-builder/
 * 03-expressive-contract.md X61), on the seeded reference page a visitor
 * sees, signed out.
 *
 * `kit.css` draws the dial as one attribute above each Style's own tokens, so
 * it wins by specificity, not by load order: only a real cascade can show
 * that. On the page as served it reads the four corner tokens under the
 * page's own Style, under each step of the dial, under Soft, and under no
 * Style at all, and holds `brand` to the kit's own corners, `rounder` to
 * Soft's, and the page's own button to the dial. The page's corner inputs
 * are set first, so the steps differ whatever radius the seeded brand has.
 *
 * Which corners a page asks for is the renderer's (PageRenderer.svelte.test.ts);
 * colour and spacing are resolved per section and need no browser
 * (resolve.test.ts).
 */
import { expect, test } from '@playwright/test';
import {
  expectSellPageRendered,
  journeyFixture,
  journeyUrl,
} from '../helpers/journeys';

test.use({ viewport: { width: 1440, height: 900 } });

const ANCESTRAL = journeyFixture('of-blood-and-bones', 'ancestral-threads');

test('the corners dial wins over the Style, and the page draws it', async ({
  page,
  baseURL,
}) => {
  await page.goto(journeyUrl(baseURL as string, ANCESTRAL));
  await expectSellPageRendered(page, ANCESTRAL);

  const read = await page.evaluate(() => {
    const root = document.querySelector('.lp') as HTMLElement;
    const button = root.querySelector('.lp-button') as HTMLElement | null;
    const style = root.dataset.lpStyle ?? '';
    root.style.setProperty('--radius-card', '12px');
    root.style.setProperty('--radius-lg', '20px');
    root.style.setProperty('--radius-button', '10px');
    root.style.setProperty('--brand-radius', '0.5rem');
    const probe = document.createElement('div');
    root.appendChild(probe);
    const corners = () =>
      Object.fromEntries(
        ['card', 'media', 'button', 'chip'].map((name) => {
          probe.style.borderTopLeftRadius = `var(--lp-radius-${name})`;
          return [name, getComputedStyle(probe).borderTopLeftRadius];
        })
      );
    const at = (lpStyle: string, step?: string) => {
      root.dataset.lpStyle = lpStyle;
      if (step) root.dataset.lpCorners = step;
      else delete root.dataset.lpCorners;
      return {
        corners: corners(),
        button: button ? getComputedStyle(button).borderTopLeftRadius : null,
      };
    };
    const out = {
      style,
      own: at(style),
      brand: at(style, 'brand'),
      rounder: at(style, 'rounder'),
      soft: at('soft'),
      kit: at('none'),
    };
    at(style);
    probe.remove();
    return out;
  });

  expect(read.style, 'the reference page names its Style').not.toBe('');
  expect(read.style, 'Soft cannot show its own recipe winning').not.toBe(
    'soft'
  );
  expect(read.brand.corners).toEqual(read.kit.corners);
  expect(read.rounder.corners).toEqual(read.soft.corners);
  // The Style bends the org's corners, so the dial's steps are visible here.
  expect(read.own.corners).not.toEqual(read.brand.corners);
  expect(read.own.corners).not.toEqual(read.rounder.corners);
  // And the page's own button follows the dial.
  expect(read.brand.button).toBe(read.brand.corners.button);
  expect(read.rounder.button).toBe(read.rounder.corners.button);
});
