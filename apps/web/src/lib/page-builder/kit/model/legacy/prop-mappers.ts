/**
 * Legacy props → v2 props, per legacy type (contract §3: "Props are mapped
 * to the v2 keys, reading EVERY historical alias the legacy coercers in
 * `render/coerce.ts` accept. A prop whose value equals the legacy
 * catalogue's seed default for that key is dropped").
 *
 * Every legacy key read here is traced to one of: `section-fields.ts` (what
 * the builder writes), `render/types.ts` (what the OLD renderer reads) and
 * its aliasing in `render/coerce.ts` `SECTION_PROP_ALIASES` (which name wins
 * when both exist for the same v2 concept). The v2 destination shape is
 * contract §2's per-type prop table.
 *
 * SEED-DEFAULT FILTERING happens on every scalar read, via `authored()` /
 * `authoredFirst()` below — applying it uniformly (even to keys with no
 * entry in `seed-defaults.ts`, where the check is simply always-false) is
 * simpler and safer than deciding per-field whether to bother.
 *
 * `authored*` — never throws, always seed-filtered:
 */
import {
  fieldBool,
  fieldString,
  fieldStringArray,
  joinLines,
  joinParagraphs,
  readNumberedGroups,
  readObjectArray,
  readString,
  readStringArray,
  splitParagraphs,
} from './read-helpers';
import { isSeedDefault } from './seed-defaults';

function authored(
  type: string,
  key: string,
  props: Record<string, unknown>
): string | undefined {
  const value = readString(props, key);
  return isSeedDefault(type, key, value) ? undefined : value;
}

function authoredFirst(
  type: string,
  props: Record<string, unknown>,
  keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const value = authored(type, key, props);
    if (value !== undefined) return value;
  }
  return undefined;
}

// ── hero → hero ──────────────────────────────────────────────────────────

/** Legacy `mediaMode` (`''|'none'|'image'|'loop'|'click'`) → v2 `media`.
 *  `''`/absent (readString already rejects `''`) → undefined, letting the
 *  v2 renderer's own "no opinion" default apply, rather than hard-coding
 *  'auto' for what may not even be a real choice. */
function mapHeroMedia(
  mediaMode: string | undefined
): 'image' | 'video' | 'none' | undefined {
  switch (mediaMode) {
    case 'none':
      return 'none';
    case 'image':
      return 'image';
    case 'loop':
    case 'click':
      return 'video';
    default:
      return undefined;
  }
}

function heroProps(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  const eyebrow = authored('hero', 'eyebrow', raw);
  if (eyebrow) out.eyebrow = eyebrow;

  // "hero accent ending appended to heading" — `accent` renders on its own
  // line under the headline (render/types.ts's own doc on the field); v2 has
  // one plain `heading` string, so the ending becomes a second line of it.
  const heading = joinLines(
    authored('hero', 'headline', raw),
    authored('hero', 'accent', raw)
  );
  if (heading) out.heading = heading;

  // "hero felt → second body paragraph" — `sub` is the first paragraph.
  const body = joinParagraphs(
    authored('hero', 'sub', raw),
    authored('hero', 'felt', raw)
  );
  if (body) out.body = body;

  const ctaLabel = authoredFirst('hero', raw, ['ctaLabel', 'button']);
  if (ctaLabel) out.ctaLabel = ctaLabel;

  // "trust → note".
  const note = authored('hero', 'trust', raw);
  if (note) out.note = note;

  const secondaryLabel = authoredFirst('hero', raw, [
    'secondaryLabel',
    'quiet',
  ]);
  if (secondaryLabel) out.secondaryLabel = secondaryLabel;

  const secondaryHref = authored('hero', 'secondaryHref', raw);
  if (secondaryHref) out.secondaryHref = secondaryHref;

  const media = mapHeroMedia(readString(raw, 'mediaMode'));
  if (media) out.media = media;

  // `mediaMode` → v2 `watchLabel` label rename.
  const watchLabel = authored('hero', 'mediaLabel', raw);
  if (watchLabel) out.watchLabel = watchLabel;

  // "drop hero bg" — the atmosphere recipe has no v2 prop at all; dropped
  // unconditionally regardless of its value (never in seed-defaults.ts).
  return out;
}

// ── introVideo → video ───────────────────────────────────────────────────

function introVideoProps(
  raw: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const eyebrow = authoredFirst('introVideo', raw, ['eyebrow', 'kicker']);
  if (eyebrow) out.eyebrow = eyebrow;
  const heading = authored('introVideo', 'heading', raw);
  if (heading) out.heading = heading;
  const body = authored('introVideo', 'sub', raw);
  if (body) out.body = body;
  // `clip` ("on-frame label") is the closest legacy equivalent of a caption.
  const caption = authored('introVideo', 'clip', raw);
  if (caption) out.caption = caption;
  // `duration` has no v2 prop — dropped (matches `seed-journey-content.ts`'s
  // own `DELETE_PROPS` precedent: an authored duration masks the real probed
  // one, so the legacy renderer's mask is not worth preserving either).
  return out;
}

// ── ache → problem ───────────────────────────────────────────────────────

function acheProps(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const eyebrow = authoredFirst('ache', raw, ['eyebrow', 'kicker']);
  if (eyebrow) out.eyebrow = eyebrow;
  const heading = authored('ache', 'heading', raw);
  if (heading) out.heading = heading;
  const body = authoredFirst('ache', raw, ['body', 'sub']);
  if (body) out.body = body;
  // `points` — the section-fields.ts editor field (list, "one per row").
  // NOT `beats` (render/types.ts's `AcheSectionProps.beats?`): no editor
  // field or `coerce.ts` alias ever writes `beats`, so it is read-but-
  // unauthorable — the SAME defect class this codebase calls out repeatedly
  // (Codex-tqr51 &c.) — while `points` is what the builder actually stores
  // (confirmed on the real `bone-deep` row). See Decisions.
  const points = readStringArray(raw, 'points');
  if (points) out.points = points;
  return out;
}

// ── turn → transformation ────────────────────────────────────────────────

function turnProps(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const eyebrow = authoredFirst('turn', raw, ['eyebrow', 'kicker']);
  if (eyebrow) out.eyebrow = eyebrow;
  const heading = authoredFirst('turn', raw, ['statement', 'heading']);
  if (heading) out.heading = heading;
  const body = authoredFirst('turn', raw, ['lede', 'body']);
  if (body) out.body = body;
  // "turn from/to" — each a multi-line textarea; v2 wants `string[]`.
  const before = splitParagraphs(authored('turn', 'from', raw));
  if (before) out.before = before;
  const after = splitParagraphs(authored('turn', 'to', raw));
  if (after) out.after = after;
  // `points` (the roman-numeralled Arc / three-beat Numbered list) has NO
  // v2 destination — contract §2's transformation prop table is eyebrow/
  // heading/body/ctaLabel/note (common) + beforeLabel/afterLabel/before/
  // after ONLY. DROPPED. This is real content loss on a page using the Arc
  // or Numbered composition — flagged prominently under Known gaps.
  return out;
}

// ── feel → benefits ──────────────────────────────────────────────────────

function feelProps(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const eyebrow = authoredFirst('feel', raw, ['eyebrow', 'kicker']);
  if (eyebrow) out.eyebrow = eyebrow;
  const heading = authored('feel', 'heading', raw);
  if (heading) out.heading = heading;
  const body = authored('feel', 'body', raw);
  if (body) out.body = body;
  // `inclusions[]` ({label, detail}) → v2 `items[]` ({title, detail}).
  const items = readObjectArray(raw.inclusions, (entry) => {
    const title = fieldString(entry, 'label');
    if (!title) return null;
    const detail = fieldString(entry, 'detail');
    return detail ? { title, detail } : { title };
  });
  if (items) out.items = items;
  // `previewTitle`/`previewSub`/`previewDuration` (the "free-taste" preview
  // player) has no v2 slot — DROPPED. Known gap (niche, recently-added).
  return out;
}

// ── map → curriculum ─────────────────────────────────────────────────────

function mapProps(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const eyebrow = authored('map', 'eyebrow', raw);
  if (eyebrow) out.eyebrow = eyebrow;
  const heading = authoredFirst('map', raw, ['title', 'heading']);
  if (heading) out.heading = heading;
  const body = authored('map', 'sub', raw);
  if (body) out.body = body;
  const note = authoredFirst('map', raw, ['foot', 'note']);
  if (note) out.note = note;
  // No other keys — v2 curriculum carries no type-specific props at all
  // (contract §2: "— (stages are live)").
  return out;
}

// ── reel → preview ───────────────────────────────────────────────────────

function reelProps(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const eyebrow = authoredFirst('reel', raw, ['eyebrow', 'kicker']);
  if (eyebrow) out.eyebrow = eyebrow;
  const heading = authored('reel', 'heading', raw);
  if (heading) out.heading = heading;
  const body = authored('reel', 'sub', raw);
  if (body) out.body = body;
  // v2 `caption?` is singular; legacy's primary authored field is the
  // ARRAY `captions` ("whispered captions", section-fields.ts) — take its
  // first entry. Legacy's own singular `caption` (render/types.ts: "the
  // single-line form") is the fallback for a page authored before
  // `captions` existed.
  const captions = readStringArray(raw, 'captions');
  const caption = captions?.[0] ?? authored('reel', 'caption', raw);
  if (caption) out.caption = caption;
  // `clip`/`tag` (on-frame label / corner tag) and `duration` have no v2
  // slot — DROPPED.
  return out;
}

// ── guide → instructor ───────────────────────────────────────────────────

function guideProps(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  // Legacy's ONE field is literally labelled "Role / eyebrow" in
  // section-fields.ts — mapped to v2's TYPE-SPECIFIC `role`, not the common
  // `eyebrow`: v2 instructor carries both, and legacy never had a distinct
  // generic-eyebrow value for guide sections to preserve. See Decisions.
  const role = authored('guide', 'role', raw);
  if (role) out.role = role;
  const heading = authored('guide', 'heading', raw);
  if (heading) out.heading = heading;
  // v2 `body?` is a plain string (paragraphs via blank lines) — legacy's
  // `body` textarea already IS that shape; no array-ification needed here
  // (unlike the OLD renderer's own `GuideSectionProps.bio: string[]`, which
  // is a `render/`-side concern this upgrade does not need to replicate).
  const body = authoredFirst('guide', raw, ['bio', 'body']);
  if (body) out.body = body;
  const name = authored('guide', 'name', raw);
  if (name) out.name = name;
  const quote = authored('guide', 'quote', raw);
  if (quote) out.quote = quote;
  // `facts[]` ({label, detail}) → v2 `credentials?: string[]` (flat). No
  // existing alias/convention bridges this shape gap (unlike `feel`'s
  // `inclusions`→`items`, nothing in `coerce.ts` reads `facts` at all today
  // — the SAME "declared field, no reader" defect class this codebase has
  // repeatedly found). Joined as "label: detail" (or bare label). Decision.
  const credentials = readObjectArray(raw.facts, (entry) => {
    const label = fieldString(entry, 'label');
    if (!label) return null;
    const detail = fieldString(entry, 'detail');
    return detail ? `${label}: ${detail}` : label;
  });
  if (credentials) out.credentials = credentials;
  // `clip` (on-frame label) / `duration` have no v2 slot — DROPPED.
  return out;
}

// ── proof → testimonials ─────────────────────────────────────────────────

interface TestimonialItem {
  quote: string;
  name?: string;
  detail?: string;
}

function proofProps(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const eyebrow = authored('proof', 'eyebrow', raw);
  if (eyebrow) out.eyebrow = eyebrow;
  const heading = authored('proof', 'heading', raw);
  if (heading) out.heading = heading;
  // Legacy's aggregate trust line has no dedicated v2 slot — `note?` ("small
  // reassurance under a CTA") is the closest available fit, even though
  // testimonials has no CTA for it to sit under. Decision, imperfect fit.
  const note = authoredFirst('proof', raw, ['trustLabel', 'trust']);
  if (note) out.note = note;

  // `q1/n1/c1`…`q3/n3/c3` — the OLD renderer's `ProofSectionProps` never
  // declared these at all (confirmed against `render/types.ts` +
  // `coerce.ts`'s alias table, which has no entry for them), so this
  // content has been WRITE-ONLY since the builder shipped it — every
  // "Quote 1/Name 1/Context 1" a creator ever typed rendered nowhere on the
  // public page. v2's `items[]` (merged after live testimonials) is the
  // first real destination for it, recovering rather than losing content.
  const items = readNumberedGroups<TestimonialItem>(
    raw,
    { quote: 'q', name: 'n', detail: 'c' },
    (group) => {
      if (!group.quote) return null;
      const item: TestimonialItem = { quote: group.quote };
      if (group.name) item.name = group.name;
      if (group.detail) item.detail = group.detail;
      return item;
    },
    12,
    (props, key) => authored('proof', key, props)
  );
  if (items) out.items = items;
  return out;
}

// ── faq → faq ─────────────────────────────────────────────────────────────

interface FaqItem {
  question: string;
  answer: string;
}

function faqProps(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const eyebrow = authored('faq', 'eyebrow', raw);
  if (eyebrow) out.eyebrow = eyebrow;
  const heading = authored('faq', 'heading', raw);
  if (heading) out.heading = heading;

  const items = readNumberedGroups<FaqItem>(
    raw,
    { question: 'q', answer: 'a' },
    (group) =>
      group.question && group.answer
        ? { question: group.question, answer: group.answer }
        : null,
    12,
    (props, key) => authored('faq', key, props)
  );
  if (items) out.items = items;
  // `g1/g2/g3` (the Grouped layout's category label) has no v2 slot —
  // DROPPED. `contactLabel`/`contactHref` are v2-NEW; no legacy source.
  return out;
}

// ── invite → pricing ─────────────────────────────────────────────────────

function inviteProps(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const eyebrow = authored('invite', 'eyebrow', raw);
  if (eyebrow) out.eyebrow = eyebrow;

  // "invite heading+accent line → one heading".
  const heading = joinLines(
    authored('invite', 'heading', raw),
    authored('invite', 'accent', raw)
  );
  if (heading) out.heading = heading;

  const body = authored('invite', 'sub', raw);
  if (body) out.body = body;

  const ctaLabel = authoredFirst('invite', raw, ['ctaLabel', 'button']);
  if (ctaLabel) out.ctaLabel = ctaLabel;

  // `priceNote`/`risk` — the "risk-reversal reassurance" line. Unlike
  // proof's `trust`, this IS exactly what v2's `note?` describes.
  const note = authoredFirst('invite', raw, ['priceNote', 'risk']);
  if (note) out.note = note;

  // `offers[]` decorations. `who` ("one line above the price") has no v2
  // `offers[]` field — dropped per-entry. `id`/`name`/`blurb`/`bullets`/
  // `best` carry straight across; NEVER seed-filtered (`offers` is never
  // seeded by the catalogue or either seed script, so any array found is
  // 100% creator-authored).
  const offers = readObjectArray(raw.offers, (entry) => {
    const id = fieldString(entry, 'id');
    if (!id) return null;
    const item: Record<string, unknown> = { id };
    const name = fieldString(entry, 'name');
    if (name) item.name = name;
    const blurb = fieldString(entry, 'blurb');
    if (blurb) item.blurb = blurb;
    const bullets = fieldStringArray(entry, 'bullets');
    if (bullets) item.bullets = bullets;
    if (fieldBool(entry, 'best')) item.best = true;
    return item;
  });
  if (offers) out.offers = offers;

  return out;
}

// ── Dispatch ──────────────────────────────────────────────────────────────

const PROP_MAPPERS: Readonly<
  Record<string, (raw: Record<string, unknown>) => Record<string, unknown>>
> = {
  hero: heroProps,
  introVideo: introVideoProps,
  ache: acheProps,
  turn: turnProps,
  feel: feelProps,
  map: mapProps,
  reel: reelProps,
  guide: guideProps,
  proof: proofProps,
  faq: faqProps,
  invite: inviteProps,
};

/** Map one legacy type's raw props to its v2 shape, or `undefined` when
 *  `legacyType` names no known legacy type (the caller's v2-pass-through
 *  path handles that case instead — see `upgrade.ts`). Own entries only: a
 *  stored type such as `'valueOf'` must not call `Object.prototype.valueOf`. */
export function mapLegacyProps(
  legacyType: string,
  raw: Record<string, unknown>
): Record<string, unknown> | undefined {
  return Object.hasOwn(PROP_MAPPERS, legacyType)
    ? PROP_MAPPERS[legacyType]?.(raw)
    : undefined;
}
