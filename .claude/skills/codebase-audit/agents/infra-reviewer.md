# Infrastructure & Shared Packages Reviewer

## Domain
Shared packages (worker-utils, shared-types, constants, observability, image-processing, platform-settings, test-utils, cloudflare-clients), root build config, wrangler configs, TypeScript config.

## File Patterns
- `packages/worker-utils/src/**/*.ts`
- `packages/shared-types/src/**/*.ts`
- `packages/constants/src/**/*.ts`
- `packages/observability/src/**/*.ts`
- `packages/image-processing/src/**/*.ts`
- `packages/platform-settings/src/**/*.ts`
- `packages/test-utils/src/**/*.ts`
- `packages/cloudflare-clients/src/**/*.ts`
- `packages/service-errors/src/**/*.ts`
- `package.json` (root)
- `pnpm-workspace.yaml`
- `turbo.json`
- `tsconfig.json` (root)
- `workers/*/wrangler.jsonc`
- `packages/*/package.json`
- `packages/*/tsconfig.json`

## Checklist

### Procedure System (`worker-utils`)
- [CRITICAL] Error classes used in procedures extend `ServiceError`, not `Error`
- [CRITICAL] All procedure variants (standard, binary, multipart) consistent in execution flow
- [WARN] Code duplication between procedure variants quantified
- [WARN] Service registry creates shared instances (not duplicate Stripe/DB clients)
- [WARN] Dead code identified (unused variables, unused config flags)
- [INFO] `enforcePolicyInline` patterns are robust (no double-resolve)

### Shared Types
- [WARN] `Bindings` type has appropriate required vs optional properties
- [WARN] All env vars used in production are in the type (DATABASE_URL_LOCAL_PROXY, ASSETS_BUCKET)
- [WARN] No missing type exports that force `as any` downstream
- [INFO] Response envelope types match actual wire format

### Build & Config
- [CRITICAL] Root `tsconfig.json` references and paths cover ALL workspace packages
- [WARN] Wrangler staging environments redeclare KV namespace bindings (not inherited)
- [WARN] Turbo pipeline cache inputs are correct
- [INFO] Package dependency graphs are acyclic

### Observability
- [WARN] All log modes (`mask`, `hash`) actually implemented in `redactSensitiveData()`
- [WARN] PII redaction covers async path if hash mode is used
- [INFO] No `console.log` in production code (use ObservabilityClient)

### Test Utils
- [WARN] Test factories use correct defaults (GBP not USD, correct enum values)
- [WARN] Deprecated functions identified and marked
- [INFO] `setupTestDatabase` pattern documented

### Image Processing
- [WARN] No duplication between image variant processing methods
- [WARN] SVG sanitization called before R2 storage
- [INFO] Error handling consistent with BaseService pattern

### Cloudflare Clients
- [WARN] No duplicate R2 signed URL generation logic
- [WARN] R2 key validation blocks path traversal

### Dead Code
- [WARN] Unused files identified (metadata.ts, deprecated utilities)
- [WARN] Unused exports in barrel files
- [WARN] Dead feature flags (e.g., enableGlobalAuth always false)
- [WARN] Duplicate utility functions between files

## Output Requirements
- Full dependency graph analysis (which packages depend on what)
- Service registry audit (shared vs duplicate instances)
- Dead code inventory with exact LOC
- Wrangler consistency matrix across all workers
- TypeScript config completeness check
