import hashlib
import json
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from prepare_feedback import FeedbackPreparationError, prepare_feedback


PAGE = """Use this page to collect improvement feedback.

## Before recording feedback

- Keep it safe.

## Issues and improvement requests

| ID | Reported (UTC) | Reported by | Area | Issue | Reproduction context | Status | Owner | Tracking link |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| HAR-001 | 2026-08-06 10:00:00 UTC | First User | Performance | Existing issue. | HAR analysis. | New | - | - |
| HAR-004 | 2026-08-07 10:00:00 UTC | Second User | Input handling | Another issue. | Sanitized HAR. | New | - | - |

## Status values

- **New:** awaiting triage
"""

ARCHIVED_PAGE = """Use this page to collect improvement feedback.

## Issues and improvement requests

| ID | Reported (UTC) | Reported by | Area | Issue | Reproduction context | Status | Owner | Tracking link |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

## Previous testing cycle

| ID | Reported (UTC) | Reported by | Area | Issue | Reproduction context | Status | Owner | Tracking link |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| HAR-001 | 2026-08-06 10:00:00 UTC | First User | Performance | Existing issue. | HAR analysis. | Resolved | - | - |
| HAR-008 | 2026-08-11 10:52:55 UTC | Second User | Feedback workflow | Prior-cycle issue. | Feedback filing. | Under review | - | - |

## Status values

- **New:** awaiting triage
"""

CONFLUENCE_SETEXT_PAGE = """Use this page to collect improvement feedback.

Before recording feedback
-------------------------

* Keep it safe.

Issues and improvement requests
-------------------------------

**Current testing cycle:** started 2026-08-11. New issues are recorded here.

| ID | Reported (UTC) | Reported by | Area | Issue | Reproduction context | Status | Owner | Tracking link |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

Status values
-------------

* **New:** awaiting triage
"""


class PrepareFeedbackTests(unittest.TestCase):
    def test_accepts_confluence_setext_h2_and_inserts_into_active_table(self) -> None:
        result = prepare_feedback(
            CONFLUENCE_SETEXT_PAGE,
            reporter="Live Page User",
            area="Feedback workflow",
            issue="Testing the live feedback form.",
            context="Confluence Markdown conversion.",
            timestamp="2026-08-11T12:00:00Z",
        )

        self.assertEqual(result["feedbackId"], "HAR-001")
        active, status = result["updatedPageMarkdown"].split(
            "Status values\n-------------", maxsplit=1
        )
        self.assertIn(result["rowMarkdown"], active)
        self.assertNotIn(result["rowMarkdown"], status)
        self.assertIn("Issues and improvement requests\n-------------------------------", active)

    def test_empty_active_table_continues_ids_from_archived_cycle(self) -> None:
        result = prepare_feedback(
            ARCHIVED_PAGE,
            reporter="New Tester",
            area="Other",
            issue="Fresh-cycle issue.",
            context="New testing cycle.",
            timestamp="2026-08-12T09:00:00Z",
        )

        self.assertEqual(result["feedbackId"], "HAR-009")
        active, archived = result["updatedPageMarkdown"].split(
            "## Previous testing cycle", maxsplit=1
        )
        self.assertIn(result["rowMarkdown"], active)
        self.assertNotIn(result["rowMarkdown"], archived)
        self.assertIn("HAR-008", archived)

    def test_prepares_next_row_and_preserves_existing_page(self) -> None:
        result = prepare_feedback(
            PAGE,
            reporter="Example User",
            area="performance",
            issue="The feedback capture was slower than the analysis.",
            context="Completed sanitized HAR analysis; improvement workflow was delayed.",
            timestamp="2026-08-11T09:00:00Z",
        )

        self.assertEqual(result["feedbackId"], "HAR-005")
        self.assertEqual(result["reportedAtUtc"], "2026-08-11 09:00:00 UTC")
        self.assertIn(result["rowMarkdown"], result["updatedPageMarkdown"])
        self.assertIn("HAR-001", result["updatedPageMarkdown"])
        self.assertIn("HAR-004", result["updatedPageMarkdown"])
        self.assertNotIn("Positive feedback", result["updatedPageMarkdown"])
        self.assertEqual(
            result["confirmationPreview"],
            {
                "heading": "Issue ready to file",
                "rowMarkdown": result["rowMarkdown"],
                "classification": "Oracle Restricted",
                "prompt": "Would you like me to file this issue for review?",
            },
        )

    def test_redacts_urls_emails_credentials_and_markdown_delimiters(self) -> None:
        result = prepare_feedback(
            PAGE,
            reporter="Example User",
            area="Other",
            issue=(
                "Failed at https://private.example.test/a?token=secret | "
                "Authorization:Bearer abc123 and user@example.test"
            ),
            context="cookie=session-secret password=hunter2",
            timestamp="2026-08-11T09:00:00+00:00",
        )
        serialized = json.dumps(result)

        for forbidden in (
            "private.example.test",
            "secret",
            "abc123",
            "user@example.test",
            "session-secret",
            "hunter2",
        ):
            self.assertNotIn(forbidden, serialized)
        self.assertIn("[URL REDACTED]", result["issue"])
        self.assertIn("[EMAIL REDACTED]", result["issue"])
        self.assertEqual(result["rowMarkdown"].count("|"), 10)
        self.assertNotIn("private.example.test", json.dumps(result["confirmationPreview"]))
        self.assertNotIn("user@example.test", json.dumps(result["confirmationPreview"]))

    def test_neutralizes_html_and_markdown_link_injection(self) -> None:
        result = prepare_feedback(
            PAGE,
            reporter="Example <Admin>",
            area="Other",
            issue="<script>alert(1)</script> [click](javascript:alert(2))",
            context="Completed HAR analysis.",
            timestamp="2026-08-11T09:00:00Z",
        )

        self.assertNotIn("<script>", result["rowMarkdown"])
        self.assertNotIn("[click]", result["rowMarkdown"])
        self.assertIn("&lt;script&gt;", result["rowMarkdown"])
        self.assertIn("Example &lt;Admin&gt;", result["rowMarkdown"])

    def test_rejects_email_as_reporter(self) -> None:
        with self.assertRaisesRegex(FeedbackPreparationError, "display name"):
            prepare_feedback(
                PAGE,
                reporter="user@example.test",
                area="Other",
                issue="Improve the result.",
                context="HAR analysis.",
            )

    def test_rejects_missing_or_changed_table(self) -> None:
        with self.assertRaisesRegex(FeedbackPreparationError, "table header"):
            prepare_feedback(
                PAGE.replace("| ID | Reported (UTC)", "| Identifier | Reported (UTC)"),
                reporter="Example User",
                area="Other",
                issue="Improve the result.",
                context="HAR analysis.",
            )

    def test_rejects_unknown_area(self) -> None:
        with self.assertRaisesRegex(FeedbackPreparationError, "Unsupported area"):
            prepare_feedback(
                PAGE,
                reporter="Example User",
                area="Unknown category",
                issue="Improve the result.",
                context="HAR analysis.",
            )

    def test_cli_writes_candidate_without_modifying_page(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            page_path = Path(directory) / "page.md"
            output_path = Path(directory) / "candidate.json"
            page_path.write_text(PAGE, encoding="utf-8")
            before = hashlib.sha256(page_path.read_bytes()).hexdigest()
            completed = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT_DIR / "prepare_feedback.py"),
                    "--page-markdown",
                    str(page_path),
                    "--reported-by",
                    "Example User",
                    "--area",
                    "Feedback workflow",
                    "--issue",
                    "Make feedback filing faster.",
                    "--context",
                    "Completed HAR analysis.",
                    "--timestamp",
                    "2026-08-11T09:00:00Z",
                    "--output",
                    str(output_path),
                ],
                capture_output=True,
                text=True,
                timeout=10,
            )
            after = hashlib.sha256(page_path.read_bytes()).hexdigest()
            payload = json.loads(output_path.read_text(encoding="utf-8"))

        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(before, after)
        self.assertEqual(payload["feedbackId"], "HAR-005")
        self.assertLess(payload["elapsedMs"], 1000)

    def test_cli_stdout_is_utf8_when_page_contains_feedback_emoji(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            page_path = Path(directory) / "page.md"
            page_path.write_text(
                PAGE + "\n**👍 No, this looks good**\n**👎 Yes, I have a suggestion**\n",
                encoding="utf-8",
            )
            completed = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT_DIR / "prepare_feedback.py"),
                    "--page-markdown",
                    str(page_path),
                    "--reported-by",
                    "Example User",
                    "--area",
                    "Other",
                    "--issue",
                    "Fresh-cycle issue.",
                    "--context",
                    "New testing cycle.",
                    "--timestamp",
                    "2026-08-12T09:00:00Z",
                ],
                capture_output=True,
                timeout=10,
            )

        self.assertEqual(completed.returncode, 0, completed.stderr.decode(errors="replace"))
        payload = json.loads(completed.stdout.decode("utf-8"))
        self.assertEqual(payload["feedbackId"], "HAR-005")
        self.assertIn("👍", payload["updatedPageMarkdown"])

    def test_cli_refuses_to_overwrite_fetched_page(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            page_path = Path(directory) / "page.md"
            page_path.write_text(PAGE, encoding="utf-8")
            before = hashlib.sha256(page_path.read_bytes()).hexdigest()
            completed = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT_DIR / "prepare_feedback.py"),
                    "--page-markdown",
                    str(page_path),
                    "--reported-by",
                    "Example User",
                    "--area",
                    "Other",
                    "--issue",
                    "Improve the result.",
                    "--context",
                    "Completed HAR analysis.",
                    "--output",
                    str(page_path),
                ],
                capture_output=True,
                text=True,
                timeout=10,
            )
            after = hashlib.sha256(page_path.read_bytes()).hexdigest()

        self.assertEqual(completed.returncode, 2)
        self.assertIn("must not overwrite", completed.stderr)
        self.assertEqual(before, after)

    def test_large_page_preparation_is_fast(self) -> None:
        rows = "\n".join(
            f"| HAR-{index:03d} | 2026-08-01 00:00:00 UTC | User | Other | Issue. | Context. | New | - | - |"
            for index in range(1, 2001)
        )
        large_page = PAGE.replace(
            "| HAR-001 | 2026-08-06 10:00:00 UTC | First User | Performance | Existing issue. | HAR analysis. | New | - | - |\n"
            "| HAR-004 | 2026-08-07 10:00:00 UTC | Second User | Input handling | Another issue. | Sanitized HAR. | New | - | - |",
            rows,
        )
        started = time.perf_counter()
        result = prepare_feedback(
            large_page,
            reporter="Example User",
            area="Performance",
            issue="Make feedback faster.",
            context="Completed HAR analysis.",
            timestamp="2026-08-11T09:00:00Z",
        )
        elapsed = time.perf_counter() - started

        self.assertEqual(result["feedbackId"], "HAR-2001")
        self.assertLess(elapsed, 1.0)


if __name__ == "__main__":
    unittest.main()
