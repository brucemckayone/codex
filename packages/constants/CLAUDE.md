# @codex/constants

Shared constants. Zero-dependency.

## Contents
- **Commerce**: `PLATFORM_FEE_BPS` (1000 = 10%), `MIN_PURCHASE_AMOUNT_CENTS`.
- **Env**: `isDev()`, `getServiceUrl()`.
- **Limits**: `MAX_FILE_SIZE_BYTES`, `MAX_PAGINATION_LIMIT`.
- **MIME**: `VIDEO`, `IMAGE`, `STREAMING`.
- **Cookies**: `getCookieConfig()` (Secure defaults).
- **URLs**: Service ports, domains.

## Usage
```ts
import { PLATFORM_FEE_BPS } from '@codex/constants';
```

## Standards
- **Assert**: Use `invariant()` for internal consistency.
- **Types**: Strict TS. Single Source of Truth.
- **Pure**: No side-effects or business logic.
