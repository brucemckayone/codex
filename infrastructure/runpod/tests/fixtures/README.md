# Transcoding Test Fixtures

## `contract/`: the webhook bodies the handler sends

`contract/*.json` are the exact bodies the handler POSTs for a set of mocked
jobs (sized and flat posters, audio, two failures, a progress tick). Two tests
read them, so neither side can change the contract alone:

- `tests/unit/test_contract_fixtures.py` fails when the handler's output
  drifts from them;
- `packages/validation/src/schemas/__tests__/transcoding-contract.test.ts`
  parses them with the service's `runpodWebhookUnionSchema`.

After an intended change, regenerate with
`UPDATE_CONTRACT_FIXTURES=1 pytest tests/unit` (from `infrastructure/runpod`),
then run the validation package's tests. Its turbo `test` task lists this
directory as an input, so a changed fixture re-runs it.

## Damaged and QuickTime media: generated, never committed

No media file is committed (`.gitignore` keeps `*.mp4`/`*.m4a` out). The two
container checks make theirs from ffmpeg's test sources each run, so they
always match the ffmpeg they run under:

- `tests/integration/verify_quicktime_outputs.py`: what Apple devices and
  editors hand over (HEVC 10-bit HLG and PQ, ProRes 4:2:2, rotated portrait,
  4:4:4, a no-audio screen recording, a timecode track, a 1.2 s clip).
- `tests/integration/verify_damaged_sources.py`: a copy cut short, scattered
  holes, a broken audio track under a perfect picture, a picture that cannot
  be decoded at all, a lost moov index, a broken audio-only file. Each must
  complete, or fail with the code listed in its `EXPECTED` table.

`runpod-ci.yml` runs both inside the built image (prod's ffmpeg 4.4.2).
