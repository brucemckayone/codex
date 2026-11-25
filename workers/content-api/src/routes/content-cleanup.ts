/**
 * The cover cleanup a delete runs (Codex-ko8ko), now in @codex/worker-utils
 * so admin-api's delete and takedown share it (Codex-a6ofh.6). Re-exported
 * here so the routes import it from one module the route tests can mock
 * (`vi.mock('../content-cleanup')`).
 */
export { cleanupContentThumbnailOnDelete } from '@codex/worker-utils';
