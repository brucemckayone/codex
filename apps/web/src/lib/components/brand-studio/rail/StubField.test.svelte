<!--
  Test-only stub standing in for the reused brand-editor field components when
  mounting BrandStudioRail in jsdom. The real leaves (FontPicker/Melt, logo
  remote form, OKLCH canvas) are exercised by their own suites; the rail suite
  only needs to prove its OWN grouping / search / breadcrumb behaviour, so each
  reused component is mocked to this inert marker.

  Named `*.test.svelte` (a fixture, per AccordionHarness.test.svelte) so the
  vitest include globs (`*.test.ts`, `*.svelte.test.ts`) never collect it.
-->
<div data-testid="stub-field"></div>
