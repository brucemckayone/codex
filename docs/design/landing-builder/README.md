# Landing page builder — full redesign

**Why.** After three passes on the nine-axis model (#498, #503) the owner's verdict on the journey
sales-page builder was "underwhelming… the designs are kind of rubbish… a bad setup — totally
redesign it". Measured on 2026-09-26 against the seeded pages:

- every look renders a centred text stack on an empty stage; imagery and atmosphere were wired only
  to the Candlelit look;
- free / not-yet-open journeys (seeded Bone Deep) render **no CTA at all**;
- the ache section silently re-uses the hero's sub-line; a £49 one-off card says "Cancel anytime";
  grey panels read as disabled;
- the builder asks creators to juggle "Look" vs "Design" vs "Layout", 40 jargon values across nine
  axes and 63 compositions; look presets are text-only cards; the canvas renders at 50%.

**What.** A new page kit: one **Style** per page (Bold · Clean · Soft · Cinematic), 2–4 designed
**layouts** per section, five brand-derived **colour schemes**, a **spacing** size; plain-named
sections (14 types); a canvas-first editor with autosave. The binding spec is
[`01-contract.md`](01-contract.md).

**Where.** Worktree `/Users/brucemckay/development/Codex-landing-redesign`, branch
`feat/landing-builder-redesign` off `origin/dev@46677c68`. One PR to `dev` at the end. The dev stack
runs from this worktree (`pnpm dev` at its root; web on `lvh.me:3000`).

## Work packages

Max two agents at a time. Each WP ends with the orchestrator's gate (contract §9) and a commit.

| WP | Title | Territory | Depends on | Round |
|---|---|---|---|---|
| 1 | Model: v2 validation keys, upgrade + legacy maps, id parity, offer-paths accepts `pricing` | `packages/validation`, `packages/shared-types`, `kit/model/upgrade*`, `kit/model/legacy/*`, `offer-paths.ts` | — | 1 |
| 2 | Kit foundation: styles, schemes, primitives, shell, renderer, registry (all 14 folders), resolve/cta/shape/template, dev preview route; flagship **hero · pricing · cta** | `kit/**` except model/ids,types,upgrade; `studio/page-kit/**` | — | 1 |
| 3 | Blocks: video · preview · instructor · stats | `kit/blocks/{video,preview,instructor,stats}` | 2 | 2 |
| 4 | Blocks: problem · transformation · benefits · text | `kit/blocks/{problem,transformation,benefits,text}` | 2 | 2 |
| 5 | Blocks: curriculum · testimonials · faq | `kit/blocks/{curriculum,testimonials,faq}` | 2 | 3 |
| 6 | Public switch: the sales page renders the kit (upgrade at load, public context builder, SSR/no-JS, hero still in first paint, `mediaBaseUrl` in the envelope, editable.ts off the legacy catalogue); legacy renderer stays until WP-9 because the legacy editor still imports it | public journey route + tests, `render/types.ts`, `render/editable.ts`, `packages/access` read path, journeys e2e sell-page specs | 1, 3, 4, 5 | 4 |
| 7a | Editor logic: store v2 methods (style/layout/scheme/spacing, add with starter props), autosave controller (draft autosave, published → Publish changes), unload guard | `page-builder-store*`, `builder-save*`, `autosave*` | 1 | 1 |
| 7b | Editor A UI: shell, top bar, outline, true-scale canvas, selection + inline edit, insert points | `components/page-builder/editor/**` (shell files), `studio/journeys/[id]/page-next/**` | 2, 7a | 3 |
| 8 | Editor B: inspector, layout/scheme/spacing pickers with live mini-renders, fields, section gallery, Style tab + page brand | `components/page-builder/editor/**` (inspector files) | 7 | 4 |
| 9 | Builder switch + legacy deletion: studio route → new editor; delete the legacy editor AND legacy renderer (`render/sections`, SectionFrame/Renderer, JourneyRenderer, catalogue, design css, their tests); new-page template + `NEW_PAGE_DESIGN`; seeds write v2; validation prunes legacy keys | studio journey page route, `components/page-builder/*` (legacy), `lib/page-builder/render/**`, `packages/access`, seeds, validation | 6, 8 | 5 |
| 10a | Images backend: page image upload route + processing, orphan diff on save, `page_image` type migration, web remote + URL helper (contract A3) | content-api route, image-processing, access service, database, `remote/page-images.remote.ts`, `page-builder/page-images.ts` | — | 1 |
| 10b | Images in the kit: image fields in blocks, hero/cta backgrounds, an image/gallery block, picker UI | kit blocks + editor | 8, 10a | 5 |
| 11 | Verification + polish: multi-brand × Style × theme sweep, axe, contrast matrix, responsive, perf, codex-review, PR | cross-cutting (fixes routed back) | all | 6 |

## Status

| WP | State | Notes |
|---|---|---|
| 1 | **done** `dd152aaf` | 561 validation + 123 web tests; provenance fix for hero/faq added by orchestrator (falsified) |
| 2 | **done** `d193b38a` | 241 kit tests; svelte-check 0 new; visually approved in all 4 Styles, dark brand, dark theme, mobile. Follow-up: centre a lone offer card in Soft `cards` |
| 10a | **done** | upload route + processing + save-time orphan diff + migration 0095; 98+380+230+24 tests; live upload smoke-tested. Gaps: abandoned uploads not swept (needs a reference-aware sweep check), cdnBase must reach the kit context (WP6/7b), page duplication would share prefixes (WP11) |
| 7a | **done** | store v2 actions + autosave controller; 311 tests across 13 files; web tsc clean |
| 3 | **done** `b7aee127` | video · preview · instructor · stats |
| 4 | **done** `b7aee127` | problem · transformation · benefits · text; 1,680-combination contrast probe, floor 4.97:1 |
| 5 | **done** `99b26ccc` | curriculum · testimonials · faq; identity test now covers all 4 Styles |
| 7b | running | canvas-first editor shell at `studio/journeys/[id]/page-next` |
| 6 | running | public sales page on the kit |
| 8, 9, 10b, 11 | not started | |

## Resume

Read `01-contract.md` (binding), then this table, then `git log --oneline origin/dev..HEAD` in the
worktree. Memory: `project_landing_builder_redesign_2026_09_26.md`.
