# Reference 05 — Accessibility

WCAG 2.2 AA baseline rules, with specific codebase references for the primitives that
deliver them.

## 1. The ARIA Precedence Rule

Before adding any `role`, `aria-*`, or manual keyboard handler, walk this tree:

```
Can you use a semantic HTML element (<button>, <a>, <nav>, <dialog>, <label>)?
├─ YES → use it. Native semantics + keyboard + focus come free.
│
Does Melt UI ship a builder for this pattern (dialog, popover, dropdown, tabs, accordion, tooltip, select, checkbox)?
├─ YES → wrap the Melt builder. It handles ARIA + keyboard + focus trap + WCAG edge cases.
│
Are you stuck with a custom interactive primitive?
└─ Add ARIA carefully; justify in a comment; test with a screen reader.
```

**Never** `role="button"` a `<div>`. Use `<button>`.

<!-- added from iter-16: TableHead primitive was missing scope="col"; ripple-fix across MemberTable + CustomerTable -->
**Native tables** — every `<th>` in a data-oriented table MUST carry `scope=` (`col` for column headers, `row` for row headers). Without it, screen readers can't announce "Column: Email" when the user reads a cell. When wrapping a table primitive, verify the primitive (e.g. `Table/TableHead.svelte`) emits `scope="col"` by default — if it doesn't, fix the primitive, not the consumer.

## 2. Contrast — WCAG AA

- Text: 4.5:1 minimum for body, 3:1 for large text (≥24px or ≥18.66px bold).
- UI components & graphics: 3:1 minimum.
- Use `color-contrast()` once it's Baseline-Widely (Context7 MCP to confirm). Until then:
  - `--color-text-on-brand` auto-inverts white/black based on `--brand-color` luminance
    (see `org-brand.css:36-37`, [01-tokens.md §4](01-tokens.md#4-org-brand-derivation)).
  - For custom contrast checks, compute in OKLCH lightness (`l`) — luminance ≥ 0.62 means pair with black; < 0.62 means pair with white.

## 3. Focus Visibility

Every interactive element needs a visible focus ring. Use the token pair:

```css
.button:focus-visible {
  outline: var(--border-width-thick) solid var(--color-focus);
  outline-offset: var(--focus-offset);        /* 1px — outer focus ring */
}

.bordered-input:focus-visible {
  outline: var(--border-width-thick) solid var(--color-focus);
  outline-offset: var(--focus-offset-inset);  /* -1px — inset for clipped/bordered parents */
}
```

- Use `:focus-visible`, **not** `:focus` — the browser suppresses the ring for mouse focus
  which is correct ergonomically.
- Never remove an outline without replacing it. `outline: none` without a replacement is a
  straight a11y regression.
- For custom focus shapes (e.g., rounded cards with clipped overflow), use `box-shadow` as
  the focus indicator: `box-shadow: 0 0 0 var(--border-width-thick) var(--color-focus)`.
- Outliers (deeper inset than `-1px`, or recessed offsets like `3px`) are allowed when the
  parent geometry demands it — keep the literal value with an inline `/* … */` comment
  explaining why. Don't proliferate tokens for one-off cases.

## 4. Keyboard Support

Every interactive primitive must be fully keyboard operable. For Melt-wrapped components,
this works automatically. For custom components, test:

| Key | Expected behaviour |
|---|---|
| `Tab` | Moves focus forward through interactive elements |
| `Shift+Tab` | Moves focus backward |
| `Enter` | Activates buttons; submits forms |
| `Space` | Activates buttons, toggles checkboxes |
| `Escape` | Closes dialogs, popovers, dropdowns, command palettes |
| `Arrow keys` | Navigate within listboxes, tabs, menubars (Melt handles this) |
| `Arrow keys` + roving `tabindex` | Custom `role="radiogroup"` + `role="radio"` groups (Melt has no radiogroup builder — hand-roll required) |
| `Home` / `End` | Jump to first/last in listboxes |

If a component is visible and interactive, it must be reachable by Tab. If it's reachable,
it must have a visible focus ring.

### Disclosure / Accordion pattern

Any `<button>` that toggles a collapsible region must implement the WAI-ARIA disclosure
contract. Melt UI's Accordion builder handles this for the `ui/Accordion/` primitives, but
ad-hoc one-off disclosure buttons (a "Show more" expander, a per-row details toggle, a
brand-editor section header) are frequently hand-rolled and miss the ARIA.

**Required attributes on the toggle button:**
- `aria-expanded={isOpen}` — reflects the state the next activation will leave
- `aria-controls={regionId}` — points at the element this button expands/collapses
- The controlled region must have `id={regionId}` matching the button's `aria-controls`
- Any decorative chevron/+/- glyph INSIDE the button must be `aria-hidden="true"` so it doesn't narrate

```svelte
<script lang="ts">
  let expanded = $state<string | null>(null);
  const pickerId = (sectionId: string) => `color-picker-${sectionId}`;
</script>

<button
  class="accordion__header"
  aria-expanded={expanded === section.id}
  aria-controls={pickerId(section.id)}
  onclick={() => expanded = expanded === section.id ? null : section.id}
>
  {section.label}
  <span aria-hidden="true">{expanded === section.id ? '−' : '+'}</span>
</button>

{#if expanded === section.id}
  <div id={pickerId(section.id)} class="accordion__content">
    <!-- … -->
  </div>
{/if}
```

Without these attributes, screen reader users hear "button: Primary #6366F1 +" with no idea
what activation does. Iter-04 (BrandEditorColors) caught this pattern missing.

### Custom `radiogroup` keyboard contract (no Melt builder exists)

Any hand-rolled pill/segment control with `role="radiogroup"` + `role="radio"` children
MUST implement the WAI-ARIA Authoring Practices keyboard model:

1. **Roving tabindex**: only the currently-checked radio is `tabindex="0"`; all others are
   `tabindex="-1"`. Tab lands on the group once, not on every child.
2. **Arrow keys rotate + select**: `ArrowLeft`/`ArrowUp` → previous + check, `ArrowRight`/`ArrowDown`
   → next + check. Home → first, End → last.

Canonical implementation in-repo: `apps/web/src/routes/_org/[slug]/(space)/pricing/+page.svelte`
— search for `handleBillingKey`. Port the pattern verbatim; don't reinvent it per consumer.

<!-- added from iter-15: composing radiogroup with disclosure — aria-expanded/aria-controls must NOT go on role=radio -->
**When a radio controls a disclosure (e.g. selecting "Paid" reveals a price-field panel):**
`aria-expanded` and `aria-controls` are NOT valid on `role="radio"` — ARIA 1.2 explicitly
disallows them on that role. Put the disclosure attributes on the **visible click element**
(the `<label>` wrapping the radio in the native-radio pattern) or on the group's container.
Svelte autofixer will flag the radio-anchored version; don't ignore the warning.

```svelte
<!-- WRONG — aria-expanded on role=radio, autofixer flags it -->
<input type="radio" value="paid" aria-expanded={value === 'paid'} aria-controls="paid-panel" />

<!-- CORRECT — attach disclosure semantics to the label (or a fieldset wrapper) -->
<label aria-expanded={value === 'paid'} aria-controls="paid-panel">
  <input type="radio" value="paid" />
  <span>Paid</span>
</label>
<div id="paid-panel" role="region" aria-live="polite">…</div>
```

<!-- added from iter-08: 2D slider pattern surfaced via OklchColorArea blocker (WCAG 2.1.1 keyboard) -->
### Custom 2D slider / color area (2-axis value — e.g. lightness × chroma)

A 2D picker (OKLCH area, HSL picker, XY pad) is **not** a single `role="slider"` — it's two
coupled sliders. Do NOT use `role="application"` — that suppresses AT default semantics
without providing replacements, which is strictly worse than leaving the widget with no role.

The WAI-ARIA Authoring Practices pattern (see APG "Color Picker" example):

1. **Canvas is the paint surface only** — no role, no tabindex, no ARIA. Let it absorb pointer
   events.
2. **Overlay a focusable thumb** at the current value position with:
   - `tabindex="0"`, `role="slider"`
   - `aria-label="<axis X> and <axis Y> — arrow keys adjust"` (e.g. "Lightness and chroma")
   - `aria-valuemin`, `aria-valuemax`, `aria-valuenow` — use the more meaningful axis (lightness
     is usually the headline value for colour)
   - `aria-valuetext="Lightness 62% chroma 0.14"` — announce both axes in natural language
3. **Keyboard contract** (match pointer resolution):
   - `ArrowUp` / `ArrowDown` → axis Y ±1 step (lightness ±1%)
   - `ArrowLeft` / `ArrowRight` → axis X ±1 step (chroma ±0.01)
   - `Shift` + any arrow → ±10 steps (coarse adjust)
   - `Home` / `End` → axis X min / max
   - `PageUp` / `PageDown` → axis Y ±10 steps
4. **Touch target**: visual thumb can be small (8–16px) but the hit-box must meet 44×44 per §8
   — wrap the thumb in a transparent-padded element, or place an invisible 44×44 interaction
   layer over it.

This pattern applies to any 2D input: colour areas, XY pad (audio/modulation), chart
data-point editors. The 1D `radiogroup` contract above does NOT substitute — 2D needs both
axis contracts and the thumb model.

<!-- added from iter-16: RevenueChart surfaced the hover-only-tooltip blocker pattern. Charts lacked every skill section for data-viz. -->
### Data visualisation (charts, graphs, sparklines)

Charts rendered as `<svg>` are *visual information* — WCAG 1.1.1 (Non-text Content) and
1.3.1 (Info and Relationships) require a text alternative that covers the same data. Two
orthogonal contracts apply:

**1. The chart element** needs `role="img"` + an `aria-label` (or `aria-labelledby`) with a
plain-text summary describing what's plotted: metric, range, trend or extremes.

```svelte
<svg role="img" aria-label="Revenue over 30 days — £2,450 total, peak £180 on day 22, flat trend after day 18">
  <title>Revenue over 30 days</title>
  <!-- bars / lines / paths -->
</svg>
```

**2. The underlying data** must be keyboard + screen-reader accessible. Hover-only tooltips
fail WCAG 2.1.1 (Keyboard) + 1.3.1 (Info and Relationships) — non-mouse users lose the
numeric detail entirely. Two options, in preference order:

**Preferred — `.sr-only` data table sibling** (cheapest, most robust, also prints):
```svelte
<div class="chart-container">
  <svg role="img" aria-label="Revenue over 30 days — …">…</svg>

  <table class="sr-only">
    <caption>Revenue by day, past 30 days</caption>
    <thead><tr><th scope="col">Day</th><th scope="col">Revenue</th></tr></thead>
    <tbody>
      {#each data as row}
        <tr><td>{row.label}</td><td>£{row.value.toFixed(2)}</td></tr>
      {/each}
    </tbody>
  </table>
</div>
```

**Alternative — focusable data elements** (justify only for drill-down / interactive charts):
each bar/point/segment is a `<button>` or `tabindex="0"` element with its own `aria-label`,
tooltip revealed on `:focus-within` (NOT just `:hover`).

```css
.bar:focus-visible { outline: var(--border-width-thick) solid var(--color-focus); }
.bar:hover .tooltip,
.bar:focus-visible .tooltip { display: block; }
```

**Chart motion**: any `<animate>` SMIL element or CSS `@keyframes` used for draw-in /
hover-scrub animations must co-locate `@media (prefers-reduced-motion: reduce)` (same rule
as §Media §5 infinite keyframes — token-level motion collapse does not neutralise SMIL or
infinite iterations).

**Chart colours**: consume semantic tokens, NEVER raw palette. For a single-series chart use
`var(--color-interactive)`; for multi-series, either define `--color-chart-1/2/3…` semantic
tokens OR use HSL-shift functions on `var(--color-interactive)`. Raw `--color-primary-500`
et al. ignores org-brand derivation and will look wrong under customised branding.

### `.sr-only` — the visually-hidden, screen-reader-readable class

This class is defined globally (see `global.css`). Use it for:

- Labels on icon-only buttons where a visible label would clutter the UI
  ```svelte
  <button aria-label="Close">
    <XIcon />
    <span class="sr-only">Close dialog</span>
  </button>
  ```
  (aria-label OR sr-only — not both. Pick one per element.)
- Hidden form labels when the visible label is above a group (use `aria-label` on the input instead, usually)
- Status announcements for `aria-live` regions

**Don't** use `display: none` for screen-reader-hidden content — it's invisible to everyone.
**Don't** use `visibility: hidden` either — it removes the element from the a11y tree.

### `aria-hidden="true"`

Use for purely decorative elements that sighted users see but screen-reader users don't need
(e.g. icons alongside a text label, loading spinners, decorative backgrounds).

```svelte
<button>
  <CheckIcon aria-hidden="true" />   <!-- Decorative -->
  Save changes                       <!-- The meaningful label -->
</button>
```

**Never** put `aria-hidden="true"` on anything focusable. It creates an element that tab can
reach but AT can't announce — maximally bad a11y.

### `aria-live` regions

For dynamically-updating status (toast messages, form validation, progress).

```svelte
<div aria-live="polite" aria-atomic="true" class="sr-only">
  {statusMessage}
</div>
```

- `polite` — announce when idle (form errors, completion status)
- `assertive` — announce immediately (destructive warnings, errors). Use sparingly.

<!-- added from iter-11: media-elements surface class surfaced via VideoPlayer audit -->
### Media elements (`<video>`, `<audio>`, `<track>`)

A first-class a11y domain with its own contract. Surfaced in iter-11 (VideoPlayer review) as
a systemic gap — audit found 5 major findings in one batch traceable to this section being missing.

**1. Label the element itself.** Both `<video>` and `<audio>` MUST carry `aria-label` or `title`
reflecting the content, not just the widget role:
```svelte
<video aria-label={contentTitle ?? 'Video'} src={streamUrl} ...>
```
Without this, screen readers announce generic "video" with no context — two videos on a page
become indistinguishable.

**2. Captions need the full `<track>` attribute set.** A caption `<track>` missing `srclang`
or `label` is *inert* to browser UI — the UA's CC menu won't expose it, and WCAG 1.2.2 fails:
```svelte
<track kind="captions"
       src={captionUrl}
       srclang="en"
       label="English"
       default />
```
If you support multiple languages, render one `<track>` per language. Exactly one should have
`default`. Also wire a visible captions-toggle button — without UI, captions the user has
can't be turned on.

**3. Keyboard shortcuts MUST be scoped.** A common mistake: `<svelte:window onkeydown>` that
intercepts space/arrows globally whenever the player is mounted. Even with an
`INPUT`/`TEXTAREA` guard, this breaks space-bar on every `<button>` and `<a>` elsewhere on
the page. Scope to element containment:
```ts
function handleKey(e: KeyboardEvent) {
  const active = document.activeElement;
  // Only respond when focus is inside the player wrapper
  if (!playerWrapperEl?.contains(active)) return;
  // ...
}
```
Or attach `onkeydown` to the wrapper instead of `<svelte:window>`. The convention across media
players (YouTube, Netflix, native `<video controls>`) is "shortcuts only when player is
focused or hovered."

Standard media shortcuts to implement:
- `Space` / `k` — play/pause
- `ArrowLeft` / `j` — seek back (default 5s or 10s; `Shift` = fine-grain 1s)
- `ArrowRight` / `l` — seek forward
- `ArrowUp` / `ArrowDown` — volume ±10% (common omission)
- `m` — mute toggle
- `f` — fullscreen
- `c` — captions toggle (if captions present)
- `0-9` — jump to N×10% of duration

**4. Loading + error live-region pattern.** Multi-minute uploads/buffers are silent for SR
users without a live region. Wrap the state container:
```svelte
<div role="status" aria-live="polite" aria-busy={loading}>
  {#if loading}Loading video…{/if}
  {#if error}<span role="alert">{error}</span>{/if}
</div>
```
`role="status"` implicitly `aria-live="polite"` — use the explicit form for clarity.
`role="alert"` on the error span escalates to `aria-live="assertive"` without interrupting
the outer `polite` context for loading text.

**5. Reduced-motion for keyframe animations.** `motion.css` collapses `--duration-*` tokens
under `prefers-reduced-motion: reduce`, but `@keyframes` *content* (e.g. infinite spinners,
spring-overshoot on control buttons) runs at full amplitude regardless. Keyframe-based
animations MUST have an explicit guard:
```css
@media (prefers-reduced-motion: reduce) {
  .player-play-btn,
  .player-mute-btn,
  .player-cinema-btn { transform: none; transition: none; }

  .player-loading-spinner { animation-duration: 2s; } /* slow, don't silence */
  .player-seek-indicator  { animation: none; opacity: 1; }
}
```
Don't set `animation: none` on loading spinners — users still need a motion signal that
something is happening. Slow it instead.

**6. `<video>` pointer-event considerations.** A common pattern wraps `<video>` in an invisible
tap-zone for mobile seek. If that wrapper has `role="presentation"`, remove any interactive
handlers from it — a presentation role + interactive handler is a role-conflict anti-pattern.
Keyboard interaction should live on the wrapper with a real role, not the `role="presentation"`
layer.

**Canonical implementation**: `apps/web/src/lib/components/VideoPlayer/VideoPlayer.svelte` is
the work-in-progress reference — see iter-011 beads for the fix trajectory.

<!-- added from iter-12: 4-file validation batch surfaced 3 recurring anti-patterns -->
**7. `svelte-ignore a11y_media_has_caption` without justification is a smell.** Both
`HeroInlineVideo.svelte` and `IntroVideoModal.svelte` silence the caption warning with no
accompanying comment. If you need to suppress the warning, the suppression MUST be paired with:

```svelte
<!-- Intro video is muted/decorative — no captions required -->
<!-- svelte-ignore a11y_media_has_caption -->
<video src={videoUrl} muted ...>
```

OR (preferred) actually add the `<track>` element per §2. A bare `<!-- svelte-ignore -->` is
a hidden WCAG 1.2.2 violation — the next reader can't tell whether captions are missing by
design or by neglect.

**Two valid justifications**:
- "Video is demonstrably silent / decorative" (then also set `<video title="...">` describing content)
- "Captions URL not yet wired — tracked in beads-<id>" (then file the bead)

**8. CSS `@media (prefers-reduced-motion)` over JS `matchMedia` one-shot.** A subtle
non-reactive bug surfaced in iter-12: components capture `window.matchMedia('(prefers-reduced-motion: reduce)').matches`
ONCE at mount, then pivot via a Svelte class (`.component--no-motion`). If the user toggles
the setting mid-session, the component is stuck with the mount-time value.

**Bad — non-reactive**:
```svelte
<script>
  let reducedMotion = $state(
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
</script>
<div class:component--no-motion={reducedMotion}>...</div>

<style>
  .component--no-motion { animation: none; }
</style>
```

**Good — CSS-first (auto-reactive)**:
```svelte
<style>
  @media (prefers-reduced-motion: reduce) {
    .component { animation: none; }
  }
</style>
```

**Acceptable — JS with subscription** (only if you *must* read the value in script, e.g. to
shorten timings programmatically):
```ts
const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
let reducedMotion = $state(mq.matches);
mq.addEventListener('change', (e) => (reducedMotion = e.matches));
// Remember to removeEventListener in $effect cleanup
```

The CSS form handles toggling without any wiring. Always prefer it unless you need the value
in JS for calculations.

**9. Portaled overlays need keydown on the portal node, not the mounting wrapper.** A
subtle cousin of §3 scoping: when a component uses `use:portal` to escape the DOM tree
(fullscreen overlays, modal media players), `wrapperEl?.contains(document.activeElement)`
returns `false` because the overlay lives under `document.body`, not under the consuming
component's DOM. `<svelte:window onkeydown>` handlers in portaled components therefore still
hijack global keyboard state even with proper containment checks.

**Correct pattern**:
```svelte
<script>
  let overlayEl: HTMLDivElement;
  // Auto-focus the portal root when it mounts so keyboard handler is reachable
  $effect(() => { overlayEl?.focus(); });
</script>

{#if open}
  <div
    bind:this={overlayEl}
    use:portal={document.body}
    tabindex="-1"
    onkeydown={handleKey}
    role="dialog"
    aria-modal="true">
    ...
  </div>
{/if}
```

Attach `onkeydown` to the portal node itself and auto-focus on mount. Keyboard shortcuts
only fire when focus is inside the overlay — which is the correct semantic for a modal
dialog or fullscreen player.

<!-- added from iter-13: canvas-based slider widgets (Waveform) — iter-12 extraction too narrow -->
**10. Canvas-based slider widgets — `role="slider"` without an `HTMLMediaElement`.** Audio
visualisers, timeline scrubbers, and XY pads often expose a `role="slider"` surface rendered
on `<canvas>` without an underlying `<audio>`/`<video>` element. The iter-12 extraction
(`createMediaKeyboardHandler`) assumes `HTMLMediaElement.currentTime` mutation and therefore
does NOT fit canvas sliders — those use an `onSeek(time: number)` callback pattern instead.

The canvas slider has its own WAI-ARIA APG contract:

| Key | Action | Required? |
|---|---|---|
| `ArrowRight` / `ArrowUp` | Seek forward by `stepSecs` (default 5s) | **Required** |
| `ArrowLeft` / `ArrowDown` | Seek backward by `stepSecs` | **Required** |
| `Shift` + arrow | Fine-grain ±1s | Recommended |
| `Home` | Seek to `0` | **Required by APG** |
| `End` | Seek to `duration` | **Required by APG** |
| `PageUp` / `PageDown` | Coarse-grain ±`pageSecs` (default 10% of duration) | Recommended |

Waveform.svelte's inline handler only implements ArrowLeft/Right — violates the APG contract
(iter-13 `Codex-<id>`).

**Canonical composable** — sibling to `createMediaKeyboardHandler`:
```ts
// $lib/components/media-a11y/keyboard.svelte.ts
export function createSliderKeyboardHandler({
  onSeek,
  getCurrentTime,
  duration,
  stepSecs = 5,
  pageSecs,
}: {
  onSeek: (time: number) => void;
  getCurrentTime: () => number;
  duration: number;
  stepSecs?: number;
  pageSecs?: number;
}) {
  const page = pageSecs ?? duration * 0.1;
  return (e: KeyboardEvent) => {
    const now = getCurrentTime();
    let next = now;
    const step = e.shiftKey ? 1 : stepSecs;
    switch (e.key) {
      case 'ArrowRight': case 'ArrowUp':   next = Math.min(duration, now + step); break;
      case 'ArrowLeft':  case 'ArrowDown': next = Math.max(0, now - step); break;
      case 'Home':      next = 0; break;
      case 'End':       next = duration; break;
      case 'PageUp':    next = Math.min(duration, now + page); break;
      case 'PageDown':  next = Math.max(0, now - page); break;
      default: return;
    }
    e.preventDefault();
    onSeek(next);
  };
}
```

**Key insight**: `createMediaKeyboardHandler` (iter-12) and `createSliderKeyboardHandler`
(iter-13) are siblings, not one replacing the other. Use the first for real `<audio>`/`<video>`
elements; use the second for canvas-based sliders. The same pattern will likely extend to
XY pads (already partly covered by 2D slider §"Custom 2D slider / color area" earlier).

## 6. Reduced Motion / Contrast / Transparency

```css
@media (prefers-reduced-motion: reduce) {
  /* Motion tokens already collapse — see 04-motion.md §2.
     Only add rules here for effects that bypass durations (e.g., shader auto-advance). */
}

@media (prefers-contrast: more) {
  .button { border-width: var(--border-width-thick); }
  .card   { border: var(--border-width) solid var(--color-text); }
}

@media (prefers-reduced-transparency: reduce) {
  .glass-overlay {
    backdrop-filter: none;
    background: var(--color-surface);    /* opaque fallback */
  }
}
```

## 7. Forms

| Concern | Pattern |
|---|---|
| Label association | `<label for="id">` + `<input id="id">`, OR `<label>` wrapping the input |
| Error messaging | `aria-invalid="true"` on the input; `aria-describedby` pointing at the error `<p id="…-error">` |
| Required fields | `required` attribute + visual `*` on label (and explain in form help text) |
| Field descriptions | `aria-describedby` to a hint `<p id="…-hint">` |
| Submit state | `<button aria-busy={loading}>` (already in Button variant) |

Never submit a form by clicking a `<div>`. Never skip labels on form inputs.

<!-- added from iter-14: first commerce batch surfaced a 5-pattern checkout subsection gap -->
### Checkout & payment flows

Commerce surfaces (checkout, subscribe, purchase modals, payment confirmation) have their own
accessibility contract beyond generic forms. Five patterns to enforce:

**1. State-machine live-regions** — checkout flows have pending → complete → error/fallback
transitions that must announce:
```svelte
<div role="status" aria-live="polite" aria-busy={state === 'pending'}>
  {#if state === 'pending'}Processing payment…
  {:else if state === 'complete'}Payment successful
  {:else if state === 'fallback'}<span role="alert">Confirmation is taking longer than expected</span>
  {/if}
</div>
```
The `role="alert"` escalation on fallback/error is the same nested pattern from §Media §4.

**2. Generic error messaging — never echo payment provider errors directly**:
```svelte
<!-- WRONG — Stripe errors can contain customer-identifying substrings -->
<p role="alert">{err.message}</p>

<!-- CORRECT — map to a generic user-safe message, log the full error via observability -->
<p role="alert">{m.checkout_generic_error()}</p>
```
Stripe/payment API error messages may contain card prefixes, email addresses, account IDs,
or transaction metadata. Rendering them raw is both a UX problem (technical jargon) and a
privacy risk (PII in DOM / analytics / error-reporting pipelines). Always map to an i18n-keyed
generic message; log the full error server-side or via `ObservabilityClient` with redaction.

**3. Retry-exhaustion announcement** — pending states that auto-retry must announce when
retries stop. Silent "still waiting" loops leave SR users in an uncertain state:
```ts
if (retryCount >= MAX_RETRIES) {
  state = 'fallback';
  // The aria-live region from §1 automatically announces the new state
}
```

**4. Buy/Subscribe button loading + disabled + aria-busy** — while a checkout session is
opening, the button MUST communicate three things:
- disabled (can't double-click)
- loading (visual spinner or `data-state="loading"`)
- `aria-busy="true"` (announced to AT)

The wrapped `<Button loading={checkoutLoading}>` pattern in `$lib/components/ui/Button`
already handles all three. Don't reinvent per-consumer.

**5. Never `title` attribute as sole overflow disclosure** — truncated tier/product names on
a `<span title="Premium Creator Tier">Premium…</span>` hide the full text from keyboard
users entirely. `title` is *visual* on hover only, fails WCAG 1.4.13 (Content on Hover or
Focus). Use Melt UI Tooltip (activates on both focus and hover) or drop the truncation.

**Canonical in-repo references** (all post-iter-14):
- State-machine + retry: `apps/web/src/lib/components/ui/CheckoutSuccess/CheckoutSuccess.svelte`
- Generic error + PII safety: `apps/web/src/lib/components/subscription/PurchaseOrSubscribeModal.svelte` after iter-14 fix
- Button loading pattern: `apps/web/src/lib/components/ui/Button/Button.svelte` `loading` prop

<!-- added from iter-15: first file-upload surface audit (MediaUpload) surfaced a distinct a11y contract not covered by §5 Media Elements (video/audio) -->
### File input + drag-drop upload

`<input type="file">` with drag-drop surfaces (MediaUpload, LogoUpload, ThumbnailUpload, IntroVideo) are form controls, not media elements. They need their own a11y contract:

**1. Never `<div role="button">` over a hidden file input.** This is WCAG 2.1.1 keyboard failure + named anti-pattern in §11. Use a real `<button type="button">` that programmatically triggers the hidden input via `inputRef.click()`, OR — preferred — wrap a visible styled `<span>` in `<label for="upload-input">`:

```svelte
<!-- WRONG — div-as-button + aria-hidden input hides the file chooser from AT -->
<div role="button" tabindex="0" onclick={openFilePicker} onkeydown={handleKey}>
  <input type="file" aria-hidden="true" tabindex="-1" hidden={false} />
</div>

<!-- CORRECT — label associates click target with input, native keyboard works -->
<label class="upload-zone" for="media-file-input">
  <span class="upload-zone__cta">Drop files or click to browse</span>
  <input id="media-file-input" type="file" accept="video/*,audio/*" class="sr-only" />
</label>
```

The `<label>` acts as the click surface; the `<input>` is keyboard-accessible via Tab + Space/Enter; `accept` is announced by screen readers.

**2. Live-region on the queue** — drag-accept, drag-reject, queue mutations, per-item progress, errors must all announce. One outer `aria-live="polite"` wrapper on the queue + `role="alert"` escalation for errors:

```svelte
<div class="upload-queue" role="status" aria-live="polite" aria-busy={activeUploads > 0}>
  {#each queue as item}
    <div class="upload-item" aria-busy={item.state === 'uploading'}>
      <span class="upload-item__name">{item.file.name}</span>
      <progress value={item.progress} max="100" aria-label="Upload progress for {item.file.name}" />
      {#if item.error}<span role="alert">{m.media_upload_generic_error()}</span>{/if}
    </div>
  {/each}
</div>
```

**3. Reject invalid files with announcement** — silently dropping invalid files (wrong type, too large) leaves AT users confused. Track rejections in state and announce them via the same live region:

```ts
if (!isValidFile(file)) {
  rejections = [...rejections, { name: file.name, reason: 'Invalid file type' }];
  // Rejection renders inside the aria-live queue → announces automatically
  return;
}
```

**4. Never render raw network errors** — like the Checkout & payment flows rule, upload errors from the API / R2 / remote function may contain internal paths, presigned URL fragments, or HTTP status bodies. Map to a generic `m.media_upload_error()`; log the real error via `ObservabilityClient` or `console.error`.

**5. `aria-label` uniqueness on per-item actions** — a cancel/remove button inside each queue row needs `aria-label={`Remove ${item.file.name}`}` to differentiate across rows. Bare `aria-label="Remove"` creates N identical AT elements.

**Canonical in-repo reference** (post-iter-15): `apps/web/src/lib/components/studio/MediaUpload.svelte` — once `Codex-<id>` fixes land, the label + live-region + rejection patterns will all be canonical. Also see `apps/web/src/lib/utils/use-drop-zone.svelte.ts` for the shared drop-zone composable.

## 8. Touch Targets

Minimum **44×44 px** on touch — WCAG 2.5.5.

| Token mapping | Height + padding gives ≥44px |
|---|---|
| `--space-10` (40px) | ⚠ Just below — use only for dense desktop UI |
| `--space-11` (44px) | ✓ OK for buttons |
| `--space-12` (48px) | ✓ Preferred for primary CTAs and mobile tap targets |

`.button[data-size="md"]` is `var(--space-10)` (40px) — OK for desktop chrome, but pair
with a mobile-specific override to `--space-12` when the button is the primary CTA on
a touch-first context.

## 9. Icon-Only Buttons

```svelte
<!-- CORRECT -->
<button aria-label="Close dialog" class="icon-button">
  <XIcon />
</button>

<!-- WRONG -->
<button class="icon-button">
  <XIcon />    <!-- No accessible name at all -->
</button>
```

The Icon component (`IconBase.svelte:24`) sets `aria-hidden="true"` on the SVG, so the `<button>`
must supply its own name via `aria-label` or visible text (possibly `.sr-only`).

## 10. Skip Links

The root layout ships a `<SkipLink>` component (`apps/web/src/lib/components/ui/SkipLink/`).
Don't remove it. If you add a new top-level landmark, ensure skip-link targets are still
reachable.

## 11. Gotchas / Anti-patterns

- **Don't** `role="button"` on a `<div>`. Use `<button>`.
- **Don't** `outline: none` without a replacement focus indicator.
- **Don't** `aria-hidden="true"` on focusable elements.
- **Don't** rely on colour alone to signal state — pair with an icon, text, or shape change (red + icon, not red alone).
- **Don't** use `tabindex="0"` on non-interactive elements — `<div tabindex="0">` with no role or handler is a keyboard trap bait.
- **Don't** use `tabindex > 0` ever. Positive tabindex values hijack the tab order globally.
- **Don't** write custom keyboard handlers for dialogs, menus, tabs, etc. when Melt UI already provides them. You will miss edge cases (focus trap escape, arrow key wrap-around, type-ahead).
- **Don't** hide required asterisks with `aria-hidden="true"` — screen readers lose the required signal. Use `<span aria-hidden="true">*</span>` and supply `required` on the input.
- **Don't** announce every piece of UI state with `aria-live` — overload makes the region useless. Reserve it for genuinely important updates.
- **Don't** skip the axe test (see [08-testing.md](08-testing.md)). Visual review is not a11y review.

## 12. When to Re-Verify This Reference

- `apps/web/src/lib/components/ui/SkipLink/` — skip link behaviour
- `apps/web/src/tests/utils/a11y-helpers.ts` — axe integration
- Melt UI version bumps — keyboard handling changes are rare but impactful
- WCAG version updates (Context7 MCP — verify current AA/AAA expectations)

If the code disagrees, **the code wins**.
