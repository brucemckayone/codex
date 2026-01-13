import { ObservabilityClient } from '@codex/observability';
import { dev } from '$app/environment';

export const logger = new ObservabilityClient(
  'web-app',
  dev ? 'development' : 'production'
);
