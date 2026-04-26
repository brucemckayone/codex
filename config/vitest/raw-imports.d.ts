// Ambient declaration for Vite `?raw` imports.
//
// Used by denoise proof tests to read source files at build time.
// Workerd has no `node:fs`, so readFileSync isn't an option for tests
// running under @cloudflare/vitest-pool-workers — `?raw` is bundled
// statically by Vite and works in both Node and workerd runtimes.
//
// This file deliberately has no top-level imports/exports so the
// ambient module declaration is global.

declare module '*?raw' {
  const content: string;
  export default content;
}
