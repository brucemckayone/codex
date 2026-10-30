/**
 * Where a film is, for `PreviewPlayerCore`'s time display and scrubber. Both
 * read the stream's own figures (`video.duration`, `video.buffered`), never
 * the source's runtime a clip may carry: a sales film's `durationSeconds` is
 * the full upload's length, not the cut that plays.
 */

/** Seconds as `m:ss`, or `h:mm:ss` from the hour; `0:00` until there is a figure. */
export function clock(seconds: number): string {
  const whole =
    Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = String(whole % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}`
    : `${minutes}:${secs}`;
}

/**
 * How far the film has loaded, as the scrubber's lighter band draws it: the
 * furthest end of any buffered range that starts at or before the playhead
 * (a quarter second of slack, as a range can begin just after it). A seek
 * into an unloaded stretch reads short of the playhead until it fills.
 */
export function loadedTo(ranges: TimeRanges, time: number): number {
  let end = 0;
  for (let i = 0; i < ranges.length; i++) {
    if (ranges.start(i) <= time + 0.25) end = Math.max(end, ranges.end(i));
  }
  return end;
}

/** Where the film is, for a frame drawing its own controls (the core's `clock()`). */
export interface PlayerClock {
  time: number;
  /** The stream's own length; 0 until it says. */
  duration: number;
  /** The play button would offer Play: paused, or mid-swap and not wanted. */
  offerPlay: boolean;
  /** Sound was refused and it plays muted: `toggleMute` takes it (owner P7). */
  askSound: boolean;
}
