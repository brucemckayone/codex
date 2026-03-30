/**
 * Performance & Timeout Bug Hunt
 *
 * Diagnostic sweep of all pages. Captures status codes, timings,
 * content presence, and console errors — then outputs a bug report.
 *
 * Run: pnpm exec playwright test e2e/bug-hunt.spec.ts --project=e2e --reporter=list
 */

import { COOKIES } from '@codex/constants';
import {
  authFixture,
  orgFixture,
  parseCookieString,
} from '@codex/test-utils/e2e';
import { expect, type Page, test } from '@playwright/test';

const PORT = 5173;
const PLATFORM_BASE = `http://lvh.me:${PORT}`;

// All tests run in a single worker so the results array is consolidated
test.describe.configure({ mode: 'serial' });

// ──────────────────────────────────────────────────────────────
// Result collection
// ──────────────────────────────────────────────────────────────

interface PageResult {
  id: number;
  page: string;
  url: string;
  status: number | 'error' | 'timeout';
  timeMs: number;
  contentCheck: string;
  consoleErrors: string[];
  severity: 'P0' | 'P1' | 'P2' | 'P3' | 'OK';
  notes: string;
}

const results: PageResult[] = [];

function severity(
  status: number | 'error' | 'timeout',
  timeMs: number,
  contentOk: boolean
): PageResult['severity'] {
  if (status === 'error' || status === 'timeout') return 'P0';
  if (typeof status === 'number' && status >= 500) return 'P0';
  if (typeof status === 'number' && status >= 400) return 'P1';
  if (!contentOk) return 'P1';
  if (timeMs > 5000) return 'P2';
  if (timeMs > 3000) return 'P3';
  return 'OK';
}

// ──────────────────────────────────────────────────────────────
// Auth helpers (avoid studio.ts drizzle-orm dependency)
// ──────────────────────────────────────────────────────────────

async function injectAuthCookies(page: Page, rawCookie: string) {
  const parsed = parseCookieString(rawCookie);
  const cookies: Parameters<Page['context']>[0] extends never
    ? never
    : {
        name: string;
        value: string;
        domain: string;
        path: string;
        httpOnly: boolean;
        secure: boolean;
        sameSite: 'Lax';
        expires: number;
      }[] = [];

  for (const { name, value } of parsed) {
    cookies.push({
      name,
      value,
      domain: 'lvh.me',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
      expires: -1,
    });
    if (name === 'better-auth.session_token') {
      cookies.push({
        name: COOKIES.SESSION_NAME,
        value,
        domain: 'lvh.me',
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
        expires: -1,
      });
    }
  }

  await page.context().clearCookies();
  await page.context().addCookies(cookies);
}

// ──────────────────────────────────────────────────────────────
// Shared state
// ──────────────────────────────────────────────────────────────

let authCookie: string | null = null;
let orgSlug: string | null = null;

test.beforeAll(async () => {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 7);
  const email = `e2e-bughunt-${ts}-${rand}@test.codex`;

  // Register user
  const user = await authFixture.registerUser({
    email,
    password: 'Test123!@#',
    name: 'Bug Hunt User',
  });
  authCookie = user.cookie;

  // Create org through org fixture (API-based, no drizzle needed)
  try {
    const member = await orgFixture.createOrgMember({
      email: `e2e-bughunt-owner-${ts}-${rand}@test.codex`,
      password: 'Test123!@#',
      name: 'Bug Hunt Owner',
      orgRole: 'owner',
      orgSlug: `bughunt-${ts}-${rand}`,
      orgName: `Bug Hunt Org ${ts}`,
    });
    orgSlug = member.organization.slug;
    authCookie = member.cookie; // Use the org owner's cookie
  } catch (err) {
    console.warn('Failed to create org for bug hunt:', err);
  }
});

test.afterAll(async () => {
  // Print bug report
  console.log('\n\n═══════════════════════════════════════════════════════');
  console.log('              BUG HUNT REPORT');
  console.log('═══════════════════════════════════════════════════════\n');

  const sorted = [...results].sort((a, b) => {
    const order = { P0: 0, P1: 1, P2: 2, P3: 3, OK: 4 };
    return order[a.severity] - order[b.severity];
  });

  // Table header
  console.log('| # | Page | Status | Time | Content | Severity | Notes |');
  console.log('|---|------|--------|------|---------|----------|-------|');

  for (const r of sorted) {
    const notes = [
      r.notes,
      r.consoleErrors.length > 0
        ? `Console: ${r.consoleErrors.slice(0, 2).join('; ').slice(0, 80)}`
        : '',
    ]
      .filter(Boolean)
      .join(' ');
    console.log(
      `| ${r.id} | ${r.page} | ${r.status} | ${r.timeMs}ms | ${r.contentCheck} | ${r.severity} | ${notes.slice(0, 120)} |`
    );
  }

  const bugs = sorted.filter((r) => r.severity !== 'OK');
  console.log(
    `\nTotal: ${results.length} pages | ${bugs.length} bugs ` +
      `(${sorted.filter((r) => r.severity === 'P0').length} P0, ` +
      `${sorted.filter((r) => r.severity === 'P1').length} P1, ` +
      `${sorted.filter((r) => r.severity === 'P2').length} P2, ` +
      `${sorted.filter((r) => r.severity === 'P3').length} P3)`
  );
  console.log('═══════════════════════════════════════════════════════\n');

  // Cleanup
  if (authCookie) await authFixture.logout(authCookie).catch(() => {});
});

// ──────────────────────────────────────────────────────────────
// Page probe helper
// ──────────────────────────────────────────────────────────────

async function probePage(
  playwrightPage: Page,
  opts: {
    id: number;
    name: string;
    url: string;
    contentSelector?: string;
    contentText?: string;
    antiText?: string;
  }
): Promise<PageResult> {
  const consoleErrors: string[] = [];
  const handler = (msg: { type: () => string; text: () => string }) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 200));
  };
  playwrightPage.on('console', handler);

  let status: number | 'error' | 'timeout' = 0;
  let timeMs = 0;
  let contentOk = true;
  let notes = '';

  const start = Date.now();
  try {
    const response = await playwrightPage.goto(opts.url, {
      waitUntil: 'load',
      timeout: 30000,
    });
    timeMs = Date.now() - start;
    status = response?.status() ?? 'error';

    // Brief wait for hydration
    await playwrightPage.waitForTimeout(500);

    // Positive content check
    if (opts.contentSelector) {
      try {
        await playwrightPage.waitForSelector(opts.contentSelector, {
          timeout: 5000,
        });
      } catch {
        contentOk = false;
        notes += `Missing: ${opts.contentSelector}. `;
      }
    }
    if (opts.contentText) {
      const body = await playwrightPage.textContent('body');
      if (!body?.includes(opts.contentText)) {
        contentOk = false;
        notes += `Missing text: "${opts.contentText}". `;
      }
    }

    // Negative content check (error indicators)
    if (opts.antiText) {
      const body = await playwrightPage.textContent('body');
      if (body?.includes(opts.antiText)) {
        contentOk = false;
        notes += `Error text present: "${opts.antiText}". `;
      }
    }

    // Generic error check
    const body = await playwrightPage.textContent('body');
    if (body?.includes('INTERNAL_ERROR')) {
      notes += 'INTERNAL_ERROR in page body. ';
    }
    if (body?.includes('unexpected error')) {
      notes += '"unexpected error" in page body. ';
    }
  } catch (err) {
    timeMs = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Timeout')) {
      status = 'timeout';
      notes += `Timeout after ${timeMs}ms. `;
    } else {
      status = 'error';
      notes += `Error: ${msg.slice(0, 100)}. `;
    }
    contentOk = false;
  }

  playwrightPage.removeListener('console', handler);

  const result: PageResult = {
    id: opts.id,
    page: opts.name,
    url: opts.url,
    status,
    timeMs,
    contentCheck: contentOk ? 'OK' : 'FAIL',
    consoleErrors,
    severity: severity(status, timeMs, contentOk),
    notes: notes.trim(),
  };
  results.push(result);
  return result;
}

// ──────────────────────────────────────────────────────────────
// Platform pages (unauthenticated)
// ──────────────────────────────────────────────────────────────

test.describe('Platform (unauthenticated)', () => {
  test('#1 Homepage', async ({ page }) => {
    const r = await probePage(page, {
      id: 1,
      name: 'Homepage',
      url: PLATFORM_BASE,
      contentSelector: 'main',
    });
    // Soft assert — we still collect the result regardless
    expect(r.status).not.toBe('timeout');
  });

  test('#2 Discover', async ({ page }) => {
    await probePage(page, {
      id: 2,
      name: 'Discover',
      url: `${PLATFORM_BASE}/discover`,
      antiText: 'INTERNAL_ERROR',
    });
  });

  test('#3 Login', async ({ page }) => {
    await probePage(page, {
      id: 3,
      name: 'Login',
      url: `${PLATFORM_BASE}/login`,
      contentSelector: 'form',
    });
  });
});

// ──────────────────────────────────────────────────────────────
// Platform pages (authenticated)
// ──────────────────────────────────────────────────────────────

test.describe('Platform (authenticated)', () => {
  test.beforeEach(async ({ page }) => {
    if (authCookie) await injectAuthCookies(page, authCookie);
  });

  test('#4 Library', async ({ page }) => {
    await probePage(page, {
      id: 4,
      name: 'Library',
      url: `${PLATFORM_BASE}/library`,
      antiText: 'Failed to load',
    });
  });

  test('#5 Account', async ({ page }) => {
    await probePage(page, {
      id: 5,
      name: 'Account',
      url: `${PLATFORM_BASE}/account`,
    });
  });

  test('#6 Notifications', async ({ page }) => {
    await probePage(page, {
      id: 6,
      name: 'Notifications',
      url: `${PLATFORM_BASE}/account/notifications`,
    });
  });

  test('#7 Payment', async ({ page }) => {
    await probePage(page, {
      id: 7,
      name: 'Payment',
      url: `${PLATFORM_BASE}/account/payment`,
    });
  });
});

// ──────────────────────────────────────────────────────────────
// Org public pages
// ──────────────────────────────────────────────────────────────

test.describe('Org public', () => {
  function orgUrl(path: string = '/') {
    return `http://${orgSlug}.lvh.me:${PORT}${path}`;
  }

  test('#8 Org homepage', async ({ page }) => {
    test.skip(!orgSlug, 'No org created');
    await probePage(page, {
      id: 8,
      name: 'Org Homepage',
      url: orgUrl('/'),
      antiText: 'INTERNAL_ERROR',
    });
  });

  test('#9 Org explore', async ({ page }) => {
    test.skip(!orgSlug, 'No org created');
    await probePage(page, {
      id: 9,
      name: 'Org Explore',
      url: orgUrl('/explore'),
      antiText: 'INTERNAL_ERROR',
    });
  });

  test('#10 Org creators', async ({ page }) => {
    test.skip(!orgSlug, 'No org created');
    await probePage(page, {
      id: 10,
      name: 'Org Creators',
      url: orgUrl('/creators'),
      antiText: 'INTERNAL_ERROR',
    });
  });
});

// ──────────────────────────────────────────────────────────────
// Studio pages (authenticated, org subdomain)
// ──────────────────────────────────────────────────────────────

test.describe('Studio (authenticated)', () => {
  test.beforeEach(async ({ page }) => {
    if (authCookie) await injectAuthCookies(page, authCookie);
  });

  function studioUrl(path: string = '') {
    return `http://${orgSlug}.lvh.me:${PORT}/studio${path}`;
  }

  test('#13 Dashboard', async ({ page }) => {
    test.skip(!orgSlug, 'No org created');
    await probePage(page, {
      id: 13,
      name: 'Studio Dashboard',
      url: studioUrl(),
      antiText: 'INTERNAL_ERROR',
    });
  });

  test('#14 Content', async ({ page }) => {
    test.skip(!orgSlug, 'No org created');
    await probePage(page, {
      id: 14,
      name: 'Studio Content',
      url: studioUrl('/content'),
      antiText: 'INTERNAL_ERROR',
    });
  });

  test('#15 Media', async ({ page }) => {
    test.skip(!orgSlug, 'No org created');
    await probePage(page, {
      id: 15,
      name: 'Studio Media',
      url: studioUrl('/media'),
      antiText: 'INTERNAL_ERROR',
    });
  });

  test('#16 Analytics', async ({ page }) => {
    test.skip(!orgSlug, 'No org created');
    await probePage(page, {
      id: 16,
      name: 'Studio Analytics',
      url: studioUrl('/analytics'),
      antiText: 'INTERNAL_ERROR',
    });
  });

  test('#17 Customers', async ({ page }) => {
    test.skip(!orgSlug, 'No org created');
    await probePage(page, {
      id: 17,
      name: 'Studio Customers',
      url: studioUrl('/customers'),
      antiText: 'INTERNAL_ERROR',
    });
  });

  test('#18 Team', async ({ page }) => {
    test.skip(!orgSlug, 'No org created');
    await probePage(page, {
      id: 18,
      name: 'Studio Team',
      url: studioUrl('/team'),
      antiText: 'INTERNAL_ERROR',
    });
  });

  test('#19 Settings', async ({ page }) => {
    test.skip(!orgSlug, 'No org created');
    await probePage(page, {
      id: 19,
      name: 'Studio Settings',
      url: studioUrl('/settings'),
      antiText: 'INTERNAL_ERROR',
    });
  });

  test('#20 Branding', async ({ page }) => {
    test.skip(!orgSlug, 'No org created');
    await probePage(page, {
      id: 20,
      name: 'Studio Branding',
      url: studioUrl('/settings/branding'),
      antiText: 'INTERNAL_ERROR',
    });
  });

  test('#21 Billing', async ({ page }) => {
    test.skip(!orgSlug, 'No org created');
    await probePage(page, {
      id: 21,
      name: 'Studio Billing',
      url: studioUrl('/billing'),
      antiText: 'INTERNAL_ERROR',
    });
  });
});
