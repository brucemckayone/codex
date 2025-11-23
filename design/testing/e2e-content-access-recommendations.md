# E2E Test Recommendations for Content Access Feature

**Status:** Post-Merge Implementation
**Priority:** IMPORTANT (Before Production)
**Estimated Effort:** 3-4 hours

---

## Overview

This document outlines recommended End-to-End (E2E) tests for the Content Access feature. While the API endpoints and service layer have comprehensive test coverage, E2E tests are needed to validate complete user journeys in a real browser environment.

---

## Test Framework

**Recommended:** Playwright (already configured in `apps/web/e2e/`)

**Benefits:**
- Real browser testing (Chromium, Firefox, WebKit)
- Visual regression testing capabilities
- Network request interception
- Mobile device emulation
- Video recording of test runs
- Parallel test execution

---

## Critical User Journeys

### 1. Purchase → Library → Stream Flow

**Priority:** P0 - Critical
**Estimated Tests:** 5-8 test cases

**Test Scenarios:**

```typescript
// apps/web/e2e/content-access/purchase-to-stream.spec.ts

test('user can purchase content and immediately access stream', async ({ page }) => {
  // 1. Login as test user
  await loginAsTestUser(page);

  // 2. Navigate to paid content
  await page.goto('/content/premium-course');

  // 3. Verify paywall is displayed
  await expect(page.getByText('Purchase to watch')).toBeVisible();
  await expect(page.getByRole('button', { name: /purchase/i })).toBeVisible();

  // 4. Initiate purchase
  await page.getByRole('button', { name: /purchase/i }).click();

  // 5. Complete Stripe checkout (test mode)
  await fillStripeTestCard(page, '4242424242424242');
  await page.getByRole('button', { name: /pay/i }).click();

  // 6. Verify redirect to content page
  await expect(page).toHaveURL(/\/content\/premium-course/);

  // 7. Verify content is now accessible
  await expect(page.getByRole('button', { name: /play/i })).toBeVisible();

  // 8. Start streaming
  await page.getByRole('button', { name: /play/i }).click();

  // 9. Verify video player loaded
  await expect(page.locator('video')).toBeVisible();
  await expect(page.locator('video')).toHaveAttribute('src', /r2\.cloudflarestorage\.com/);

  // 10. Verify video starts playing
  await page.waitForTimeout(1000);
  const videoElement = await page.locator('video').elementHandle();
  const currentTime = await videoElement?.evaluate((video: HTMLVideoElement) => video.currentTime);
  expect(currentTime).toBeGreaterThan(0);
});

test('purchased content appears in user library', async ({ page }) => {
  // 1. Complete purchase (helper function)
  await purchaseContent(page, 'premium-course');

  // 2. Navigate to library
  await page.goto('/library');

  // 3. Verify content appears in library
  await expect(page.getByText('Premium Course')).toBeVisible();

  // 4. Verify purchase metadata
  await expect(page.getByText(/purchased/i)).toBeVisible();
});

test('user cannot access paid content without purchase', async ({ page }) => {
  await loginAsTestUser(page);

  // Navigate to paid content
  await page.goto('/content/premium-course');

  // Verify paywall
  await expect(page.getByText('Purchase to watch')).toBeVisible();

  // Verify play button is NOT present
  await expect(page.getByRole('button', { name: /play/i })).not.toBeVisible();

  // Attempt direct navigation to stream (should redirect or show error)
  await page.goto('/content/premium-course/stream');
  await expect(page.getByText(/access denied|purchase required/i)).toBeVisible();
});

test('free content is accessible without purchase', async ({ page }) => {
  await loginAsTestUser(page);

  // Navigate to free content
  await page.goto('/content/free-tutorial');

  // No paywall should be shown
  await expect(page.getByText('Purchase to watch')).not.toBeVisible();

  // Play button should be immediately available
  await expect(page.getByRole('button', { name: /play/i })).toBeVisible();

  // Start streaming
  await page.getByRole('button', { name: /play/i }).click();
  await expect(page.locator('video')).toBeVisible();
});
```

---

### 2. Playback Progress Persistence

**Priority:** P0 - Critical
**Estimated Tests:** 6-10 test cases

**Test Scenarios:**

```typescript
// apps/web/e2e/content-access/playback-progress.spec.ts

test('playback progress is saved and restored', async ({ page }) => {
  // 1. Login and start watching content
  await loginAsTestUser(page);
  await page.goto('/content/test-video');
  await page.getByRole('button', { name: /play/i }).click();

  // 2. Wait for video to play for 10 seconds
  await page.waitForTimeout(10000);

  // 3. Verify progress is being tracked
  const progressIndicator = page.locator('[data-testid="progress-bar"]');
  await expect(progressIndicator).toBeVisible();

  // 4. Get current position
  const videoElement = await page.locator('video').elementHandle();
  const savedPosition = await videoElement?.evaluate((video: HTMLVideoElement) => video.currentTime);

  // 5. Navigate away
  await page.goto('/library');

  // 6. Return to content
  await page.goto('/content/test-video');

  // 7. Verify "Resume watching" option
  await expect(page.getByText(/resume/i)).toBeVisible();

  // 8. Click resume
  await page.getByRole('button', { name: /resume/i }).click();

  // 9. Verify video resumes from saved position
  await page.waitForTimeout(1000);
  const resumedPosition = await videoElement?.evaluate((video: HTMLVideoElement) => video.currentTime);
  expect(Math.abs(resumedPosition! - savedPosition!)).toBeLessThan(2); // Allow 2 second tolerance
});

test('progress persists across browser sessions', async ({ page, context }) => {
  // 1. Watch video in first session
  await loginAsTestUser(page);
  await page.goto('/content/test-video');
  await page.getByRole('button', { name: /play/i }).click();
  await page.waitForTimeout(15000); // Watch for 15 seconds

  // 2. Close browser
  await context.close();

  // 3. Create new browser context (simulates closing and reopening browser)
  const newContext = await browser.newContext();
  const newPage = await newContext.newPage();

  // 4. Login again
  await loginAsTestUser(newPage);
  await newPage.goto('/content/test-video');

  // 5. Verify resume option available
  await expect(newPage.getByText(/resume/i)).toBeVisible();
});

test('progress updates in real-time during playback', async ({ page }) => {
  await loginAsTestUser(page);
  await page.goto('/content/test-video');
  await page.getByRole('button', { name: /play/i }).click();

  // Sample progress at intervals
  const progressSamples: number[] = [];
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(2000);
    const progress = await page.locator('[data-testid="progress-bar"]').getAttribute('aria-valuenow');
    progressSamples.push(Number(progress));
  }

  // Verify progress is increasing
  for (let i = 1; i < progressSamples.length; i++) {
    expect(progressSamples[i]).toBeGreaterThan(progressSamples[i - 1]);
  }
});

test('video marked as completed when watched to end', async ({ page }) => {
  await loginAsTestUser(page);
  await page.goto('/content/short-test-video'); // Use 30 second test video

  // Start playback
  await page.getByRole('button', { name: /play/i }).click();

  // Wait for video to complete
  await page.locator('video').evaluate((video: HTMLVideoElement) => {
    return new Promise((resolve) => {
      video.addEventListener('ended', resolve);
      video.currentTime = video.duration - 1; // Jump to near end to speed up test
    });
  });

  // Verify completion indicator
  await expect(page.getByText(/completed/i)).toBeVisible();

  // Check library shows as completed
  await page.goto('/library');
  const completedBadge = page.locator('[data-testid="completed-badge"]').first();
  await expect(completedBadge).toBeVisible();
});

test('progress syncs across multiple devices', async ({ browser }) => {
  // 1. Create two browser contexts (simulates two devices)
  const device1Context = await browser.newContext();
  const device1Page = await device1Context.newPage();

  const device2Context = await browser.newContext();
  const device2Page = await device2Context.newPage();

  // 2. Login on both devices
  await loginAsTestUser(device1Page);
  await loginAsTestUser(device2Page);

  // 3. Watch video on device 1
  await device1Page.goto('/content/test-video');
  await device1Page.getByRole('button', { name: /play/i }).click();
  await device1Page.waitForTimeout(10000);

  // 4. Pause and wait for sync
  await device1Page.getByRole('button', { name: /pause/i }).click();
  await device1Page.waitForTimeout(2000); // Wait for progress save

  // 5. Open same video on device 2
  await device2Page.goto('/content/test-video');

  // 6. Verify resume option available on device 2
  await expect(device2Page.getByText(/resume/i)).toBeVisible();
});
```

---

### 3. Library Filtering and Sorting

**Priority:** P1 - High
**Estimated Tests:** 4-6 test cases

**Test Scenarios:**

```typescript
// apps/web/e2e/content-access/library.spec.ts

test('library filters by in-progress content', async ({ page }) => {
  await loginAsTestUser(page);

  // Setup: Purchase and watch multiple videos with varying progress
  await purchaseAndWatchContent(page, 'video-1', 50); // 50% watched
  await purchaseAndWatchContent(page, 'video-2', 100); // Completed
  await purchaseAndWatchContent(page, 'video-3', 25); // 25% watched

  // Navigate to library
  await page.goto('/library');

  // Apply in-progress filter
  await page.getByRole('combobox', { name: /filter/i }).selectOption('in-progress');

  // Verify only in-progress items shown
  await expect(page.getByText('Video 1')).toBeVisible();
  await expect(page.getByText('Video 3')).toBeVisible();
  await expect(page.getByText('Video 2')).not.toBeVisible(); // Completed, should be hidden
});

test('library filters by completed content', async ({ page }) => {
  await loginAsTestUser(page);

  // Setup test data
  await purchaseAndWatchContent(page, 'video-1', 100); // Completed
  await purchaseAndWatchContent(page, 'video-2', 50); // In progress

  await page.goto('/library');

  // Apply completed filter
  await page.getByRole('combobox', { name: /filter/i }).selectOption('completed');

  // Verify only completed items shown
  await expect(page.getByText('Video 1')).toBeVisible();
  await expect(page.getByText('Video 2')).not.toBeVisible();
});

test('library sorts by recent purchases', async ({ page }) => {
  await loginAsTestUser(page);

  // Purchase content in specific order
  await purchaseContent(page, 'oldest-video');
  await page.waitForTimeout(1000);
  await purchaseContent(page, 'middle-video');
  await page.waitForTimeout(1000);
  await purchaseContent(page, 'newest-video');

  await page.goto('/library');

  // Apply sort by recent
  await page.getByRole('combobox', { name: /sort/i }).selectOption('recent');

  // Verify order (newest first)
  const items = page.locator('[data-testid="library-item"]');
  await expect(items.nth(0)).toContainText('Newest Video');
  await expect(items.nth(1)).toContainText('Middle Video');
  await expect(items.nth(2)).toContainText('Oldest Video');
});

test('library pagination works correctly', async ({ page }) => {
  await loginAsTestUser(page);

  // Purchase 25 videos to test pagination
  for (let i = 1; i <= 25; i++) {
    await purchaseContent(page, `video-${i}`);
  }

  await page.goto('/library');

  // Verify page 1 shows first 20 items
  const page1Items = page.locator('[data-testid="library-item"]');
  await expect(page1Items).toHaveCount(20);

  // Navigate to page 2
  await page.getByRole('button', { name: /next page/i }).click();

  // Verify page 2 shows remaining 5 items
  const page2Items = page.locator('[data-testid="library-item"]');
  await expect(page2Items).toHaveCount(5);

  // Verify different content on page 2
  await expect(page.getByText('Video 21')).toBeVisible();
});
```

---

### 4. Error Handling and Edge Cases

**Priority:** P1 - High
**Estimated Tests:** 5-8 test cases

**Test Scenarios:**

```typescript
// apps/web/e2e/content-access/error-handling.spec.ts

test('handles network errors gracefully during streaming', async ({ page, context }) => {
  await loginAsTestUser(page);
  await page.goto('/content/test-video');
  await page.getByRole('button', { name: /play/i }).click();

  // Simulate network offline
  await context.setOffline(true);

  // Verify error message displayed
  await expect(page.getByText(/connection lost|network error/i)).toBeVisible({ timeout: 10000 });

  // Restore network
  await context.setOffline(false);

  // Verify retry option
  await expect(page.getByRole('button', { name: /retry/i })).toBeVisible();

  // Retry should succeed
  await page.getByRole('button', { name: /retry/i }).click();
  await expect(page.locator('video')).toBeVisible();
});

test('handles expired streaming URL', async ({ page }) => {
  // This test requires mocking server responses or waiting for URL expiry
  // Implementation depends on test environment setup
});

test('handles concurrent playback from multiple devices', async ({ browser }) => {
  const context1 = await browser.newContext();
  const context2 = await browser.newContext();

  const page1 = await context1.newPage();
  const page2 = await context2.newPage();

  await loginAsTestUser(page1);
  await loginAsTestUser(page2);

  // Start playback on both devices simultaneously
  await Promise.all([
    page1.goto('/content/test-video'),
    page2.goto('/content/test-video'),
  ]);

  await Promise.all([
    page1.getByRole('button', { name: /play/i }).click(),
    page2.getByRole('button', { name: /play/i }).click(),
  ]);

  // Both should work without issues
  await expect(page1.locator('video')).toBeVisible();
  await expect(page2.locator('video')).toBeVisible();

  // Progress should sync (whichever device updates last wins)
});

test('handles browser refresh during playback', async ({ page }) => {
  await loginAsTestUser(page);
  await page.goto('/content/test-video');
  await page.getByRole('button', { name: /play/i }).click();

  // Wait for some playback
  await page.waitForTimeout(5000);

  // Get current position
  const videoElement = await page.locator('video').elementHandle();
  const positionBeforeRefresh = await videoElement?.evaluate((video: HTMLVideoElement) => video.currentTime);

  // Refresh page
  await page.reload();

  // Verify resume option
  await expect(page.getByText(/resume/i)).toBeVisible();

  // Resume
  await page.getByRole('button', { name: /resume/i }).click();

  // Verify position restored
  await page.waitForTimeout(1000);
  const positionAfterRefresh = await videoElement?.evaluate((video: HTMLVideoElement) => video.currentTime);
  expect(Math.abs(positionAfterRefresh! - positionBeforeRefresh!)).toBeLessThan(3);
});
```

---

## Test Data Setup

### Recommended Test Utilities

```typescript
// apps/web/e2e/utils/content-access-helpers.ts

/**
 * Login as test user
 */
export async function loginAsTestUser(page: Page) {
  await page.goto('/login');
  await page.fill('[name="email"]', process.env.TEST_USER_EMAIL!);
  await page.fill('[name="password"]', process.env.TEST_USER_PASSWORD!);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL('/dashboard');
}

/**
 * Purchase content
 */
export async function purchaseContent(page: Page, contentSlug: string) {
  await page.goto(`/content/${contentSlug}`);
  await page.getByRole('button', { name: /purchase/i }).click();
  await fillStripeTestCard(page, '4242424242424242');
  await page.getByRole('button', { name: /pay/i }).click();
  await expect(page).toHaveURL(new RegExp(`/content/${contentSlug}`));
}

/**
 * Purchase and watch content to specific percentage
 */
export async function purchaseAndWatchContent(
  page: Page,
  contentSlug: string,
  percentComplete: number
) {
  await purchaseContent(page, contentSlug);

  await page.getByRole('button', { name: /play/i }).click();

  const videoElement = await page.locator('video').elementHandle();
  await videoElement?.evaluate((video: HTMLVideoElement, percent: number) => {
    video.currentTime = (video.duration * percent) / 100;
  }, percentComplete);

  await page.waitForTimeout(2000); // Wait for progress save
  await page.getByRole('button', { name: /pause/i }).click();
}

/**
 * Fill Stripe test card
 */
export async function fillStripeTestCard(page: Page, cardNumber: string) {
  const stripeIframe = page.frameLocator('iframe[name^="__privateStripeFrame"]');
  await stripeIframe.locator('[placeholder="Card number"]').fill(cardNumber);
  await stripeIframe.locator('[placeholder="MM / YY"]').fill('12/34');
  await stripeIframe.locator('[placeholder="CVC"]').fill('123');
  await stripeIframe.locator('[placeholder="ZIP"]').fill('12345');
}

/**
 * Seed test content (requires API access or direct database seeding)
 */
export async function seedTestContent() {
  // Implementation depends on test environment
  // Could use API calls or direct database seeding
}
```

---

## Test Environment Setup

### Required Configuration

```typescript
// apps/web/playwright.config.ts

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'mobile',
      use: { ...devices['iPhone 13'] },
    },
  ],

  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
});
```

### Environment Variables

```bash
# .env.test
TEST_USER_EMAIL=test@example.com
TEST_USER_PASSWORD=test-password-123
STRIPE_TEST_PUBLISHABLE_KEY=pk_test_...
DATABASE_URL=postgresql://...
```

---

## Test Execution

### Local Development

```bash
# Run all E2E tests
pnpm test:e2e

# Run specific test file
pnpm test:e2e apps/web/e2e/content-access/purchase-to-stream.spec.ts

# Run in UI mode (interactive)
pnpm test:e2e --ui

# Debug mode
pnpm test:e2e --debug
```

### CI/CD Integration

```yaml
# .github/workflows/e2e-tests.yml
name: E2E Tests

on:
  pull_request:
    paths:
      - 'apps/web/**'
      - 'packages/access/**'
      - 'workers/content-api/**'

jobs:
  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install

      - name: Install Playwright browsers
        run: pnpm exec playwright install --with-deps

      - name: Run E2E tests
        run: pnpm test:e2e
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          TEST_USER_EMAIL: test@example.com
          TEST_USER_PASSWORD: test-password-123

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report/
```

---

## Performance Benchmarks

### Target Metrics

- **Page Load:** < 2 seconds (p95)
- **Video Start:** < 3 seconds from click to playback
- **Progress Save:** < 500ms
- **Library Load:** < 1 second for 100 items

### Performance Tests

```typescript
test('video playback starts within 3 seconds', async ({ page }) => {
  await loginAsTestUser(page);
  await page.goto('/content/test-video');

  const startTime = Date.now();
  await page.getByRole('button', { name: /play/i }).click();

  // Wait for video to actually start playing
  await page.locator('video').evaluate((video: HTMLVideoElement) => {
    return new Promise((resolve) => {
      video.addEventListener('playing', resolve, { once: true });
    });
  });

  const loadTime = Date.now() - startTime;
  expect(loadTime).toBeLessThan(3000);
});
```

---

## Visual Regression Testing

### Recommended Scenarios

- Library grid layout (empty, few items, many items)
- Video player controls
- Purchase modal
- Progress indicators
- Completion badges

```typescript
test('library layout matches snapshot', async ({ page }) => {
  await loginAsTestUser(page);
  await page.goto('/library');
  await expect(page).toHaveScreenshot('library-layout.png');
});
```

---

## Accessibility Testing

### Required Checks

- Keyboard navigation
- Screen reader compatibility
- ARIA labels
- Focus management
- Color contrast

```typescript
test('video player is keyboard accessible', async ({ page }) => {
  await loginAsTestUser(page);
  await page.goto('/content/test-video');

  // Tab to play button
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab'); // May need multiple tabs depending on layout

  // Press Enter to play
  await page.keyboard.press('Enter');

  // Verify video started
  await expect(page.locator('video')).toBeVisible();
});
```

---

## Success Criteria

E2E tests should:
- ✅ Cover all critical user journeys
- ✅ Run in < 10 minutes total
- ✅ Have < 1% flakiness rate
- ✅ Pass in CI before merge
- ✅ Include visual regression tests
- ✅ Test accessibility compliance
- ✅ Validate performance benchmarks

---

## Timeline and Priorities

### Phase 1 (Week 1) - Critical Flows
- Purchase → Stream flow (4 tests)
- Basic playback progress (3 tests)
- Library filtering (2 tests)

### Phase 2 (Week 2) - Edge Cases
- Error handling (4 tests)
- Multi-device sync (2 tests)
- Performance benchmarks (3 tests)

### Phase 3 (Week 3) - Polish
- Visual regression tests (5 snapshots)
- Accessibility tests (3 tests)
- Mobile-specific tests (3 tests)

---

## Maintenance

- Review E2E tests quarterly
- Update test data as features evolve
- Monitor flaky tests and fix immediately
- Keep test utilities DRY and maintainable
- Document any test environment quirks

---

**Document Version:** 1.0
**Last Updated:** 2025-11-22
**Owner:** Test Agent
