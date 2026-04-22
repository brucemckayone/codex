"""Cross-language contract test for error-code classification.

The Python handler emits `errorCode` on failure, and `TranscodingService` on
the TypeScript side routes codes in `PERMANENT_TRANSCODE_ERROR_CODES` through
`ValidationError` (so the webhook route returns 200 and stops RunPod retries).

If the two ends drift — a new Python code that isn't in the Zod enum, or a
permanent code on one side that's transient on the other — retries silently
break. These tests enforce the contract by parsing the TS source.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.modules.setdefault("runpod", MagicMock())

from handler.main import (  # noqa: E402
    PERMANENT_ERROR_CODES,
    TranscodeErrorCode,
)

REPO_ROOT = Path(__file__).resolve().parents[4]
TS_SCHEMA_FILE = REPO_ROOT / "packages/validation/src/schemas/transcoding.ts"


def _extract_ts_enum_values(pattern: str, source: str) -> set[str]:
    """Extract the string literals inside a z.enum([...]) / new Set([...]) block.

    Tolerant of formatting/whitespace differences — matches quoted identifiers
    inside the block whose opening is found by `pattern`.
    """
    m = re.search(pattern, source)
    if not m:
        raise AssertionError(f"Pattern {pattern!r} not found in schema source")
    block = source[m.end() :]
    # Find the matching `]` — simple brace counter works here because there
    # are no nested brackets in these enum bodies.
    depth = 1
    end = 0
    for i, ch in enumerate(block):
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                end = i
                break
    body = block[:end]
    return set(re.findall(r"'([A-Z_]+)'", body))


@pytest.fixture(scope="module")
def ts_source() -> str:
    if not TS_SCHEMA_FILE.exists():
        pytest.skip(f"TS schema not found at {TS_SCHEMA_FILE}")
    return TS_SCHEMA_FILE.read_text()


class TestEnumParity:
    """Keep Python `TranscodeErrorCode` and TS `transcodeErrorCodeEnum` in sync."""

    def test_python_codes_match_ts_enum(self, ts_source: str):
        ts_codes = _extract_ts_enum_values(
            r"export const transcodeErrorCodeEnum\s*=\s*z\.enum\(\[", ts_source
        )
        py_codes = {
            getattr(TranscodeErrorCode, name)
            for name in dir(TranscodeErrorCode)
            if name.isupper() and not name.startswith("_")
        }
        assert ts_codes == py_codes, (
            f"Python/TS enum drift. "
            f"Only in Python: {py_codes - ts_codes}. "
            f"Only in TS: {ts_codes - py_codes}."
        )

    def test_permanent_codes_match_ts_constant(self, ts_source: str):
        ts_permanent = _extract_ts_enum_values(
            r"PERMANENT_TRANSCODE_ERROR_CODES[\s\S]*?new Set<TranscodeErrorCode>\(\[",
            ts_source,
        )
        assert ts_permanent == set(PERMANENT_ERROR_CODES), (
            f"Permanent-code set drift between Python and TS. "
            f"Only in Python: {set(PERMANENT_ERROR_CODES) - ts_permanent}. "
            f"Only in TS: {ts_permanent - set(PERMANENT_ERROR_CODES)}."
        )


class TestClassificationInvariants:
    """The classification contract itself — independent of the enum values."""

    def test_infra_error_must_be_transient(self):
        """INFRA_ERROR is the default bucket for anything we couldn't classify.
        It MUST allow retries — otherwise a transient Neon/R2 hiccup would
        permanent-fail a file that would succeed on retry."""
        assert TranscodeErrorCode.INFRA_ERROR not in PERMANENT_ERROR_CODES

    def test_webhook_delivery_must_be_transient(self):
        """Webhook delivery failures are network-layer — the next RunPod retry
        (with a fresh webhook attempt) may well succeed."""
        assert TranscodeErrorCode.WEBHOOK_DELIVERY_FAILED not in PERMANENT_ERROR_CODES

    def test_corrupt_input_must_be_permanent(self):
        """A corrupt upload will never succeed on retry — the bytes are the
        bytes. Retrying just burns platform budget."""
        assert TranscodeErrorCode.CORRUPT_INPUT in PERMANENT_ERROR_CODES
