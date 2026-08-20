import json
import gzip
import tempfile
import unittest
from pathlib import Path

from analyze_evidence import load_and_analyze, sanitize_url


class AnalyzeEvidenceTests(unittest.TestCase):
    def write_file(self, directory: str, name: str, content: str) -> Path:
        path = Path(directory) / name
        path.write_text(content, encoding="utf-8")
        return path

    def test_har_findings_are_evidence_based_and_sanitized(self) -> None:
        har = {
            "log": {
                "entries": [
                    {
                        "startedDateTime": "2026-07-30T10:00:00Z",
                        "time": 55,
                        "_resourceType": "document",
                        "request": {
                            "method": "GET",
                            "url": "http://example.test/?token=secret",
                        },
                        "response": {"status": 200, "headers": [], "content": {}},
                    },
                    {
                        "startedDateTime": "2026-07-30T10:00:01Z",
                        "time": 1500,
                        "_resourceType": "script",
                        "request": {
                            "method": "GET",
                            "url": "http://example.test/app.js?api_key=secret",
                        },
                        "response": {
                            "status": 503,
                            "headers": [{"name": "Content-Type", "value": "application/javascript"}],
                            "bodySize": 200000,
                            "content": {"size": 200000, "mimeType": "application/javascript"},
                        },
                    },
                    {
                        "startedDateTime": "2026-07-30T10:00:02Z",
                        "time": 20,
                        "request": {
                            "method": "GET",
                            "url": "https://example.test/api?id=customer",
                        },
                        "response": {"status": 0, "headers": [], "content": {}},
                    },
                    {
                        "startedDateTime": "2026-07-30T10:00:03Z",
                        "time": 30,
                        "request": {
                            "method": "GET",
                            "url": "https://example.test/api?id=other",
                        },
                        "response": {"status": 200, "headers": [], "content": {}},
                    },
                ]
            }
        }
        with tempfile.TemporaryDirectory() as directory:
            path = self.write_file(directory, "sample.har", json.dumps(har))
            report = load_and_analyze(path, 20)

        finding_ids = {item["id"] for item in report["findings"]}
        self.assertEqual(report["source"]["type"], "har")
        self.assertIn("http-5xx", finding_ids)
        self.assertIn("status-zero", finding_ids)
        self.assertIn("slow-requests", finding_ids)
        self.assertIn("large-uncompressed-text", finding_ids)
        self.assertIn("repeated-requests", finding_ids)
        serialized = json.dumps(report)
        self.assertNotIn("secret", serialized)
        self.assertNotIn("customer", serialized)

    def test_console_false_positives_remain_conservative(self) -> None:
        content = "\n".join(
            [
                "GET /health 200 in 500ms",
                "Access-Control-Allow-Origin: count 1",
                "Preflight request details recorded",
                "Random Oracle server line 200 507088 565",
                "Access to fetch was blocked by CORS policy",
            ]
        )
        with tempfile.TemporaryDirectory() as directory:
            path = self.write_file(directory, "browser.log", content)
            report = load_and_analyze(path, 20)

        self.assertEqual(report["summary"]["explicitCorsFailures"], 1)
        self.assertEqual(report["summary"]["explicitHttpErrors"], 0)
        self.assertGreaterEqual(
            report["parserHealth"]["parseStatusCounts"]["fallback"], 4
        )

    def test_explicit_http_status_forms_are_detected(self) -> None:
        content = "\n".join(
            [
                "2026-07-30T10:00:00Z upstream HTTP/1.1 503",
                "2026-07-30T10:00:01Z status: 401",
                "2026-07-30T10:00:02Z INFO completed 200 in 500ms",
            ]
        )
        with tempfile.TemporaryDirectory() as directory:
            path = self.write_file(directory, "server.log", content)
            report = load_and_analyze(path, 20)

        self.assertEqual(report["summary"]["explicitHttpErrors"], 2)

    def test_unknown_line_is_preserved_as_low_confidence_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = self.write_file(directory, "unknown.log", "unrecognized server payload")
            report = load_and_analyze(path, 20)

        fallback = next(
            item for item in report["findings"] if item["id"] == "fallback-evidence"
        )
        self.assertEqual(fallback["confidence"], "low")
        self.assertEqual(fallback["evidence"][0]["parseStatus"], "fallback")
        self.assertEqual(fallback["evidence"][0]["level"], "unknown")

    def test_url_sanitization_removes_query_and_fragment(self) -> None:
        self.assertEqual(
            sanitize_url("https://example.test/path?token=secret#section"),
            "https://example.test/path",
        )

    def test_har_summary_includes_journey_domain_and_timing_analysis(self) -> None:
        har = {
            "log": {"entries": [
                {
                    "time": "1250", "_resourceType": "document",
                    "request": {"method": "GET", "url": "https://app.example.test/"},
                    "response": {"status": "302", "redirectURL": "https://login.example.test/authorize?client=secret", "headers": [], "content": {}},
                    "timings": {"wait": 900, "dns": 20},
                },
                {
                    "time": 20, "_resourceType": "xhr",
                    "request": {"method": "GET", "url": "https://app.example.test/api/me?token=secret"},
                    "response": {"status": 503, "headers": [], "content": {}},
                    "timings": {"wait": 10},
                },
                {
                    "time": 25, "_resourceType": "xhr",
                    "request": {"method": "GET", "url": "https://app.example.test/api/me?token=other"},
                    "response": {"status": 503, "headers": [], "content": {}},
                    "timings": {"wait": 12},
                },
            ]}
        }
        with tempfile.TemporaryDirectory() as directory:
            path = self.write_file(directory, "journey.har", json.dumps(har))
            report = load_and_analyze(path, 20)

        finding_ids = {item["id"] for item in report["findings"]}
        self.assertIn("repeated-failing-requests", finding_ids)
        self.assertEqual(report["performance"]["timingPhaseTotalsMs"]["wait"], 922.0)
        self.assertEqual(report["domainAnalysis"][0]["host"], "app.example.test")
        self.assertIn("document", {item["phase"] for item in report["requestJourney"]})
        self.assertNotIn("secret", json.dumps(report))

    def test_malformed_har_values_and_gzip_input_do_not_abort(self) -> None:
        har = {
            "log": {"entries": [{
                "time": "not-a-number",
                "request": {"method": "GET", "url": "https://user:password@example.test/a?key=value"},
                "response": {"status": "invalid", "headers": [], "content": {"size": "bad"}},
            }]}
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "evidence.har.gz"
            with gzip.open(path, "wt", encoding="utf-8") as gzip_file:
                json.dump(har, gzip_file)
            report = load_and_analyze(path, 20)

        self.assertEqual(report["summary"]["totalEntries"], 1)
        self.assertNotIn("password", json.dumps(report))
        self.assertNotIn("key=value", json.dumps(report))

    def test_malformed_console_url_does_not_recurse(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = self.write_file(
                directory,
                "malformed.log",
                "ERROR request failed at https://[bad-host]/orders?token=secret",
            )
            report = load_and_analyze(path, 20)

        self.assertEqual(report["source"]["type"], "console")
        self.assertNotIn("token=secret", json.dumps(report))

    def test_utf8_bom_har_is_still_detected_as_har(self) -> None:
        har = {"log": {"entries": []}}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bom.har"
            path.write_text(json.dumps(har), encoding="utf-8-sig")
            report = load_and_analyze(path, 20)

        self.assertEqual(report["source"]["type"], "har")

    def test_unquoted_sanitized_timing_placeholder_is_repaired_in_memory(self) -> None:
        raw = (
            '{"log":{"entries":[{"time": [REDACTED], '
            '"timings":{"wait": [MASKED]}, '
            '"request":{"method":"GET","url":"https://example.test/a"}, '
            '"response":{"status":200,"headers":[],"content":{}}}]}}'
        )
        with tempfile.TemporaryDirectory() as directory:
            path = self.write_file(directory, "sanitized.har", raw)
            report = load_and_analyze(path, 20)

        self.assertEqual(report["source"]["type"], "har")
        self.assertEqual(
            report["parserHealth"]["parseWarningCounts"]["sanitizedNumericPlaceholderRepaired"],
            2,
        )
        self.assertIn("source file was not changed", " ".join(report["limitations"]))

    def test_unrepairable_har_json_reports_location_without_console_fallback(self) -> None:
        raw = '{"log":{"entries":[{"time": [UNRELATED]'
        with tempfile.TemporaryDirectory() as directory:
            path = self.write_file(directory, "broken.har", raw)
            report = load_and_analyze(path, 20)

        self.assertEqual(report["source"]["type"], "har")
        self.assertEqual(report["parserHealth"]["parseWarningCounts"]["invalidHarJson"], 1)
        self.assertIn("line 1, column", " ".join(report["limitations"]))


if __name__ == "__main__":
    unittest.main()
