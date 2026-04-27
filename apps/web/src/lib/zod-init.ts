// Side-effect module: disables Zod 4's JIT object-parser fast-path.
//
// Zod 4 generates a parser function via `new Function(...)` for object
// schemas to speed up validation. To feature-detect whether the runtime
// allows that, it runs a one-shot probe (`new Function("")`) the first
// time any object schema is parsed. Under our `script-src` CSP — which
// does NOT include `'unsafe-eval'` (see apps/web/svelte.config.js) — the
// probe is blocked and the browser logs a CSP violation. Zod's own
// try/catch swallows the error and falls back to the interpreted path,
// so behaviour is unaffected, but the console warning is noisy and
// alarming.
//
// Setting `jitless: true` short-circuits `jit && allowsEval.value` at
// every schema instantiation, so the probe is never accessed and no
// CSP violation is reported. The interpreted path is what we'd end up
// using anyway under our CSP — this just makes the choice explicit and
// silent.
//
// MUST be imported as the first runtime import in apps/web/src/routes/
// +layout.svelte so it executes before any schema-importing component
// module instantiates an object schema. ESM evaluates each `import`
// statement's transitive graph depth-first in source order, so a single
// side-effect import at the top runs ahead of every sibling import.
//
// Server-side is unaffected: Zod's probe also short-circuits when
// `navigator.userAgent.includes("Cloudflare")`, which workerd reports.
import { z } from 'zod';

z.config({ jitless: true });
