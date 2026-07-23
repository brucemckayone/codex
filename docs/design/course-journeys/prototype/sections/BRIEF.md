# Section design brief — Rootwork sales page ("Of Blood and Bones")

You are designing ONE section of a premium, cinematic course sales page. Make it
genuinely beautiful — award-level craft — while fitting a shared design system so
all sections cohere into one page.

## The brand
**Of Blood and Bones** — a somatic / embodiment practice. Warm-dark, earthy, ritual,
intimate, a little mythic. NOT clinical, NOT startup-y, NOT bright. Think candlelit,
grounded, tender. The product is **Rootwork**, the foundation course: 14 guided
practices through a felt five-stage arc (Regulation → Embodiment → Attunement →
Co-regulation → Reclamation). Membership is **£12/month** (GBP, never $).

## The shared design system — you MUST use it
Read `../fresh.css` for the real tokens. Key CSS custom properties available globally:
`--ink #140e09`, `--ink-2`, `--ink-3`, `--blood #8a2b22`, `--blood-deep`,
`--ember #d8a94e`, `--ochre`, `--bone #f1e8d6`, `--bone-dim`, `--bone-faint`,
`--clay`, `--rose #cf9382`, `--serif ('Fraunces')`, `--sans ('Inter')`, `--ease`.
Fonts (Fraunces + Inter) are already loaded by the page — just use `var(--serif)` /
`var(--sans)`. Shared atoms already exist: `.cta`, `.cta--primary`, `.cta--ember`,
`.cta--ghost`, `.eyebrow`. Headings use Fraunces at weight 300–400. Body uses Inter.

## Hard rules
1. **Self-contained fragment.** Output = one `<section>` (or `<header>`) block, an
   optional `<style>` block, and an optional `<script>` (an IIFE — no globals, no
   collisions). It will be pasted directly into the page body. Everything your
   section needs travels with it.
2. **Namespace every class** with your section prefix (e.g. `.hero-…`, `.ache-…`,
   `.proof-…`) so nothing collides with other sections. Do NOT redefine shared atoms.
3. **No external assets** — no images, no CDNs, no libraries, no web fonts beyond the
   two already loaded. Atmosphere comes from CSS gradients, SVG, and pseudo-elements.
   A strict CSP will block anything external.
4. **Motion is CSS-first.** Use CSS transitions/keyframes and, if needed,
   `IntersectionObserver` in your IIFE for reveal-on-scroll. NO GSAP/libraries.
   Every animation MUST degrade gracefully and you MUST honour
   `@media (prefers-reduced-motion: reduce)` (show final state, no motion).
5. **Responsive.** Must look composed at desktop (~1280px) AND mobile (~390px). Use
   `clamp()`, fluid type, flex/grid. The page body must never scroll horizontally.
6. **FILL THE SPACE WITH INTENTION.** The #1 complaint about the current page is
   wasted space — content floating tiny in a huge void, and inconsistent type sizes.
   If your section is full-viewport, the content must inhabit it: confident scale,
   deliberate composition, no cavernous empty gaps. Generous but not hollow.
7. **Consistent internal type scale.** Within a section, sizes must feel intentional
   and related — never one line huge and the next tiny by accident.

## Voice
Spare, sensory, grounded. Short lines. Lowercase-comfortable. Never hype-y. The copy
for your section is given in your task — keep its meaning; you may refine wording
lightly but keep the tone.

## Output contract
Write your finished fragment to the exact path given in your task, e.g.
`fresh/sections/hero.frag.html`. The file contains ONLY your `<style>` + markup +
`<script>` (no `<html>`/`<head>`/`<body>`, no doctype). Assume `fresh.css` and the
fonts are already present on the page. Do NOT edit any other file. Do NOT run a
browser / Playwright (central verification happens separately). When done, reply with
a 2-3 sentence summary of what you made and any assumption you took.
