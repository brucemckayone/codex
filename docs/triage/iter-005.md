# iter-005 — rung 1 — Codex-zhe80

> Auto mode (/loop fired manually after a long pause; user instruction: "address something addressable", followup: "do 1 then 2a and improve the skill to handle this sort of thing").

## Bead

**Codex-zhe80** — `simplify(web): CreatorCard.svelte inline-redeclares ContentItem + SocialLinks — 5th instance`

- Priority: P1
- Type: bug
- Source: denoise iter-027, F2
- Fingerprint: `simplification:dup-content-item-shape`

## Classification reasoning

iter-004 had marked all `denoise:*`-tagged beads as ineligible — that filter was wrong. The skill §0 rule "/denoise owns verification" is about the *verification phase*, not the *resolution phase*. Once a denoise bead carries a cited proof-test path under `apps/web/src/__denoise_proofs__/`, /denoise has done its job; the bead is resolution-ready and any skill (including /triage) can close it.

Codex-zhe80 carried:
- Cited file:line (`apps/web/src/lib/components/ui/CreatorCard/CreatorCard.svelte:34, :41`)
- Cited canonical (`apps/web/src/lib/components/ui/CreatorCard/types.ts:11, :18`)
- Explicit fix shape (`~5-line diff`: replace inline interfaces with import from `./types`)
- Cited proof test path (`apps/web/src/__denoise_proofs__/iter-027/F2-creator-card-content-item-dup.test.ts`)

That's a textbook rung-1 candidate. Inline interfaces structurally identical to `./types` exports → byte-equivalent replacement.

## Pre-flight gate

`bd show Codex-zhe80 --json` immediately before claim: status=open, owner=brucemckayone (the user). After `bd update --status=in_progress`, re-read: status=in_progress, owner unchanged. Claim won; concurrent agent did not race.

## Action

### Edit 1 — `CreatorCard.svelte` import

```diff
   import type { Snippet } from 'svelte';
+  import type { ContentItem, SocialLinks } from './types';
   import * as m from '$paraglide/messages';
```

### Edit 2 — `CreatorCard.svelte` remove inline declarations

```diff
-  interface SocialLinks {
-    website?: string;
-    twitter?: string;
-    youtube?: string;
-    instagram?: string;
-  }
-
-  interface ContentItem {
-    title: string;
-    slug: string;
-    thumbnailUrl: string | null;
-    contentType: string;
-  }
-
   interface Props extends HTMLAttributes<HTMLDivElement> {
```

Net: +1, -13 lines.

### Edit 3 — proof test un-skip

```diff
-describe.skip('iter-027 F2 — CreatorCard.svelte must import ContentItem + SocialLinks from sibling types.ts', () => {
+describe('iter-027 F2 — CreatorCard.svelte must import ContentItem + SocialLinks from sibling types.ts', () => {
```

### Edit 4 — proof test path bug fix (in-scope sidequest)

```diff
-const repoRoot = resolve(__dirname, '../../../../../..');
+const repoRoot = resolve(__dirname, '../../../../..');
```

This fix is the same shape as iter-002's 5 corrections to iter-012 proof tests. iter-027's test scaffolding inherited the iter-012 template's path bug. Without this fix, the un-skipped proof test fails with ENOENT and the falsifiability gate doesn't fire.

## Proof evidence

```
$ pnpm exec vitest run src/__denoise_proofs__/iter-027/F2-creator-card-content-item-dup.test.ts
 ✓ src/__denoise_proofs__/iter-027/F2-creator-card-content-item-dup.test.ts (5 tests) 8ms

 Test Files  1 passed (1)
      Tests  5 passed (5)
```

5/5 assertions passing:

1. `types.ts` exports `ContentItem` with the 4-field shape ✓
2. `types.ts` exports `SocialLinks` ✓
3. `CreatorCard.svelte` does NOT inline-redeclare `interface ContentItem` ✓
4. `CreatorCard.svelte` does NOT inline-redeclare `interface SocialLinks` ✓
5. `CreatorCard.svelte` imports `ContentItem` and `SocialLinks` from sibling `./types` ✓

## Recurrence increments

- `route:self:proof-test-path-mechanical-fix` → hits=1→2, +iter-005, +Codex-zhe80. One sighting away from threshold; iter-006 will trip it.
- `signal:over-filter-denoise-tagged-rung-1` → NEW pattern, hits=1. Tracks the iter-004 over-filter mistake.
- `signal:cluster-defect-team-fix-eligible` → NEW pattern, hits=1. Tracks the user-surfaced "agent team for shared-bug clusters" idea. Skill §1 R1 updated with the exception this iter; iter-006 will be the first cycle that exercises it.

## Spillover

3 sibling proof tests have the same `repoRoot` path bug:

- `apps/web/src/__denoise_proofs__/iter-027/F1-sidebar-rail-studio-roles-dup.test.ts` → owns by Codex-w30gi
- `apps/web/src/__denoise_proofs__/iter-027/F3-content-detail-loader-dup.test.ts` → owns by Codex-0n26b
- `apps/web/src/__denoise_proofs__/iter-027/F4-doc-rot-loadFromServer.test.ts` → owns by Codex-mqyql.18

Pre-iter-005 skill rule (R1: one bead per cycle) would have made these 3 separate cycles. New cluster-defect exception authorises a single iter-006 agent team to fix all 3 in parallel. Each agent fixes both the path bug AND the actual code defect cited in its bead, then closes its bead.

## Skill update

`SKILL.md` §1 R1 amended with cluster-defect exception. New §13 "Cluster-defect agent teams" added with the team-spawn protocol. iter-006 is the prototype.
