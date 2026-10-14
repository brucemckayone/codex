/**
 * Reactive test double for `$lib/remote/ownership.remote` (Codex-2hxff.2).
 *
 * The real module imports `$app/server`, so it cannot load in jsdom. The query
 * double reads `$state`, so a test can land a new view — the result of a
 * command's single-flight refresh, say — and watch the card re-render exactly
 * as it does in production. `error` mirrors a REJECTED kit query: `current`
 * stays undefined and the rejection sits on `error`, with no `loading` to lean
 * on.
 *
 * A `.svelte.ts` module (runes compiled), NOT a `*.test.*` file → never
 * collected as a suite.
 */

import { vi } from 'vitest';
import type { OwnershipView } from '$lib/types';

const state = $state<{
  view: OwnershipView | undefined;
  error: unknown;
}>({ view: undefined, error: undefined });

// ── query() ─────────────────────────────────────────────────────────────
export const refresh = vi.fn(async () => {});

export function getOwnership(_organizationId: string) {
  return {
    get current() {
      return state.view;
    },
    get error() {
      return state.error;
    },
    refresh,
  };
}

// ── command() ───────────────────────────────────────────────────────────
type Input = { organizationId: string; offerId?: string };

export const offerOwnership = vi.fn(async (_input: Input) => ({}));
export const withdrawOwnershipOffer = vi.fn(async (_input: Input) => ({}));
export const acceptOwnershipOffer = vi.fn(async (_input: Input) => ({}));
export const declineOwnershipOffer = vi.fn(async (_input: Input) => ({}));

// ── test controls ───────────────────────────────────────────────────────
export function setView(view: OwnershipView) {
  state.view = view;
  state.error = undefined;
}

export function setLoadError(error: unknown) {
  state.view = undefined;
  state.error = error;
}

export function reset() {
  state.view = undefined;
  state.error = undefined;
  refresh.mockReset();
  refresh.mockResolvedValue(undefined);
  for (const command of [
    offerOwnership,
    withdrawOwnershipOffer,
    acceptOwnershipOffer,
    declineOwnershipOffer,
  ]) {
    command.mockReset();
    command.mockResolvedValue({});
  }
}
