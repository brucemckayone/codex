# Checkout Success Celebration — Implementation Spec

## Summary

Redesign the checkout success page to feel like a celebration rather than a receipt. Three main improvements:

1. **Animated checkmark** — CSS-animated circle-draw + check-draw SVG replacing the static `CheckCircleIcon`, creating an immediate "you did it" moment.
2. **"Start Watching Now" as primary CTA** — Already the primary action, but needs more visual weight (larger button, prominent placement above the fold) and correct labelling per content type (Watch/Listen/Read).
3. **Improved pending/verifying state** — Replace the static clock icon with a spinner, add auto-retry polling, and surface friendlier copy that reassures rather than alarming.
4. **"What's Next" onboarding tips** — For first-time buyers, show a brief tip section below the CTA (resume anywhere, progress tracked, available in library).
5. **Shared component extraction** — Both org and creator pages are nearly identical. Extract a single `CheckoutSuccess` component used by both routes.

**Effort estimate**: ~3-4 hours. Primarily frontend markup/CSS/animation. One small server-side change (retry polling). No new API endpoints needed.

---

## Feasibility

### Pros

- All changes are presentational or client-side logic — no backend API changes, no schema changes, no new worker endpoints.
- The verification API already returns all needed data (`sessionStatus`, `content.title`, `content.thumbnailUrl`, `content.contentType`, `purchase.amountPaidCents`). The `contentType` field is already in the response and can drive CTA label variants.
- The animated checkmark is pure CSS (`@keyframes` + SVG stroke-dasharray). No JS animation library needed. The existing `prefers-reduced-motion` global override in `tokens/motion.css` handles accessibility automatically.
- The org and creator pages share ~95% identical markup and styles. Extracting a shared component is straightforward — the only difference is how the content URL and browse URL are computed.
- All i18n keys already exist for the core flow (`checkout_success_title`, `checkout_success_watch_now`, etc.) — only a few new keys needed for onboarding tips and content-type-specific CTA labels.

### Gotchas & Risks

- **Verification may be pending when the page loads.** Stripe webhooks are async — the user can land on this page before the `checkout.session.completed` webhook fires. The current code catches this (returns `verification: null` on error), but the UX is poor — it shows "We couldn't verify your purchase" which sounds like a failure. The pending state needs to auto-retry (poll every 2-3 seconds for up to 30 seconds) and only show the error messaging after retries are exhausted.
- **Auto-retry requires client-side polling.** The server load runs once on navigation. To retry, the client needs to call `invalidate()` or use a `$effect` with `setTimeout` to re-trigger the load. This is a small but non-trivial addition — must clean up the interval on unmount.
- **Both org and creator pages are nearly identical — same refactor opportunity as content detail.** Extracting a shared component means the route pages become thin wrappers that compute URLs and pass them as props. This is the same pattern used elsewhere in the codebase.
- **"What's Next" tips should only show for first-time buyers.** Determining first-time status would ideally come from the API (purchase count), but the verify endpoint does not return this. For v1, always show the tips — they are helpful even for returning buyers. A future enhancement could conditionally hide them.
- **Content type CTA label.** The verify response includes `content.contentType` but the current i18n key is `checkout_success_watch_now` (always "Start Watching"). Need new keys or a dynamic approach for audio ("Start Listening") and written ("Start Reading") content.

---

## Current State

### File locations

| Route | Page | Server load |
|-------|------|-------------|
| Org | `_org/[slug]/(space)/checkout/success/+page.svelte` (230 lines) | `+page.server.ts` (50 lines) |
| Creator | `_creators/checkout/success/+page.svelte` (227 lines) | `+page.server.ts` (47 lines) |

### Three states currently rendered

| State | Condition | What shows |
|-------|-----------|------------|
| **Complete** | `verification.sessionStatus === 'complete'` | Static green `CheckCircleIcon`, title "Purchase Complete!", description, thumbnail, content title, amount, "Start Watching" + "Continue Browsing" buttons |
| **Verification null** | API call threw (webhook pending or actual error) | Static grey `ClockIcon`, "Verifying your purchase...", error-tone description, "Go to Library" + "Continue Browsing" buttons |
| **Session open/expired** | API returned but status is not `complete` | Same as null state — static grey `ClockIcon`, same messaging |

### Key observations

- The null and open/expired states are **visually and textually identical** — there is no differentiation between "still processing" and "actually failed".
- The pending state copy says "We couldn't verify your purchase" which is alarming for a user who just paid. There is no retry mechanism.
- The success state works well structurally but the static icon feels flat. No animation or celebratory moment.
- Both route pages duplicate 100% of the markup and 100% of the styles. The only differences are:
  - Org page uses `buildContentUrl(page.url, { slug, id })` for the content link; creator page computes `/${username}/content/${contentSlug}`.
  - Org page gets `org` from parent layout data; creator page gets `username` from URL params.
  - Org page title suffix is `data.org?.name ?? 'Codex'`; creator page uses `'Creators'`.

### Existing i18n keys

| Key | Value |
|-----|-------|
| `checkout_success_title` | "Purchase Complete!" |
| `checkout_success_description` | "You now have full access to this content." |
| `checkout_success_watch_now` | "Start Watching" |
| `checkout_success_browse` | "Continue Browsing" |
| `checkout_success_verifying` | "Verifying your purchase..." |
| `checkout_success_error` | "We couldn't verify your purchase right now. Check your library — your content should appear shortly." |
| `checkout_success_go_to_library` | "Go to Library" |

### Verification API response shape

```typescript
{
  sessionStatus: 'complete' | 'expired' | 'open';
  purchase?: {
    id: string;
    contentId: string;
    amountPaidCents: number;
    purchasedAt: string;
  };
  content?: {
    id: string;
    title: string;
    thumbnailUrl?: string;
    contentType: string;  // 'video' | 'audio' | 'written'
  };
}
```

---

## Design Spec

### 1. Success State Redesign

#### Animated Checkmark

Replace the static `CheckCircleIcon` with a custom SVG that animates on mount: circle draws first (0.4s), then the checkmark strokes in (0.3s, delayed 0.3s). Total animation duration ~0.7s.

**SVG structure**: A `<circle>` and a `<polyline>` (the check), both using `stroke-dasharray` / `stroke-dashoffset` animation.

```css
.checkmark-circle {
  stroke: var(--color-success-600);
  stroke-width: 2;
  fill: none;
  stroke-dasharray: 166;
  stroke-dashoffset: 166;
  animation: checkmark-circle-draw 0.4s var(--ease-out) forwards;
}

.checkmark-check {
  stroke: var(--color-success-600);
  stroke-width: 3;
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 48;
  stroke-dashoffset: 48;
  animation: checkmark-check-draw 0.3s var(--ease-out) 0.3s forwards;
}

@keyframes checkmark-circle-draw {
  to { stroke-dashoffset: 0; }
}

@keyframes checkmark-check-draw {
  to { stroke-dashoffset: 0; }
}
```

**Reduced motion**: The global `prefers-reduced-motion` override in `tokens/motion.css` sets all animation durations to near-zero. The checkmark will appear immediately with no visible animation — correct behaviour.

**Size**: 64px viewBox (up from 48px icon). The animation needs visual breathing room.

#### Content Preview Card

Keep the existing thumbnail + title + amount layout but tighten it into a cohesive mini-card:

- Thumbnail with rounded corners (`--radius-md`), max-width 280px.
- Content title below thumbnail, `--text-base`, `--font-semibold`.
- Amount below title, `--text-sm`, `--color-text-secondary`, formatted via `formatPrice()` (GBP).
- Wrap in a subtle bordered container (`--color-border`, `--radius-md`, `--shadow-sm`) to group the purchase details visually.

#### Primary CTA

- **Label**: Dynamic based on `content.contentType`:
  - `video` -> `m.checkout_success_watch_now()` ("Start Watching")
  - `audio` -> `m.checkout_success_listen_now()` ("Start Listening")
  - `written` -> `m.checkout_success_read_now()` ("Start Reading")
- **Style**: Full-width at mobile, auto-width at desktop. Larger padding (`--space-3` vertical, `--space-6` horizontal). `--text-base` font size (up from `--text-sm`). Uses `--color-interactive` background.
- **Position**: Immediately after the content preview card, above the fold.

#### Secondary CTA

- "Continue Browsing" remains as a ghost/outline button below the primary CTA.

### 2. Pending State Improvement

The pending state is the most critical UX gap. A user who just paid money and sees "We couldn't verify" will panic.

#### Auto-retry polling

On initial load, if `verification` is `null` or `sessionStatus !== 'complete'`:

1. Set a client-side `$state` flag `retrying = true`.
2. Use `$effect` + `setTimeout` to call `invalidate()` (re-runs the server load) every 3 seconds.
3. After 5 attempts (15 seconds total), stop retrying and show the fallback messaging.
4. Clean up the timeout on component destroy (return cleanup function from `$effect`).

```svelte
<script>
  let retryCount = $state(0);
  const MAX_RETRIES = 5;
  const RETRY_INTERVAL_MS = 3000;
  const shouldRetry = $derived(!isComplete && retryCount < MAX_RETRIES);

  $effect(() => {
    if (!shouldRetry) return;
    const timeout = setTimeout(() => {
      retryCount++;
      invalidate('checkout:verify');  // re-runs server load
    }, RETRY_INTERVAL_MS);
    return () => clearTimeout(timeout);
  });
</script>
```

The server load needs `depends('checkout:verify')` added so `invalidate('checkout:verify')` triggers it.

#### Pending UI (during retries)

- Replace static `ClockIcon` with a CSS spinner (rotating circle with a gap, using `animation: spin 1s linear infinite`).
- Title: "Confirming your purchase..." (softer than "Verifying").
- Description: "This usually takes just a few seconds. Please stay on this page."
- Show a subtle progress indicator (e.g. dots animation or "Attempt 2 of 5" text in `--text-xs`).

#### Fallback UI (retries exhausted)

- Show `ClockIcon` (static, no spinner).
- Title: "Almost there..."
- Description: "Your purchase is being processed. It should appear in your library within a few minutes."
- Primary CTA: "Go to Library" (not "Continue Browsing" — direct them to where the content will appear).
- Secondary CTA: "Continue Browsing".

### 3. "What's Next" Section

Shown below the CTAs on the success state only. A brief onboarding tip section for buyers.

**Layout**: Three horizontal items at desktop (icon + short text each), stacked vertically at mobile. Uses a subtle background (`--color-surface-secondary`) with padding and rounded corners to separate it from the main card.

**Tips** (3 items):

| Icon | Tip text | i18n key |
|------|----------|----------|
| `PlayIcon` (or appropriate type icon) | "Pick up where you left off — your progress is saved automatically." | `checkout_success_tip_progress` |
| `BookmarkIcon` (or `LibraryIcon`) | "Find all your purchases in your Library, any time." | `checkout_success_tip_library` |
| `MonitorIcon` (or `DevicesIcon`) | "Watch on any device — your progress syncs everywhere." | `checkout_success_tip_devices` |

**Styling**:

```css
.whats-next {
  width: 100%;
  margin-top: var(--space-6);
  padding: var(--space-4);
  background: var(--color-surface-secondary);
  border-radius: var(--radius-md);
}

.whats-next__title {
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  color: var(--color-text);
  margin-bottom: var(--space-3);
}

.whats-next__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.whats-next__item {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  line-height: var(--leading-normal);
}

.whats-next__item-icon {
  color: var(--color-text-muted);
  flex-shrink: 0;
  margin-top: 2px; /* optical alignment with text baseline */
}
```

### 4. Shared Template Refactor

Extract a `CheckoutSuccess` component that both route pages use. The route pages become thin wrappers providing URL computation and page title context.

#### Component props

```typescript
interface Props {
  /** Verification result from server load (null if API call failed) */
  verification: {
    sessionStatus: 'complete' | 'expired' | 'open';
    purchase?: { id: string; amountPaidCents: number; purchasedAt: string };
    content?: { id: string; title: string; thumbnailUrl?: string; contentType: string };
  } | null;
  /** URL to the purchased content (for "Start Watching" CTA) */
  contentUrl: string;
  /** URL for "Continue Browsing" CTA */
  browseUrl: string;
  /** URL for "Go to Library" CTA (pending/fallback state) */
  libraryUrl: string;
  /** Page title suffix (org name or "Creators") */
  titleSuffix: string;
}
```

#### Route page usage (org)

```svelte
<script lang="ts">
  import { page } from '$app/state';
  import { buildContentUrl } from '$lib/utils/subdomain';
  import CheckoutSuccess from '$lib/components/ui/CheckoutSuccess/CheckoutSuccess.svelte';

  let { data } = $props();

  const contentUrl = $derived(
    data.contentSlug && data.verification?.content
      ? buildContentUrl(page.url, { slug: data.contentSlug, id: data.verification.content.id })
      : '/library'
  );
</script>

<CheckoutSuccess
  verification={data.verification}
  {contentUrl}
  browseUrl="/explore"
  libraryUrl="/library"
  titleSuffix={data.org?.name ?? 'Codex'}
/>
```

#### Route page usage (creator)

```svelte
<script lang="ts">
  import CheckoutSuccess from '$lib/components/ui/CheckoutSuccess/CheckoutSuccess.svelte';

  let { data } = $props();

  const contentUrl = $derived(
    data.username && data.contentSlug
      ? `/${data.username}/content/${data.contentSlug}`
      : data.username ? `/${data.username}/content` : '/'
  );
  const browseUrl = $derived(data.username ? `/${data.username}/content` : '/');
</script>

<CheckoutSuccess
  verification={data.verification}
  {contentUrl}
  {browseUrl}
  libraryUrl={browseUrl}
  titleSuffix="Creators"
/>
```

---

## Implementation Plan

### Files to Create

#### 1. `apps/web/src/lib/components/ui/CheckoutSuccess/CheckoutSuccess.svelte`

The shared component containing all markup, styles, animation, retry logic, and the "What's Next" section. Approximately 250-300 lines. Implements:

- Animated checkmark SVG (inline, not a separate component — it is specific to this page).
- Three states: success (animated check + content preview + CTA + what's next), pending (spinner + retry logic), fallback (static clock + library CTA).
- Auto-retry polling via `$effect` + `invalidate('checkout:verify')`.
- Content-type-aware CTA label (`watch_now` / `listen_now` / `read_now`).
- All scoped styles using design tokens.

#### 2. `apps/web/src/lib/components/ui/CheckoutSuccess/index.ts`

Barrel export:

```typescript
export { default as CheckoutSuccess } from './CheckoutSuccess.svelte';
```

### Files to Modify

#### 1. `apps/web/src/routes/_org/[slug]/(space)/checkout/success/+page.svelte`

**Replace** entire component body with thin wrapper that imports `CheckoutSuccess` and computes org-specific URLs (`buildContentUrl`, `/explore`, `/library`). Drops from ~230 lines to ~25 lines.

#### 2. `apps/web/src/routes/_org/[slug]/(space)/checkout/success/+page.server.ts`

**Add** `depends('checkout:verify')` so client-side `invalidate('checkout:verify')` triggers a re-run for retry polling.

#### 3. `apps/web/src/routes/_creators/checkout/success/+page.svelte`

**Replace** entire component body with thin wrapper that imports `CheckoutSuccess` and computes creator-specific URLs (`/${username}/content/${slug}`). Drops from ~227 lines to ~25 lines.

#### 4. `apps/web/src/routes/_creators/checkout/success/+page.server.ts`

**Add** `depends('checkout:verify')` for retry polling support.

#### 5. `apps/web/messages/en.json`

Add new i18n keys:

```json
"checkout_success_listen_now": "Start Listening",
"checkout_success_read_now": "Start Reading",
"checkout_success_confirming": "Confirming your purchase...",
"checkout_success_confirming_description": "This usually takes just a few seconds. Please stay on this page.",
"checkout_success_almost_there": "Almost there...",
"checkout_success_almost_there_description": "Your purchase is being processed. It should appear in your library within a few minutes.",
"checkout_success_whats_next": "What's Next",
"checkout_success_tip_progress": "Pick up where you left off — your progress is saved automatically.",
"checkout_success_tip_library": "Find all your purchases in your Library, any time.",
"checkout_success_tip_devices": "Watch on any device — your progress syncs everywhere."
```

---

## Testing Notes

### Manual verification

1. **Success state (complete purchase)**:
   - Animated checkmark draws circle then check on page load (~0.7s total).
   - Content thumbnail, title, and amount (in GBP) display correctly inside the mini-card.
   - CTA reads "Start Watching" for video, "Start Listening" for audio, "Start Reading" for written.
   - CTA links to the correct content URL (test both org subdomain and creator routes).
   - "What's Next" tips section appears below the CTAs with three items.
   - `prefers-reduced-motion: reduce` in DevTools: checkmark appears instantly, no visible animation.

2. **Pending state (webhook delay)**:
   - Simulate by temporarily making the verify endpoint return slowly or error.
   - Spinner displays (not a static clock icon).
   - Copy reads "Confirming your purchase..." (not "We couldn't verify").
   - Page auto-retries up to 5 times (visible in Network tab as repeated server load calls every 3 seconds).
   - On eventual success (webhook fires during retry window): transitions to success state with animation.
   - After retries exhausted: transitions to fallback state with "Almost there..." messaging and "Go to Library" as primary CTA.

3. **Shared component**:
   - Org checkout success page renders identically to before (minus the visual improvements).
   - Creator checkout success page renders identically.
   - Both routes are now thin wrappers (~25 lines each).

4. **Responsive**:
   - Mobile: CTA button is full-width, "What's Next" tips stack vertically, content preview scales down.
   - Desktop: CTA button is auto-width, layout is centered in the card.

### Accessibility

- Animated checkmark SVG has `role="img"` and `aria-label="Purchase confirmed"`.
- Spinner has `role="status"` and `aria-label="Verifying purchase"`.
- All tip icons have `aria-hidden="true"` (decorative — text carries the meaning).
- Retry status is announced to screen readers via `aria-live="polite"` on the status container.
