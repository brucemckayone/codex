# @codex/constants

Shared constant values used across the Codex platform. Provides a single source of truth for configuration defaults, environment keys, limits, and MIME types.

## Overview

@codex/constants is a zero-dependency package containing shared values that must remain consistent across workers and services.

## Categories

### Commerce
- `PLATFORM_FEE_BPS`: Default platform fee in basis points (1000 = 10%)
- `MIN_PURCHASE_AMOUNT_CENTS`: Minimum allowed purchase price
- `CURRENCY_DEFAULT`: 'usd'

### Environment
- `ENV_PRODUCTION`, `ENV_STAGING`, `ENV_DEVELOPMENT`, `ENV_TEST`

### Limits
- `MAX_FILE_SIZE_BYTES`: Global maximum file size for uploads
- `MAX_PAGINATION_LIMIT`: Maximum items allowed per page

### MIME Types
- `MIME_VIDEO_MP4`, `MIME_AUDIO_MPEG`, etc.

### URLs
- Default worker ports and development URLs

## Usage

```typescript
import { PLATFORM_FEE_BPS } from '@codex/constants';

const fee = (price * PLATFORM_FEE_BPS) / 10000;
```
