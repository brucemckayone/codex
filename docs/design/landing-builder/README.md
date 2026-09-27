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

| WP | State | Commit(s) | Notes |
|---|---|---|---|
| 1 | done | `dd152aaf` | v2 validation keys, legacy→v2 upgrade, id parity; hero/faq provenance fix |
| 2 | done | `d193b38a` `54efd94f` `e8ffd9c6` `cf373b26` `93e694c3` | Styles, schemes, primitives, renderer, hero/pricing/cta; band-apart rule; failed-image fallback |
| 3 · 4 · 5 | done | `b7aee127` `99b26ccc` | all 14 section types real; identity test across all 4 Styles |
| 6 | done | `6b934c5a` `e41266ad` | public page on the kit; not-open pages say so; hero still on first paint |
| 7a · 7b | done | `63a269ff` `db094c02` | store v2 + autosave; canvas-first editor; undo survives autosave; org default font loads |
| 8 | done | `cea0b39f` `85f46fa9` | inspector, live pickers, gallery, Style tab, icons; dark-mode brand carry |
| 9a · 9b · 9c | done | `2af311cd` `f1216ed1` `11e49b80` | new editor is THE builder; legacy builder/renderer/catalogue deleted (~59k lines); v2-only writes; v2 seeds in 4 Styles |
| 10a | done | `9081d842` | page image upload route + orphan diff |
| 10b | done | `249821af` | creator images in hero/cta/text/benefits; alt text + decorative opt-in |
| 11 | done (gates) | `7169709b` | R16 build 24/24 + typecheck 57/57 (0 cached); web 2872, validation 564, access 383, worker-utils 230, content-api 169, image-processing 98; check:ci + brand-boundary clean. NOT run: journeys e2e, codex-review |

## Open follow-ups (not blockers)

- Run the journeys e2e specs (`sell-page-head`, `sell-page-purchase` were updated to kit markup but not executed) and `codex-review` before merging; the legacy canvas-parity spec was deleted, not rewritten.
- Page images: variants top out at 800px (full-bleed hero/cta upscale on wide screens — add an `xl` variant or srcset). Cleanup was reworked after codex-review (contract A3, revised 2026-09-27): uploads are queued as they land and the sweep re-checks references, so never-saved uploads and duplicated pages are both handled.
- Pricing `offers[].id` is free text — a picker of the live offer paths would be friendlier.
- Only Chrome audited; the no-`pow()` colour fallback isn't in the contrast matrix. Editor checked at 1280–1440 desktop only.
- Dev DB: the draft test portal "Quiet Hours" (studio-alpha) carries test images and a Text section.

## Resume

Read `01-contract.md` (binding), then this table, then `git log --oneline origin/dev..HEAD` in the
worktree. Memory: `project_landing_builder_redesign_2026_09_26.md`.
