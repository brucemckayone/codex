/**
 * Whether the reel on this page has a piece the shader band can meet: a
 * landscape or square picture or film. A portrait one is placed beside the
 * words with no band (`compositor/portrait.ts`), so a reel of portrait pieces
 * shows no band at all, and the brand studio hides the choice
 * (the owner's, 2026-11-23). Written by the stage as each piece's size is
 * known, read by the preview's report. Browser only: nothing writes it on the
 * server.
 */
export const reelShapes = $state({ landscape: false });
