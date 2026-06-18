/**
 * SPA-navigation helpers for Playwright tests against client-rendered routes
 * (e.g. studio sub-tree, which has `export const ssr = false`).
 *
 * Why this exists (see apps/web/e2e/CLAUDE.md):
 *   - SvelteKit's client router listens for native anchor clicks via a
 *     delegated listener on `document`. Playwright's synthetic `click()`
 *     doesn't always bubble in a way the router picks up.
 *   - Studio rail items reposition on hover (the rail expands), so the
 *     Playwright actionability check sometimes fails mid-click.
 *   - `waitForURL` with the default `waitUntil: 'load'` hangs forever on
 *     `ssr=false` routes because there is no real `load` event — the
 *     navigation is a `history.pushState` only.
 *
 * The robust pattern is: hover (to settle the rail), `evaluate(el => el.click())`
 * (native click bubbles to the document listener), then poll the URL via
 * `toHaveURL` rather than waiting on a navigation event.
 */

import { expect, type Locator, type Page } from '@playwright/test';

export interface ExpectClickNavigatesOptions {
  /** URL-match timeout in milliseconds. Defaults to 10_000. */
  timeout?: number;
  /**
   * Hover the locator before clicking. Defaults to true — needed for studio
   * rail items whose layout shifts on hover. Set false for stable elements.
   */
  hover?: boolean;
}

export async function expectClickNavigates(
  page: Page,
  locator: Locator,
  pattern: RegExp,
  opts: ExpectClickNavigatesOptions = {}
): Promise<void> {
  const { timeout = 10_000, hover = true } = opts;
  if (hover) await locator.hover();
  await locator.evaluate((el: HTMLElement) => el.click());
  await expect(page).toHaveURL(pattern, { timeout });
}
