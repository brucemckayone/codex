/**
 * Journeys remote functions (Codex-2pryk · WP-4).
 *
 * Client→server mutations for the course member surfaces. The dashboard /
 * player DATA is loaded server-side in their `+page.server.ts` (via the Round-D
 * seam); this module carries only the mark-complete COMMAND, which the progress
 * store fires optimistically.
 */

import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { command, getRequestEvent } from '$app/server';
import type { PracticeCompletionRecord } from '$lib/journeys/types';
import { persistPracticeCompletion } from '$lib/server/journeys/round-d-seam';

const markCompleteSchema = z.object({
  contentId: z.string().uuid(),
  source: z.enum(['manual', 'auto']),
});

/**
 * Record a practice completion (SPEC §11 / D-E). Writes the
 * `practice_completions` row — the SOURCE OF TRUTH for course progress — once
 * per (user, content). Called for an explicit "Mark complete" (`manual`) and on
 * a media's genuine 100% finish (`auto`). Auth-gated: completion belongs to a
 * signed-in member.
 *
 * The actual DB write is Round-D (mocked in the seam today); the command
 * contract, auth gate, and validation are real.
 */
export const markPracticeCompleted = command(
  markCompleteSchema,
  async ({ contentId, source }): Promise<PracticeCompletionRecord> => {
    const event = getRequestEvent();
    const userId = event.locals.user?.id;
    if (!userId) error(401, 'Sign in to record progress');

    return persistPracticeCompletion(event, userId, { contentId, source });
  }
);
