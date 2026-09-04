import { createPackageConfig } from '../../config/vite/package.config';

export default createPackageConfig({
  packageName: 'database',
  entry: {
    index: 'src/index.ts',
    'schema/index': 'src/schema/index.ts',
  },
  additionalExternals: [
    'drizzle-orm',
    'drizzle-kit',
    'better-auth',
    'better-auth/adapters/drizzle',
    'ws', // External: Node.js WebSocket package (must not be bundled/stubbed)
    // EXTERNAL OR THE HYPERDRIVE PATH BREAKS UNDER WORKERD. Vite bundles a
    // dependency that is not listed here into the library output, and its
    // CJS interop leaves pg's `require('events')` as a runtime require. Node
    // resolves that; workerd does not — `class Query extends EventEmitter`
    // throws "Class extends value undefined", reproducibly under
    // `wrangler dev --local` with nodejs_compat, on wrangler 4.50 AND 4.129
    // (PR #487). Left external, wrangler's own esbuild performs the CJS
    // conversion and pg module-loads in workerd (verified by direct import).
    // Note 'drizzle-orm' above does NOT cover subpaths — rollup externals
    // match exactly.
    'pg',
    'drizzle-orm/node-postgres',
  ],
});
