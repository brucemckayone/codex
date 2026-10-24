import { TRANSCODING_TRIGGER_ITEM_ANSWER_CODES } from '@codex/constants';
import { describe, expect, it } from 'vitest';
import {
  InvalidMediaStateError,
  MaxRetriesExceededError,
  TranscodingMediaNotFoundError,
} from '../errors';

// content-api reads these codes off media-api's error envelope to tell an
// answer about the item from a failed hop. A code renamed here without the
// constant would turn every such answer into "the transcoder is unavailable".
describe('upload trigger item answers', () => {
  it("are exactly the codes the trigger's item errors carry", () => {
    const codes = [
      new TranscodingMediaNotFoundError('media-1'),
      new InvalidMediaStateError('media-1', 'uploading', 'uploaded'),
      new MaxRetriesExceededError('media-1', 3),
    ].map((error) => error.context?.code);

    expect(codes).toEqual([...TRANSCODING_TRIGGER_ITEM_ANSWER_CODES]);
  });
});
