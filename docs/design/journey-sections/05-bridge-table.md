# The read-boundary bridge — per-worktree change list

Derived from F-A's `SECTION_PROP_ALIASES` table (`render/coerce.ts`) plus the actual call sites in the
11 public components, on branch `feat/journey-sections-foundation`. This is the `Codex-tqr51` copy-loss
fix, split by owning worktree.

F-A added the alias table, `aliasKeys(type, prop)` and `asParagraphsFrom`, but deliberately did **not**
touch `render/sections/*` — those files belong to the component worktrees. These are the edits each
worktree makes.

Use `aliasKeys('<type>', '<prop>')` rather than an inline literal array. The point of the table is that
seven worktrees read one source: a hand-copied preference list drifts, and a drifted list is
**invisible**, because it degrades to the hardcoded fallback rather than failing.

## Already bridged — do nothing

| File | Lines | Note |
|---|---|---|
| `AcheSection.svelte` | `:38`, `:41` | `eyebrow` ← `kicker`; `beats[]` synthesised from `[heading, body]` |
| `TurnSection.svelte` | `:43`–`:45` | `eyebrow` ← `kicker`; `statement` ← `heading`; `lede` ← `body` |
| `ProofSection.svelte` | `:45` | `trustLabel` ← `trust` |
| `FaqSection.svelte` | `:48`–`:53` | `items[]` via `asObjectArray` **and** `asNumberedGroups` for `q1/a1…` |

## WT-3 · hero

| Line | Current | Replace with | Stored key |
|---|---|---|---|
| `:41` | `asString(config, 'subheadline')` | `asStringFrom(config, aliasKeys('hero','subheadline'))` | `sub` |
| `:42` | `asString(config, 'ctaLabel')` | `asStringFrom(config, aliasKeys('hero','ctaLabel'))` | `button` |
| `:43` | `asString(config, 'secondaryLabel')` | `asStringFrom(config, aliasKeys('hero','secondaryLabel'))` | `quiet` |

`:42` is the **confirmed live loss**: the golden page stores `button: "Get started"` and the served HTML
shows `'Begin the journey'`.

## WT-2 · video

| File | Line | Current | Replace with | Stored key |
|---|---|---|---|---|
| `IntroVideoSection` | `:36` | `asString(config, 'eyebrow')` | `asStringFrom(config, aliasKeys('introVideo','eyebrow'))` | `kicker` |
| `ReelSection` | `:44` | `asString(config, 'eyebrow')` | `asStringFrom(config, aliasKeys('reel','eyebrow'))` | `kicker` |
| `ReelSection` | `:65` | `asString(config, 'tag')` | `asStringFrom(config, aliasKeys('reel','tag'))` | `clip` |

## WT-4 · map

| Line | Current | Replace with | Stored key |
|---|---|---|---|
| `:47` | `asString(config, 'title')` | `asStringFrom(config, aliasKeys('map','title'))` | `heading` |
| `:49` | `asString(config, 'foot')` | `asStringFrom(config, aliasKeys('map','foot'))` | `note` |

## WT-1 · prose

| File | Line | Current | Replace with | Stored key |
|---|---|---|---|---|
| `FeelSection` | `:43` | `asString(config, 'eyebrow')` | `asStringFrom(config, aliasKeys('feel','eyebrow'))` | `kicker` |

## WT-6 · guide — the most severe case

| Line | Current | Replace with | Stored key |
|---|---|---|---|
| `:34` | `asString(config, 'eyebrow')` | `asStringFrom(config, aliasKeys('guide','eyebrow'))` | `role` |
| `:37` | `asStringArray(config, 'bio')` | **`asParagraphsFrom(config, aliasKeys('guide','bio'))`** | `body` |

`:37` is the worst of the seven. The builder's field is a textarea writing the flat string `body`;
`asStringArray` discards a plain string outright, so **the guide's entire biography renders as
nothing.** `asParagraphsFrom` splits on any run of newlines, so one Enter or two both yield paragraphs.

## WT-7 · invite

| Line | Current | Replace with | Stored key |
|---|---|---|---|
| `:56` | `asString(config, 'priceNote')` | `asStringFrom(config, aliasKeys('invite','priceNote'))` | `risk` |
| `:70` | `asString(config, 'ctaLabel')` | `asStringFrom(config, aliasKeys('invite','ctaLabel'))` | `button` |

**`invite.price` is deliberately NOT bridged and must never be.** Prices come only from
`JourneySalesContext.offer` (`Codex-2pryk.2.4.3`); reading the authored string would re-introduce a page
advertising a price that does not exist. The FIELD should be deleted from `section-fields.ts`, not
aliased.

## Not aliasable — these need new markup, and belong to the owning worktree

Keys the builder writes that have no renderer prop at all. A read-boundary alias cannot fix these;
the component needs somewhere to put them.

| Type | Keys | Worktree |
|---|---|---|
| `hero` | `accent`, `felt`, `bg` | WT-3 |
| `introVideo`, `reel`, `guide` | `clip` (where not aliased), `duration` | WT-2, WT-6 |
| `invite` | `accent` | WT-7 |
| `turn` | `points[]` — read at `:46` but no builder field writes it, so the roman-numeralled `arc` list is always empty | WT-1 |

## Array-shaped props with no builder editor at all

Read via `asObjectArray` with no numbered-flat fallback, so a creator has **no way to author them**
and they are permanently empty:

| Type | Prop | Read at | Worktree |
|---|---|---|---|
| `feel` | `inclusions[]` | `FeelSection:46` | WT-1 |
| `invite` | `offers[]` | consumed at `InviteSection:124` | WT-7 |

Each needs a repeatable-field editor in `section-fields.ts`. Note `feel`'s "what's inside" list and
`invite`'s offer decoration are both central to those sections' purpose — they are not optional polish.

---

# The nine hardcoded English fallbacks — a VOICE problem, not just an i18n one

Found across the public renderers. Two classes, and they need different fixes.

## Class A — voice-bearing editorial copy (7)

| File | Line | String |
|---|---|---|
| `HeroSection` | `:66` | `'Begin the journey'` |
| `FaqSection` | `:63` | `'The honest answers.'` |
| `IntroVideoSection` | `:42` | `'Ninety seconds inside the work.'` |
| `InviteSection` | `:57` | `'Begin the work.'` |
| `ProofSection` | `:78` | `'What the ground gives back.'` |
| `ReelSection` | `:50` | `'This is what a descent looks like.'` |
| `HeroSection` | — | `'Go to your dashboard'` (enrolled-viewer CTA) |

**This matters more than it looks, and it is squarely this programme's problem.** These are not neutral
labels — they are copy in one specific voice, the candlelit-descent voice of `of-blood-and-bones`,
compiled into components that *every* org's sell page renders. A brutalist developer course with an
unset heading currently publishes "This is what a descent looks like." and "What the ground gives back."

The whole point of this programme is that any brand can use these sections. You can restyle a section
across all nine axes and it is still not the creator's page if it speaks in someone else's voice. So:

**Preferred fix — fall back to DATA, not to invented prose.** `p.heading ?? context.course.title` is
always the creator's own words. `HeroSection` already does exactly this for its headline
(`p.headline ?? context.course.title`) — extend that pattern rather than inventing a sentence.

**Where no data fallback exists — let the element self-hide.** Every one of these sections already has
`{#if}` guards for optional nodes; an absent heading rendering nothing is honest, and an invented
heading is not.

**i18n only as a last resort**, and only for genuinely generic wording. A key named
`journey_reel_heading_default` whose value is "This is what a descent looks like." has not fixed the
problem — it has moved it.

## Class B — legitimate UI labels (2)

| File | Line | String | Fix |
|---|---|---|---|
| `ReelSection` | `:65` | `'Preview'` | i18n key; genuinely generic |
| `InviteSection` | `:70` | `'Join now'` | i18n key; generic CTA wording |
| `MapSection` | `:72` | `'Practice'` | i18n key — a content-type label fallback, a different and legitimate class |

These are chrome, not voice. Keys, neutral wording, done. The orchestrator owns `messages/en.json` —
report the key names.

---

## CLOSED — every bridge in this document is now consumed (round 4)

`Codex-tqr51` is closed at `feat/journey-sections-foundation`. Verified per-renderer, counting
`asStringFrom` / `aliasKeys` calls in `render/sections/*.svelte`:

| renderer | `asStringFrom` | `aliasKeys` |
|---|---|---|
| `AcheSection` | 4 | 6 |
| `FaqSection` | **0** | **0** |
| `FeelSection` | 5 | 7 |
| `GuideSection` | 4 | 7 |
| `HeroSection` | 4 | 4 |
| `IntroVideoSection` | 4 | 6 |
| `InviteSection` | 4 | 4 |
| `MapSection` | 3 | 4 |
| `ProofSection` | 2 | 2 |
| `ReelSection` | 6 | 9 |
| `TurnSection` | 6 | 10 |

**`FaqSection`'s 0/0 is a legitimate N/A, not an outstanding item.** `coerce.ts` declares
`faq: {}` — a deliberately EMPTY bridge, because FAQ stays on the numbered `q1/a1…` vocabulary by
design (A30). So the real denominator is **10 types, not 11**, which is why the bead's own title
("7 of 11") undercounted the work and its "4 of 7 done" figure was stale arithmetic. Ten types
declare a non-empty bridge; ten consume it.

### The correction worth carrying forward

This document listed WT-6 · guide as "the most severe case", and it was right — but for a reason
stronger than it stated. The catalogue's `defaultProps` seeds the **alias** side (`role`, `body`),
not the canonical side (`eyebrow`, `bio`). So it is not that *some* guide pages stored aliases —
**every guide section a creator adds stores them**, and before the bridge landed every one of them
rendered with no eyebrow and no bio while the copy sat unread in the row. Measured on a published
page: `guide__eyebrow` and `guide__bio` did not exist in the DOM at all beforehand, and render now.

### A consequence nobody had written down

**Wiring a bridge PROMOTES that type's seeded placeholder from invisible to visible.** While the
bridge is broken the renderer reads the canonical key, finds nothing, and shows nothing — so the
placeholder is latent. Wire it and the placeholder renders.

Measured: the guide placeholder went from **2 occurrences / 0 rendered** to **3 / 1** on a published
page. `faq` and `proof` had already been through this conversion in rounds 2 and 3 without anyone
connecting it, which is why their placeholders are the ones visible today.

So `Codex-maf0y` is not "placeholders exist" — it is a **queue**, and it empties in step with this
table. That reframing is what makes it worth prioritising. Do NOT fix it renderer-side: a renderer
already self-hides an *absent* field, a placeholder is present-with-placeholder-content, and
string-matching seed text breaks the moment the seed text changes. The fix is seeding strategy, in a
closed file.

### A60 in practice

Every bridged renderer writes back to the key the value was **read** from, via a `readKey(keys,
fallback)` helper — so a page storing `kicker` edits as `kicker` and one storing `eyebrow` edits as
`eyebrow`. Without it a page ends up holding both keys and the creator's edit renders as nothing.

WT-6 found a failure mode A60 did not anticipate: bridging a textarea string onto an **array**-shaped
prop via `asParagraphsFrom` alone silently drops the declared array shape, because it delegates to
`asStringFrom`, which takes strings only. The same shape gap then reached `readKey` — an array is not
a string, so the write-back fell through to the fallback key while the array under the canonical key
kept winning. **A60 can fail through a SHAPE as well as through an alias.** Any bridge from a scalar
control onto an array prop needs both halves checked.

### The Class A / Class B split, resolved

Both classes are done. Class A (voice-bearing editorial copy) is empty — a grep for string-literal
fallbacks of the shape *nullish-coalesce followed by a capitalised phrase* across all eleven
renderers returns **zero** in live code; the strings survive only in comments explaining their
removal. `Codex-i9pzs` is closed.

Class B took keys, as specified. `ReelSection:65`'s `'Preview'` consumes `journey_reel_tag_default`
(`messages/en.json:1477`). Round 4 added six further keys for accessible names and one skeleton
label — chrome that can fall back to neither data nor self-hiding — taking the total from 27 to 33
`journey_*` keys.

**The test that decides which class a string is in, restated because it is the useful part:** not the
string's length or position, but *whether another org publishing it verbatim would be embarrassed*.
