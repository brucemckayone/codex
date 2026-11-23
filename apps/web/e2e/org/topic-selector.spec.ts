/**
 * Browse everything's topic selector on the org landing (Codex-8swlj.8).
 *
 * A topic tap filters the catalogue IN PLACE. (The retired "Browse by topic"
 * rail navigated to Explore; Codex-dr57r.16 item 13 is superseded by this.)
 * The smoke covers the default selector, One bar (`[data-topic-style="bar"]`):
 * picking a topic chip shows the result head and narrows the grid to that
 * topic, and Clear puts the whole catalogue back.
 *
 * CI SEED, NOT LOCAL DATA. The seed (packages/database/scripts/seed/
 * categories.ts) gives of-blood-and-bones six topics and tags each of its 29
 * published pieces with one or two of them. It sets no `topics-style`, so the
 * landing draws the default bar. Breathwork tags 5 of the 29. The catalogue
 * fits the landing's 50-row window, so the module filters on the client and
 * its head count is exact. Local OBB wears production's brand, which may pick
 * another style, so a local run proves nothing about this file.
 *
 * HYDRATION. The landing streams the topics and an `$effect` puts them into
 * state, so the server renders no selector at all. `[data-topic-style]`
 * appearing is therefore the client-only mark: once it is there, the chips
 * have their handlers. The first assertion holds that against the served HTML.
 * If the selector is ever server-rendered, this test fails saying so instead
 * of clicking markup that has not hydrated.
 *
 * No `document.fonts.ready` wait: nothing here measures type.
 */

import { expect, test } from '@playwright/test';
import { orgUrl } from '../helpers/origin';

const ORG = 'of-blood-and-bones';
const TOPIC = { slug: 'breathwork', name: 'Breathwork' };

// From sm up the bar shows its chips; below it, a "Topics" sheet button.
test.use({ viewport: { width: 1280, height: 800 } });

test('a topic chip filters Browse everything in place, and Clear restores it', async ({
  page,
  baseURL,
}) => {
  const url = orgUrl(baseURL as string, ORG, '/');

  const served = await page.request.get(url);
  expect(served.ok(), 'the landing rendered on the server').toBe(true);
  expect(
    await served.text(),
    'the server renders no topic selector, so its appearing means hydrated'
  ).not.toMatch(/\sdata-topic-style=/);

  await page.goto(url);

  const browse = page.locator('.browse');
  // `display: contents`: the wrapper has no box, so it is attached, not visible.
  const selector = browse.locator('[data-topic-style="bar"]');
  await expect(selector, 'the default selector is One bar').toBeAttached();
  await expect(selector.locator('.topic-bar')).toBeVisible();

  const allChip = selector.locator('.topic-bar__chip--all');
  const chip = selector
    .locator('.topic-bar__chip')
    .filter({ hasText: TOPIC.name });
  const head = browse.locator('.browse__head');
  const cards = browse.locator('.browse__body .content-grid > .cc');

  await expect(allChip).toHaveAttribute('aria-pressed', 'true');
  await expect(head, 'no topic is active on arrival').toHaveCount(0);
  const all = await cards.count();
  expect(all, 'the seeded catalogue is on the grid').toBeGreaterThan(0);

  await chip.click();

  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(allChip).toHaveAttribute('aria-pressed', 'false');
  await expect(head.locator('.browse__head-name')).toHaveText(TOPIC.name);
  await expect(
    head.locator('.browse__head-explore'),
    'the head hands the topic on to Explore'
  ).toHaveAttribute('href', `/explore?category=${TOPIC.slug}`);
  await expect(page).toHaveURL(new RegExp(`[?&]category=${TOPIC.slug}(&|$)`));

  const count = head.locator('.browse__head-count');
  await expect(count).toHaveText(/\d+/);
  const narrowed = Number((await count.textContent())?.match(/\d+/)?.[0]);
  expect(narrowed, 'the topic has pieces').toBeGreaterThan(0);
  expect(narrowed, 'the topic narrows the catalogue').toBeLessThan(all);
  await expect(cards, 'the grid holds what the head counts').toHaveCount(
    narrowed
  );

  await head.locator('.browse__head-clear').click();

  await expect(head).toHaveCount(0);
  await expect(allChip).toHaveAttribute('aria-pressed', 'true');
  await expect(chip).toHaveAttribute('aria-pressed', 'false');
  await expect(cards, 'Clear restores the whole catalogue').toHaveCount(all);
  await expect(page).not.toHaveURL(/[?&]category=/);
});
