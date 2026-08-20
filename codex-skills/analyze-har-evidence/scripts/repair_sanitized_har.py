#!/usr/bin/env python3
"""Bounded, in-memory repair for HAR JSON damaged by sanitization."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


# Only values that HAR defines as numeric are eligible.  Do not repair URLs,
# headers, bodies, or arbitrary user-provided text.
NUMERIC_HAR_FIELDS = (
    "time|blocked|dns|connect|ssl|send|wait|receive|status|headersSize|"
    "bodySize|size|compression"
)
PLACEHOLDER = r"(?:\[?(?:redacted|removed|masked|sanitized|secret|token)[^,}\]\s]*\]?|<[^>\r\n]{1,80}>)"
UNQUOTED_PLACEHOLDER = re.compile(
    rf'(?P<field>"(?:{NUMERIC_HAR_FIELDS})")(?P<colon>\s*:\s*)(?P<value>{PLACEHOLDER})(?=\s*[,}}])',
    re.IGNORECASE,
)


def repair_sanitized_har_json(raw: str) -> tuple[dict[str, Any] | None, int]:
    """Parse HAR JSON, repairing only unquoted numeric-field placeholders.

    The source string is never written.  A repair is accepted only when it
    produces a HAR-shaped object, preventing accidental reinterpretation of a
    console log or unrelated JSON document.
    """
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        parsed = None
    if isinstance(parsed, dict) and isinstance(parsed.get("log"), dict):
        return parsed, 0

    if '"log"' not in raw or '"entries"' not in raw:
        return None, 0

    repaired, substitutions = UNQUOTED_PLACEHOLDER.subn(
        lambda match: f'{match.group("field")}{match.group("colon")}0', raw
    )
    if not substitutions:
        return None, 0
    try:
        parsed = json.loads(repaired)
    except json.JSONDecodeError:
        return None, 0
    if not isinstance(parsed, dict) or not isinstance(parsed.get("log"), dict):
        return None, 0
    return parsed, substitutions


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Validate a sanitized HAR and report bounded in-memory repairs."
    )
    parser.add_argument("input", type=Path, help="HAR or JSON file")
    args = parser.parse_args(argv)
    raw = args.input.read_text(encoding="utf-8-sig", errors="replace")
    data, substitutions = repair_sanitized_har_json(raw)
    if data is None:
        print("No safe HAR repair was available.", file=sys.stderr)
        return 2
    print(json.dumps({"har": True, "repairedNumericPlaceholders": substitutions}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
