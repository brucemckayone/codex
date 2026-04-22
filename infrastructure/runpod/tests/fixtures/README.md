# Transcoding Test Fixtures

Small synthetic media files for unit + integration tests. Checked in because
real media uploads are too large for the repo and mocking ffmpeg at the
subprocess level produces brittle tests that don't catch real-world corruption.

All fixtures are generated deterministically from the commands below — regenerate
if they drift or you need a different duration/resolution.

## Files

| File | Size | Purpose |
|---|---|---|
| `healthy_short.mp4` | ~315 KB | Happy-path smoke (H.264 + AAC, 5s, 320x180) |
| `truncated.mp4` | ~311 KB | Healthy file minus the last 4 KB — the 2026-04-17 exit-69 case |
| `corrupt_aac.mp4` | ~315 KB | Healthy file with 3 mid-stream 64-byte regions scrambled |
| `audio_only.m4a` | ~41 KB | Audio-only path: 5s, 440 Hz sine, AAC |
| `unparseable.bin` | 1 MB | 1 MB of /dev/urandom — catastrophically broken, not a valid container |

## Regeneration

Run from repo root. Requires `ffmpeg` (4.4.x+) and `python3`.

### `healthy_short.mp4`

```bash
ffmpeg -hide_banner -y \
  -f lavfi -i testsrc2=d=5:s=320x180:r=24 \
  -f lavfi -i sine=d=5:f=440 \
  -c:v libx264 -preset ultrafast -crf 28 \
  -c:a aac -b:a 64k \
  -movflags +faststart \
  infrastructure/runpod/tests/fixtures/healthy_short.mp4
```

### `truncated.mp4`

```bash
FIX=infrastructure/runpod/tests/fixtures
SIZE=$(stat -f%z "$FIX/healthy_short.mp4")      # macOS. Linux: stat -c%s
TRUNC=$((SIZE - 4096))
dd if="$FIX/healthy_short.mp4" of="$FIX/truncated.mp4" bs=1 count=$TRUNC 2>/dev/null
```

### `corrupt_aac.mp4`

```bash
python3 <<'PY'
import random
fix = "infrastructure/runpod/tests/fixtures"
with open(f"{fix}/healthy_short.mp4", "rb") as f:
    data = bytearray(f.read())
random.seed(42)
n = len(data)
for start_frac in (0.3, 0.5, 0.7):
    start = int(n * start_frac)
    for i in range(start, start + 64):
        data[i] = random.randint(0, 255)
with open(f"{fix}/corrupt_aac.mp4", "wb") as f:
    f.write(bytes(data))
PY
```

### `audio_only.m4a`

```bash
ffmpeg -hide_banner -y \
  -f lavfi -i sine=d=5:f=440 \
  -c:a aac -b:a 64k \
  infrastructure/runpod/tests/fixtures/audio_only.m4a
```

### `unparseable.bin`

```bash
head -c 1048576 /dev/urandom > infrastructure/runpod/tests/fixtures/unparseable.bin
```

## How tests use these

- `tests/unit/test_command_builders.py` and `tests/unit/test_error_classification.py`
  use `healthy_short.mp4` + `unparseable.bin` to exercise `_input_args`,
  `validate_output`, `verify_decodable`, and the `TranscodeError` code set
  without spinning up the full handler.
- `tests/integration/test_resilient_decode.py` runs the whole handler against
  each fixture end-to-end (with local R2/B2 fakes). This is what actually
  verifies the resilience flags survive a real ffmpeg invocation.

## Expected ffmpeg behaviour (with RESILIENT flags)

| Fixture | Preflight | Mezzanine | Status |
|---|---|---|---|
| `healthy_short.mp4` | pass | pass | `completed` |
| `truncated.mp4` | pass (decode drops late frames) | pass | `completed` (was exit 69 before the fix) |
| `corrupt_aac.mp4` | pass (glitches accepted) | pass | `completed` |
| `audio_only.m4a` | pass | n/a (audio path) | `completed` |
| `unparseable.bin` | **fail** | not reached | `failed` with `errorCode=CORRUPT_INPUT` |
