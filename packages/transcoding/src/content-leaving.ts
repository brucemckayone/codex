/**
 * The leaving notice's sweep (Codex-a6ofh.6.4), media-api's side: the hourly
 * maintenance run asks content-api for one tick, which sends the owners'
 * emails, adds the day-27 reminders and finishes the deletes whose day has
 * come. content-api does all of it; this side only asks and keeps the tally.
 */

import type { ContentLeavingSweepReport } from '@codex/validation';

export interface ContentLeavingSweeper {
  /**
   * One tick, awaited (owner: the route is synchronous). Resolves with what
   * content-api did; throws when it would not run the tick, or gave no
   * report.
   */
  sweep(): Promise<ContentLeavingSweepReport>;
}
