/**
 * Studio E2E Test Helpers
 *
 * Utilities for navigating studio pages on org subdomains
 * and injecting auth cookies that work across subdomains.
 */

import type { OrgMemberContext, OrgMemberRole } from '@codex/shared-types';
import {
  authFixture,
  orgFixture,
  parseCookieString,
} from '@codex/test-utils/e2e';
import { expect, type Page } from '@playwright/test';
import { aliasSessionCookies } from './auth-cookies';

const BASE_PORT = 5173;

/**
 * Navigate to the studio root on an org subdomain.
 * Waits for the studio layout to be visible.
 */
export async function navigateToStudio(page: Page, orgSlug: string) {
  await page.goto(`http://${orgSlug}.lvh.me:${BASE_PORT}/studio`, {
    waitUntil: 'load',
  });
  // Wait for the studio layout container
  await page.waitForSelector('.studio-layout', {
    state: 'visible',
    timeout: 30000,
  });
  // Wait for Svelte 5 hydration
  await page.evaluate(() => new Promise(requestAnimationFrame));
}

/**
 * Navigate to a specific studio page on an org subdomain.
 *
 * Studio uses `ssr = false` (apps/web/src/routes/_org/[slug]/studio/+layout.ts) —
 * the entire sub-tree is client-rendered. `waitUntil: 'load'` fires when the
 * initial HTML+JS bundle has loaded, but BEFORE Svelte has built the page
 * client-side. A single requestAnimationFrame after that is not enough: tests
 * race against hydration and remote-query resolution, then fail to find
 * elements that only appear once the page is mounted. Wait for the
 * `.studio-layout` shell to be visible — same pattern as `navigateToStudio`.
 */
export async function navigateToStudioPage(
  page: Page,
  orgSlug: string,
  path: string
) {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  await page.goto(`http://${orgSlug}.lvh.me:${BASE_PORT}/studio${cleanPath}`, {
    waitUntil: 'load',
  });
  // Wait for the studio shell to mount (proves hydration has begun and the
  // page is being rendered, not just the HTML envelope).
  await page.waitForSelector('.studio-layout', {
    state: 'visible',
    timeout: 30000,
  });
  // Settle Svelte 5 reactive effects.
  await page.evaluate(() => new Promise(requestAnimationFrame));
}

/**
 * Navigate to an org page (non-studio) on an org subdomain.
 */
export async function navigateToOrgPage(
  page: Page,
  orgSlug: string,
  path: string = '/'
) {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  await page.goto(`http://${orgSlug}.lvh.me:${BASE_PORT}${cleanPath}`, {
    waitUntil: 'load',
  });
  await page.evaluate(() => new Promise(requestAnimationFrame));
}

/**
 * Inject cookies for an org member into the page context.
 *
 * Cookies MUST be attached to `.lvh.me` (leading dot) so Chromium sends them
 * on requests to any `<slug>.lvh.me:5173` host. Playwright's `addCookies`
 * stores the cookie at the literal domain you give it; without the leading
 * dot, the cookie is scoped to the apex only and is NOT sent on subdomain
 * navigation — studio tests then see `locals.user = null` in
 * `+layout.server.ts` and get redirected to `/login`.
 */
export async function injectOrgCookies(
  page: Page,
  cookie: string
): Promise<void> {
  const browserCookies = aliasSessionCookies(parseCookieString(cookie));
  await page.context().clearCookies();
  await page.context().addCookies(browserCookies);
}

/**
 * Create an org member and inject their cookies into the page.
 * Returns the member context for further assertions.
 */
export async function setupStudioUser(
  page: Page,
  options: {
    orgRole?: OrgMemberRole;
    orgSlug?: string;
    orgName?: string;
    platformRole?: string;
  } = {}
): Promise<OrgMemberContext> {
  const timestamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 7);
  const role = options.orgRole ?? 'owner';
  const slug = options.orgSlug ?? `e2e-studio-${timestamp}-${rand}`;
  const name = options.orgName ?? `E2E Studio Org ${timestamp}`;
  const email = `e2e-${role}-${timestamp}-${rand}@test.codex`;
  const password = 'Test123!@#';

  const member = await orgFixture.createOrgMember({
    email,
    password,
    name: `E2E ${role} User`,
    orgRole: role,
    orgName: name,
    orgSlug: slug,
    platformRole: options.platformRole ?? 'creator',
  });

  await injectOrgCookies(page, member.cookie);
  return member;
}

/**
 * Shared studio auth for read-only test groups.
 * Creates a user once and returns cookies + context for reuse.
 */
export interface SharedStudioAuth {
  member: OrgMemberContext;
  cookie: string;
}

export async function registerSharedStudioUser(
  options: {
    orgRole?: OrgMemberRole;
    orgSlug?: string;
    orgName?: string;
    platformRole?: string;
  } = {}
): Promise<SharedStudioAuth> {
  const timestamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 7);
  const role = options.orgRole ?? 'owner';
  const slug = options.orgSlug ?? `e2e-studio-${timestamp}-${rand}`;
  const name = options.orgName ?? `E2E Studio Org ${timestamp}`;
  const email = `e2e-shared-${role}-${timestamp}-${rand}@test.codex`;
  const password = 'Test123!@#';

  const member = await orgFixture.createOrgMember({
    email,
    password,
    name: `E2E Shared ${role} User`,
    orgRole: role,
    orgName: name,
    orgSlug: slug,
    platformRole: options.platformRole ?? 'creator',
  });

  return { member, cookie: member.cookie };
}

export async function injectSharedStudioAuth(
  page: Page,
  shared: SharedStudioAuth
): Promise<void> {
  await injectOrgCookies(page, shared.cookie);
}

export async function cleanupSharedStudioAuth(
  shared: SharedStudioAuth | null
): Promise<void> {
  if (shared) {
    await authFixture.logout(shared.cookie).catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The content editor (Codex-a6ofh.2): Write, then Publish
// ─────────────────────────────────────────────────────────────────────────────

/** An edit address: `/studio/content/<uuid>/edit`, with any step after it. */
const EDIT_PATH = /\/studio\/content\/([0-9a-f-]{36})\/edit(?:\?|$)/;

/**
 * Open a new piece of `type` on the Write step and give it a title. The
 * first thing added makes its row, and the address moves (in place) to its
 * edit page. Returns the new piece's id.
 */
export async function startDraft(
  page: Page,
  orgSlug: string,
  type: 'video' | 'audio' | 'written',
  title: string
): Promise<string> {
  await navigateToStudioPage(page, orgSlug, `/content/new?type=${type}`);
  const titleBox = page.getByRole('textbox', { name: 'Title', exact: true });
  await expect(titleBox).toBeVisible({ timeout: 30_000 });
  await titleBox.fill(title);
  await expect(page).toHaveURL(EDIT_PATH, { timeout: 30_000 });
  const id = EDIT_PATH.exec(page.url())?.[1];
  if (!id) throw new Error(`No piece id in ${page.url()}`);
  return id;
}

/**
 * Wait for the autosave of a change just made. The bar says "Saving…"
 * through its 1.5 s debounce, so it is seen before the save, then "Saved
 * just now" once the save has landed. A navigation sooner would be held by
 * the editor's leave guard.
 */
export async function waitForEditorSave(page: Page): Promise<void> {
  const words = page.locator('.write-words');
  await expect(words).toHaveText('Saving…');
  await expect(words).toHaveText('Saved just now', { timeout: 30_000 });
}

/**
 * Next: publish, from the Write step (the wide bar's button; a phone has
 * its own at the foot). Waits for the Publish step's access choice, which
 * mounts on its own read of the piece.
 */
export async function goToPublishStep(page: Page): Promise<void> {
  await page
    .getByRole('button', { name: 'Next: publish', exact: true })
    .click();
  await expect(page).toHaveURL(/\?step=publish$/, { timeout: 30_000 });
  await expect(page.getByRole('radiogroup', { name: 'Access' })).toBeVisible({
    timeout: 30_000,
  });
}

/**
 * Choose who can watch it on the Publish step, by its visible card: the
 * radio itself is visually hidden. Never a forced check: the move to
 * Publish from a new draft plays the root layout's view transition, and
 * until it ends every click lands on the transition (the page reads as
 * `<html>`), so a forced click is lost. Clicking the card waits until it
 * takes the click; the radio must then be chosen.
 */
export async function chooseAccess(page: Page, name: RegExp): Promise<void> {
  const access = page.getByRole('radiogroup', { name: 'Access' });
  const radio = access.getByRole('radio', { name });
  await expect(radio).toBeEnabled({ timeout: 15_000 });
  // `has` is queried inside each label, so it must not start at the group.
  await access
    .locator('label')
    .filter({ has: page.getByRole('radio', { name }) })
    .click();
  await expect(radio).toBeChecked();
}
