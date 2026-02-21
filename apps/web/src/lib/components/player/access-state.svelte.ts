/**
 * Preview Player Access State Machine
 *
 * Manages the access state transition for preview players.
 * Handles the flow from loading -> preview/unlocked/locked.
 *
 * This file uses .svelte.ts extension to enable Svelte 5 runes ($state).
 */

import type { AccessState } from './types';
import { PREVIEW_LIMIT_SECONDS } from './types';

/**
 * Access state machine configuration
 */
export interface AccessStateMachineConfig {
  /** Initial access state */
  initialState?: AccessState;
  /** Preview duration limit in seconds */
  previewLimit?: number;
  /** Callback when state changes */
  onStateChange?: (state: AccessState) => void;
}

/**
 * Create an access state machine for the preview player
 *
 * The state machine manages these transitions:
 * - loading -> preview (user can watch preview)
 * - loading -> unlocked (user has purchased)
 * - loading -> locked (user needs to purchase/sign in)
 * - loading -> error (something went wrong)
 * - preview -> locked (preview duration ended)
 *
 * @example
 * ```ts
 * const machine = createAccessStateMachine({
 *   onStateChange: (state) => console.log('State:', state)
 * });
 *
 * // Start checking access
 * await machine.checkAccess(getStreamingUrl, contentId);
 * ```
 */
export function createAccessStateMachine(
  config: AccessStateMachineConfig = {}
) {
  const {
    initialState = 'loading',
    previewLimit = PREVIEW_LIMIT_SECONDS,
    onStateChange,
  } = config;

  let state = $state<AccessState>(initialState);
  let previewRemaining = $state(previewLimit);

  return {
    /**
     * Get the current access state
     */
    get currentState(): AccessState {
      return state;
    },

    /**
     * Get remaining preview time in seconds
     */
    get remainingPreviewTime(): number {
      return previewRemaining;
    },

    /**
     * Check user access by attempting to get streaming URL
     * This should be called when the component mounts
     */
    async checkAccess(
      getStreamingUrl: (
        contentId: string
      ) => Promise<{ streamingUrl: string } | null>,
      contentId: string
    ): Promise<void> {
      state = 'loading';
      onStateChange?.(state);

      try {
        const result = await getStreamingUrl(contentId);

        if (result?.streamingUrl) {
          state = 'unlocked';
        } else {
          state = 'preview';
        }
      } catch {
        // Assume preview is available if access check fails
        state = 'preview';
      }

      onStateChange?.(state);
    },

    /**
     * Transition to locked state (preview ended)
     */
    lock(): void {
      state = 'locked';
      onStateChange?.(state);
    },

    /**
     * Update preview time remaining
     * Transitions to locked when time runs out
     */
    updateTime(elapsed: number): void {
      if (state !== 'preview' && state !== 'unlocked') return;

      if (state === 'preview' && elapsed >= previewLimit) {
        this.lock();
      }
    },

    /**
     * Reset to initial state (for retry)
     */
    reset(): void {
      state = 'loading';
      previewRemaining = previewLimit;
      onStateChange?.(state);
    },

    /**
     * Set state directly (for manual control)
     */
    setState(newState: AccessState): void {
      state = newState;
      onStateChange?.(newState);
    },
  };
}

/**
 * Access state machine return type
 */
export type AccessStateMachine = ReturnType<typeof createAccessStateMachine>;
