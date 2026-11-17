/**
 * Why the studio could not read a piece (Codex-a6ofh.2.3): the session ended,
 * the piece was refused, or the read could not be made. `PieceReadProblem`
 * says it where a read failed; "Open it to update" says it in its notice.
 */
import { isReadOutage, remoteErrorStatus } from '$lib/remote/query-result';

export type ReadProblem = 'signed-out' | 'gone' | 'outage';

/**
 * Which problem a failed read is: 401 is a session that ended (the
 * studio's guard runs on loads, not on this read); another 4xx a refusal,
 * final (deleted, not theirs, a bad link); anything else an outage, the
 * only one Try again can help.
 */
export function readProblem(error: unknown): ReadProblem | null {
  if (error == null) return null;
  if (remoteErrorStatus(error) === 401) return 'signed-out';
  return isReadOutage(error) ? 'outage' : 'gone';
}
