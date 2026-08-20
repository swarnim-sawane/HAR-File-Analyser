#!/usr/bin/env python3
"""Prepare one privacy-safe HAR Analyzer improvement row and updated page Markdown."""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


PAGE_LIMIT_BYTES = 2 * 1024 * 1024
SECTION_TITLE = "Issues and improvement requests"
TABLE_HEADER = (
    "| ID | Reported (UTC) | Reported by | Area | Issue | "
    "Reproduction context | Status | Owner | Tracking link |"
)
AREAS = {
    "analysis quality": "Analysis quality",
    "performance": "Performance",
    "input handling": "Input handling",
    "feedback workflow": "Feedback workflow",
    "documentation": "Documentation",
    "other": "Other",
}

URL_RE = re.compile(r"https?://[^\s|]+", re.IGNORECASE)
EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
BEARER_RE = re.compile(r"\bBearer\s+[A-Za-z0-9._~+/=-]+", re.IGNORECASE)
SENSITIVE_ASSIGNMENT_RE = re.compile(
    r"\b(authorization|cookie|set-cookie|token|password|passwd|secret|"
    r"api[-_ ]?key)\b\s*[:=]\s*([^\s,;|]+)",
    re.IGNORECASE,
)
CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]+")
WHITESPACE_RE = re.compile(r"\s+")
HAR_ID_RE = re.compile(r"^\|\s*HAR-(\d+)\s*\|", re.IGNORECASE)
ATX_H2_RE = re.compile(r"^##\s+(.+?)(?:\s+#+)?$")
SETEXT_H2_UNDERLINE_RE = re.compile(r"^-{3,}$")


class FeedbackPreparationError(ValueError):
    """Raised when a feedback candidate cannot be prepared safely."""


def _normalize_area(value: str) -> str:
    normalized = WHITESPACE_RE.sub(" ", value.strip()).lower()
    try:
        return AREAS[normalized]
    except KeyError as exc:
        allowed = ", ".join(AREAS.values())
        raise FeedbackPreparationError(f"Unsupported area. Use one of: {allowed}.") from exc


def _sanitize_cell(value: str, *, maximum: int, field: str) -> tuple[str, list[str]]:
    warnings: list[str] = []
    text = CONTROL_RE.sub(" ", value)
    text = text.replace("[", "(").replace("]", ")")
    text = URL_RE.sub("[URL REDACTED]", text)
    text = EMAIL_RE.sub("[EMAIL REDACTED]", text)
    text = BEARER_RE.sub("Bearer [REDACTED]", text)
    text = SENSITIVE_ASSIGNMENT_RE.sub(lambda match: f"{match.group(1)}=[REDACTED]", text)
    text = WHITESPACE_RE.sub(" ", text).strip()
    text = text.replace("|", "/").replace("`", "'")
    text = html.escape(text, quote=False)
    if not text:
        raise FeedbackPreparationError(f"{field} cannot be empty.")
    if len(text) > maximum:
        text = text[: maximum - 3].rstrip() + "..."
        warnings.append(f"{field} was shortened to {maximum} characters")
    return text, warnings


def _validate_reporter(value: str) -> str:
    reporter = WHITESPACE_RE.sub(" ", CONTROL_RE.sub(" ", value)).strip()
    if not reporter:
        raise FeedbackPreparationError("Reported by cannot be empty.")
    if "@" in reporter or EMAIL_RE.search(reporter):
        raise FeedbackPreparationError("Reported by must be a display name, not an email address.")
    reporter = reporter.replace("[", "(").replace("]", ")")
    reporter = reporter.replace("|", "/").replace("`", "'")
    reporter = html.escape(reporter, quote=False)
    if len(reporter) > 120:
        raise FeedbackPreparationError("Reported by is longer than 120 characters.")
    return reporter


def _format_timestamp(value: str | None) -> str:
    if value is None:
        parsed = datetime.now(timezone.utc)
    else:
        candidate = value.strip()
        if candidate.endswith(" UTC"):
            candidate = candidate[:-4] + "+00:00"
        elif candidate.endswith("Z"):
            candidate = candidate[:-1] + "+00:00"
        try:
            parsed = datetime.fromisoformat(candidate)
        except ValueError as exc:
            raise FeedbackPreparationError(
                "Timestamp must be ISO-8601 UTC, for example 2026-08-11T09:00:00Z."
            ) from exc
        if parsed.tzinfo is None:
            raise FeedbackPreparationError("Timestamp must include a UTC offset or Z suffix.")
        parsed = parsed.astimezone(timezone.utc)
    return parsed.replace(microsecond=0).strftime("%Y-%m-%d %H:%M:%S UTC")


def _read_page(path: Path) -> str:
    try:
        size = path.stat().st_size
    except OSError as exc:
        raise FeedbackPreparationError(f"Cannot read page Markdown: {exc}") from exc
    if size > PAGE_LIMIT_BYTES:
        raise FeedbackPreparationError("Page Markdown exceeds the 2 MB safety limit.")
    try:
        return path.read_text(encoding="utf-8-sig")
    except (OSError, UnicodeError) as exc:
        raise FeedbackPreparationError(f"Cannot read UTF-8 page Markdown: {exc}") from exc


def _h2_at(lines: list[str], index: int) -> tuple[str, int] | None:
    """Return a level-2 heading title and its first body-line index."""
    stripped = lines[index].strip()
    atx_match = ATX_H2_RE.fullmatch(stripped)
    if atx_match:
        return atx_match.group(1).strip(), index + 1
    if (
        stripped
        and index + 1 < len(lines)
        and SETEXT_H2_UNDERLINE_RE.fullmatch(lines[index + 1].strip())
    ):
        return stripped, index + 2
    return None


def prepare_feedback(
    page_markdown: str,
    *,
    reporter: str,
    area: str,
    issue: str,
    context: str,
    timestamp: str | None = None,
) -> dict[str, Any]:
    started = time.perf_counter()
    lines = page_markdown.splitlines()
    ids = [
        int(match.group(1))
        for line in lines
        if (match := HAR_ID_RE.match(line.strip()))
    ]
    section = next(
        (
            (index, heading[1])
            for index in range(len(lines))
            if (heading := _h2_at(lines, index)) is not None
            and heading[0] == SECTION_TITLE
        ),
        None,
    )
    if section is None:
        raise FeedbackPreparationError(
            f"Required level-2 section not found: {SECTION_TITLE}"
        )
    section_start, section_body_start = section

    section_end = len(lines)
    for index in range(section_body_start, len(lines)):
        if _h2_at(lines, index) is not None:
            section_end = index
            break

    try:
        header_index = next(
            index
            for index in range(section_body_start, section_end)
            if lines[index].strip() == TABLE_HEADER
        )
    except StopIteration as exc:
        raise FeedbackPreparationError("The improvement table header is missing or changed.") from exc

    separator_index = header_index + 1
    if separator_index >= section_end or not lines[separator_index].lstrip().startswith("| ---"):
        raise FeedbackPreparationError("The improvement table separator is missing or changed.")

    insert_index = separator_index + 1
    while insert_index < section_end and lines[insert_index].lstrip().startswith("|"):
        insert_index += 1

    feedback_id = f"HAR-{max(ids, default=0) + 1:03d}"
    reported_by = _validate_reporter(reporter)
    selected_area = _normalize_area(area)
    safe_issue, issue_warnings = _sanitize_cell(issue, maximum=500, field="Issue")
    safe_context, context_warnings = _sanitize_cell(
        context, maximum=300, field="Reproduction context"
    )
    reported_at = _format_timestamp(timestamp)
    row = (
        f"| {feedback_id} | {reported_at} | {reported_by} | {selected_area} | "
        f"{safe_issue} | {safe_context} | New | - | - |"
    )

    updated_lines = lines[:insert_index] + [row] + lines[insert_index:]
    updated_page = "\n".join(updated_lines)
    if page_markdown.endswith(("\n", "\r")):
        updated_page += "\n"

    return {
        "schemaVersion": 1,
        "mode": "improvement-only",
        "feedbackId": feedback_id,
        "reportedAtUtc": reported_at,
        "reportedBy": reported_by,
        "area": selected_area,
        "issue": safe_issue,
        "reproductionContext": safe_context,
        "status": "New",
        "rowMarkdown": row,
        "updatedPageMarkdown": updated_page,
        "confirmationPreview": {
            "heading": "Issue ready to file",
            "rowMarkdown": row,
            "classification": "Oracle Restricted",
            "prompt": "Would you like me to file this issue for review?",
        },
        "verification": {
            "pageTitle": "HAR Analyzer Feedback Form",
            "expectedId": feedback_id,
            "expectedRow": row,
        },
        "warnings": issue_warnings + context_warnings,
        "elapsedMs": round((time.perf_counter() - started) * 1000, 3),
    }


def _write_result(result: dict[str, Any], output: Path | None) -> None:
    serialized = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if output is None:
        if hasattr(sys.stdout, "buffer"):
            sys.stdout.buffer.write(serialized.encode("utf-8"))
        else:
            sys.stdout.write(serialized)
        return
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(serialized, encoding="utf-8")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Prepare one sanitized HAR Analyzer improvement row."
    )
    parser.add_argument("--page-markdown", required=True, type=Path)
    parser.add_argument("--reported-by", required=True)
    parser.add_argument("--area", required=True)
    parser.add_argument("--issue", required=True)
    parser.add_argument("--context", required=True)
    parser.add_argument("--timestamp")
    parser.add_argument("--output", type=Path)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        if args.output is not None and args.output.resolve() == args.page_markdown.resolve():
            raise FeedbackPreparationError(
                "Output must not overwrite the fetched page Markdown."
            )
        page_markdown = _read_page(args.page_markdown)
        result = prepare_feedback(
            page_markdown,
            reporter=args.reported_by,
            area=args.area,
            issue=args.issue,
            context=args.context,
            timestamp=args.timestamp,
        )
        _write_result(result, args.output)
        return 0
    except FeedbackPreparationError as exc:
        parser.exit(2, f"Feedback preparation failed: {exc}\n")


if __name__ == "__main__":
    raise SystemExit(main())
