# @codex/observability

Structured logging & metrics. Zero-dependency. PII Redaction.

## API
### `ObservabilityClient`
- **info/warn/error(msg, meta)**: Log with level.
- **debug(msg, meta)**: Dev only.
- **trackRequest(metrics)**: Log HTTP req (url, method, dur, status).
- **trackError(err, context)**: Log error with stack/context.

### Utils
- **createRequestTimer(obs, req)**: Timing helper. `.end(status)`.
- **redactSensitiveData(data)**: Mask/remove PII (keys: password, token, email, etc).

## Config
- **Env**: `development` (mask, debug on), `production` (hash PII, debug off).
- **Output**: JSON to console (Cloudflare captures).

## Usage
```ts
const obs = new ObservabilityClient('svc', 'production');
obs.info('Action', { userId: '123' }); // JSON output
```