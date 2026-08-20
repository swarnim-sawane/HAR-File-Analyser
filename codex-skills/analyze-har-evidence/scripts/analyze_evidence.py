#!/usr/bin/env python3
"""Local, conservative HAR and console-log evidence analyzer."""

from __future__ import annotations

import argparse
import gzip
import json
import math
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlsplit, urlunsplit

from repair_sanitized_har import repair_sanitized_har_json


SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
STATIC_TYPES = {
    "script",
    "stylesheet",
    "image",
    "font",
    "media",
}
TEXT_MIME_MARKERS = (
    "text/",
    "javascript",
    "json",
    "xml",
    "svg",
)
TIMESTAMP_RE = re.compile(
    r"(?P<timestamp>"
    r"\d{4}-\d{2}-\d{2}[T ][0-2]\d:[0-5]\d:[0-5]\d(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?"
    r"|\d{2}:\d{2}:\d{2}(?:[.,]\d+)?"
    r")"
)
LEVEL_RE = re.compile(
    r"(?<![A-Za-z])(?P<level>fatal|severe|error|warn(?:ing)?|info|debug|trace)(?![A-Za-z])",
    re.IGNORECASE,
)
CORS_FAILURE_RE = re.compile(
    r"(blocked\s+by\s+(?:the\s+)?cors(?:\s+policy)?"
    r"|cors\s+(?:policy\s+)?error"
    r"|no\s+[\"']?access-control-allow-origin[\"']?\s+header"
    r"|cross-origin\s+request\s+blocked"
    r"|preflight(?:\s+request)?[^\n]{0,120}\b(?:failed|blocked|denied)\b)",
    re.IGNORECASE,
)
HTTP_STATUS_RE = re.compile(
    r"\bHTTP/\d(?:\.\d)?\s+(?P<protocol_status>[1-5]\d{2})\b"
    r"|\bstatus(?:\s+code)?\s*[:=]\s*(?P<label_status>[1-5]\d{2})\b",
    re.IGNORECASE,
)
EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
SECRET_RE = re.compile(
    r"(?P<label>authorization|bearer|api[-_ ]?key|token|password|secret)"
    r"(?P<separator>\s*[:=]\s*|\s+)"
    r"(?P<value>[^\s,;]+)",
    re.IGNORECASE,
)
URL_IN_TEXT_RE = re.compile(r"https?://[^\s\"'<>]+", re.IGNORECASE)


def number(value: Any, default: float = 0.0) -> float:
    """Return a finite number without letting malformed evidence abort analysis."""
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    return parsed if math.isfinite(parsed) else default


def whole_number(value: Any, default: int = 0) -> int:
    return int(number(value, float(default)))


def sanitize_text(value: Any, limit: int = 240) -> str:
    text = str(value or "").replace("\r", " ").replace("\n", " ")
    text = EMAIL_RE.sub("[REDACTED_EMAIL]", text)
    text = URL_IN_TEXT_RE.sub(lambda match: sanitize_url(match.group(0)), text)
    text = SECRET_RE.sub(
        lambda match: f"{match.group('label')}{match.group('separator')}[REDACTED]",
        text,
    )
    return text[:limit] + ("..." if len(text) > limit else "")


def sanitize_url(value: Any) -> str:
    raw = str(value or "")
    try:
        parsed = urlsplit(raw)
    except ValueError:
        # Do not call sanitize_text here: it also sanitizes URLs and would recurse
        # when a malformed URL is embedded in console evidence.
        fallback = raw.split("?", 1)[0].split("#", 1)[0]
        fallback = EMAIL_RE.sub("[REDACTED_EMAIL]", fallback)
        fallback = SECRET_RE.sub(
            lambda match: f"{match.group('label')}{match.group('separator')}[REDACTED]",
            fallback,
        )
        return fallback[:240] + ("..." if len(fallback) > 240 else "")
    if not parsed.scheme and not parsed.netloc:
        return sanitize_text(raw.split("?", 1)[0].split("#", 1)[0])
    # `netloc` can include user:password@host. Rebuild authority without user-info.
    hostname = parsed.hostname or ""
    try:
        port = parsed.port
    except ValueError:
        port = None
    authority = hostname
    if ":" in authority and not authority.startswith("["):
        authority = f"[{authority}]"
    if port is not None:
        authority = f"{authority}:{port}"
    return urlunsplit((parsed.scheme, authority, parsed.path, "", ""))


def header_map(headers: Any) -> dict[str, str]:
    result: dict[str, str] = {}
    if not isinstance(headers, list):
        return result
    for header in headers:
        if not isinstance(header, dict):
            continue
        name = str(header.get("name", "")).strip().lower()
        if name:
            result[name] = str(header.get("value", ""))
    return result


def percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, math.ceil(len(ordered) * fraction) - 1))
    return ordered[index]


def evidence_for_har(index: int, entry: dict[str, Any]) -> dict[str, Any]:
    request = entry.get("request") if isinstance(entry.get("request"), dict) else {}
    response = entry.get("response") if isinstance(entry.get("response"), dict) else {}
    return {
        "entryIndex": index,
        "timestamp": sanitize_text(entry.get("startedDateTime", "")),
        "method": sanitize_text(request.get("method", "")),
        "url": sanitize_url(request.get("url", "")),
        "status": whole_number(response.get("status")),
        "durationMs": round(number(entry.get("time")), 2),
    }


def finding(
    finding_id: str,
    title: str,
    severity: str,
    confidence: str,
    count: int,
    summary: str,
    evidence: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "id": finding_id,
        "title": title,
        "severity": severity,
        "confidence": confidence,
        "count": count,
        "summary": summary,
        "evidence": evidence,
    }


def header_value(headers: Any, name: str) -> str:
    return header_map(headers).get(name.lower(), "")


def redirect_target(entry: dict[str, Any]) -> str:
    request = entry.get("request") if isinstance(entry.get("request"), dict) else {}
    response = entry.get("response") if isinstance(entry.get("response"), dict) else {}
    raw = str(response.get("redirectURL") or header_value(response.get("headers"), "location"))
    if not raw:
        return ""
    try:
        return sanitize_url(urljoin(str(request.get("url") or ""), raw))
    except (TypeError, ValueError):
        return sanitize_url(raw)


def har_phase(entry: dict[str, Any]) -> str:
    request = entry.get("request") if isinstance(entry.get("request"), dict) else {}
    response = entry.get("response") if isinstance(entry.get("response"), dict) else {}
    url = str(request.get("url") or "").lower()
    resource_type = str(entry.get("_resourceType") or "").lower()
    status = whole_number(response.get("status"))
    if status == 101 or resource_type == "websocket" or re.search(r"/(?:events?|socket|stream|sse)(?:/|$|\?)", url):
        return "persistent"
    if re.search(r"(?:logout|signout|oauth2/logout|cloudgate/logout)", url):
        return "logout"
    if re.search(r"(?:oauth2/callback|/callback(?:/|$|\?))", url):
        return "callback"
    if re.search(r"(?:identity\.oraclecloud\.com|login\.oci\.oraclecloud\.com|/oauth2/|/authorize(?:/|$|\?)|/signin|/sso/)", url):
        return "authentication"
    if resource_type in STATIC_TYPES or re.search(r"\.(?:js|css|woff2?|png|jpe?g|gif|svg|ico)(?:$|\?)", url):
        return "static"
    if resource_type == "document":
        return "document"
    return "application"


def build_domain_analysis(entries: list[dict[str, Any]], top: int) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for entry in entries:
        request = entry.get("request") if isinstance(entry.get("request"), dict) else {}
        try:
            host = urlsplit(str(request.get("url") or "")).hostname or "unknown"
        except ValueError:
            host = "unknown"
        grouped[host.lower()].append(entry)
    result = []
    for host, items in grouped.items():
        durations = [number(item.get("time")) for item in items]
        failures = sum(whole_number((item.get("response") or {}).get("status")) >= 400 for item in items)
        result.append({
            "host": host,
            "requestCount": len(items),
            "failureCount": failures,
            "totalDurationMs": round(sum(durations), 2),
            "averageDurationMs": round(sum(durations) / len(durations), 2) if durations else 0,
            "p95DurationMs": round(percentile(durations, 0.95), 2),
            "evidence": [evidence_for_har(index, entry) for index, entry in enumerate(entries) if entry in items][:top],
        })
    return sorted(result, key=lambda item: (-item["totalDurationMs"], -item["failureCount"], item["host"]))[:top]


def build_request_journey(entries: list[dict[str, Any]], top: int) -> list[dict[str, Any]]:
    phases: dict[str, list[tuple[int, dict[str, Any]]]] = defaultdict(list)
    for index, entry in enumerate(entries):
        phases[har_phase(entry)].append((index, entry))
    journey = []
    for phase, items in phases.items():
        statuses = [whole_number((entry.get("response") or {}).get("status")) for _, entry in items]
        journey.append({
            "phase": phase,
            "requestCount": len(items),
            "failureCount": sum(status >= 400 for status in statuses),
            "statusZeroCount": sum(status == 0 for status in statuses),
            "redirectCount": sum(
                300 <= whole_number((entry.get("response") or {}).get("status")) < 400
                or bool(redirect_target(entry))
                for _, entry in items
            ),
            "evidence": [evidence_for_har(index, entry) for index, entry in items[:top]],
        })
    order = {"document": 0, "authentication": 1, "callback": 2, "application": 3, "static": 4, "persistent": 5, "logout": 6}
    return sorted(journey, key=lambda item: order.get(item["phase"], 99))


def analyze_har(data: dict[str, Any], source: Path, top: int) -> dict[str, Any]:
    log = data.get("log") if isinstance(data.get("log"), dict) else {}
    raw_entries = log.get("entries") if isinstance(log.get("entries"), list) else []
    entries = [entry for entry in raw_entries if isinstance(entry, dict)]
    statuses: Counter[int] = Counter()
    methods: Counter[str] = Counter()
    domains: Counter[str] = Counter()
    durations: list[float] = []
    buckets: dict[str, list[tuple[int, dict[str, Any]]]] = defaultdict(list)

    for index, entry in enumerate(entries):
        request = entry.get("request") if isinstance(entry.get("request"), dict) else {}
        response = entry.get("response") if isinstance(entry.get("response"), dict) else {}
        method = str(request.get("method") or "UNKNOWN").upper()
        url = str(request.get("url") or "")
        status = whole_number(response.get("status"))
        duration = number(entry.get("time"))
        statuses[status] += 1
        methods[method] += 1
        durations.append(duration)
        try:
            hostname = urlsplit(url).hostname
        except ValueError:
            hostname = None
        if hostname:
            domains[hostname.lower()] += 1
        buckets[f"{method} {sanitize_url(url)}"].append((index, entry))

    findings: list[dict[str, Any]] = []

    def selected(predicate: Any) -> list[tuple[int, dict[str, Any]]]:
        return [(i, entry) for i, entry in enumerate(entries) if predicate(entry)]

    def add_selected(
        finding_id: str,
        title: str,
        severity: str,
        confidence: str,
        summary: str,
        matches: list[tuple[int, dict[str, Any]]],
    ) -> None:
        if matches:
            findings.append(
                finding(
                    finding_id,
                    title,
                    severity,
                    confidence,
                    len(matches),
                    summary,
                    [evidence_for_har(i, entry) for i, entry in matches[:top]],
                )
            )

    add_selected(
        "http-5xx",
        "Server error responses",
        "high",
        "high",
        "Observed HTTP 5xx responses indicate server-side request failures.",
        selected(
            lambda entry: whole_number(
                (entry.get("response") or {}).get("status") or 0
            )
            >= 500
        ),
    )
    add_selected(
        "authentication-failures",
        "Authentication or authorization responses",
        "high",
        "high",
        "Observed HTTP 401 or 403 responses require authentication-flow review.",
        selected(
            lambda entry: whole_number(
                (entry.get("response") or {}).get("status") or 0
            )
            in {401, 403}
        ),
    )
    add_selected(
        "other-4xx",
        "Other client error responses",
        "medium",
        "high",
        "Observed HTTP 4xx responses may indicate invalid requests or missing resources.",
        selected(
            lambda entry: 400
            <= whole_number((entry.get("response") or {}).get("status"))
            < 500
            and whole_number((entry.get("response") or {}).get("status"))
            not in {401, 403}
        ),
    )
    add_selected(
        "status-zero",
        "Requests without a normal HTTP response",
        "high",
        "medium",
        "Status 0 is a network-failure candidate; it is not proof of CORS by itself.",
        selected(
            lambda entry: whole_number(
                (entry.get("response") or {}).get("status") or 0
            )
            == 0
        ),
    )
    add_selected(
        "redirects",
        "Redirect responses",
        "info",
        "high",
        "Redirect responses are flow evidence and are not a redirect loop by themselves.",
        selected(
            lambda entry: 300
            <= whole_number((entry.get("response") or {}).get("status"))
            < 400
        ),
    )
    add_selected(
        "explicit-cors-evidence",
        "Explicit CORS evidence in HAR",
        "high",
        "high",
        "A status-zero record explicitly mentions CORS in its status text or comment.",
        selected(
            lambda entry: whole_number((entry.get("response") or {}).get("status")) == 0
            and "cors" in " ".join(
                str(value or "")
                for value in (
                    (entry.get("response") or {}).get("statusText"),
                    (entry.get("response") or {}).get("comment"),
                    entry.get("comment"),
                )
            ).lower()
        ),
    )
    add_selected(
        "slow-requests",
        "Slow requests",
        "medium",
        "high",
        "Requests at or above 1000 ms can materially affect the user journey.",
        selected(lambda entry: number(entry.get("time")) >= 1000),
    )
    add_selected(
        "insecure-http",
        "Insecure HTTP requests",
        "medium",
        "high",
        "Observed plaintext HTTP requests should be reviewed for HTTPS migration.",
        selected(
            lambda entry: str(
                (entry.get("request") or {}).get("url") or ""
            ).lower().startswith("http://")
        ),
    )

    large_uncompressed: list[tuple[int, dict[str, Any]]] = []
    missing_cache: list[tuple[int, dict[str, Any]]] = []
    for index, entry in enumerate(entries):
        request = entry.get("request") if isinstance(entry.get("request"), dict) else {}
        response = entry.get("response") if isinstance(entry.get("response"), dict) else {}
        content = response.get("content") if isinstance(response.get("content"), dict) else {}
        response_headers = header_map(response.get("headers"))
        mime_type = str(content.get("mimeType") or response_headers.get("content-type") or "").lower()
        body_size = max(
            whole_number(response.get("bodySize")),
            whole_number(content.get("size")),
        )
        if (
            body_size >= 100 * 1024
            and any(marker in mime_type for marker in TEXT_MIME_MARKERS)
            and "content-encoding" not in response_headers
        ):
            large_uncompressed.append((index, entry))
        resource_type = str(entry.get("_resourceType") or "").lower()
        path = sanitize_url(request.get("url", "")).lower()
        likely_static = resource_type in STATIC_TYPES or re.search(
            r"\.(?:js|css|png|jpe?g|gif|svg|ico|woff2?|ttf|map)$", path
        )
        if likely_static and not (
            "cache-control" in response_headers or "expires" in response_headers
        ):
            missing_cache.append((index, entry))

    add_selected(
        "large-uncompressed-text",
        "Large uncompressed text assets",
        "medium",
        "high",
        "Large text transfers without a recorded Content-Encoding may waste bandwidth.",
        large_uncompressed,
    )
    add_selected(
        "missing-static-cache",
        "Static resources missing cache headers",
        "low",
        "medium",
        "Reusable static resources without Cache-Control or Expires may be downloaded repeatedly.",
        missing_cache,
    )

    repeated = [(signature, values) for signature, values in buckets.items() if len(values) > 1]
    if repeated:
        repeated_evidence: list[dict[str, Any]] = []
        repeated_count = 0
        for signature, values in sorted(repeated, key=lambda item: len(item[1]), reverse=True):
            repeated_count += len(values)
            first_index, first_entry = values[0]
            sample = evidence_for_har(first_index, first_entry)
            sample["signature"] = signature
            sample["occurrences"] = len(values)
            repeated_evidence.append(sample)
        findings.append(
            finding(
                "repeated-requests",
                "Repeated request signatures",
                "low",
                "high",
                repeated_count,
                "Repeated method and sanitized URL signatures are correlation evidence, not automatically defects.",
                repeated_evidence[:top],
            )
        )

    repeated_failures = [
        (signature, values)
        for signature, values in buckets.items()
        if len(values) >= 2
        and all(whole_number((entry.get("response") or {}).get("status")) >= 400 for _, entry in values)
    ]
    if repeated_failures:
        samples: list[dict[str, Any]] = []
        count = 0
        for signature, values in sorted(repeated_failures, key=lambda item: len(item[1]), reverse=True):
            count += len(values)
            index, entry = values[0]
            sample = evidence_for_har(index, entry)
            sample["signature"] = signature
            sample["occurrences"] = len(values)
            samples.append(sample)
        findings.append(
            finding(
                "repeated-failing-requests",
                "Repeated failing request signatures",
                "high",
                "high",
                count,
                "The same sanitized method and URL failed repeatedly; validate retry behavior and the underlying response.",
                samples[:top],
            )
        )

    redirect_sources: dict[str, list[tuple[int, dict[str, Any]]]] = defaultdict(list)
    for index, entry in enumerate(entries):
        target = redirect_target(entry)
        if target:
            redirect_sources[target].append((index, entry))
    redirect_cycles = [
        (target, values)
        for target, values in redirect_sources.items()
        if any(sanitize_url((entry.get("request") or {}).get("url", "")) == target for _, entry in values)
    ]
    if redirect_cycles:
        samples = []
        for target, values in redirect_cycles:
            index, entry = values[0]
            sample = evidence_for_har(index, entry)
            sample["redirectTarget"] = target
            samples.append(sample)
        findings.append(
            finding(
                "redirect-cycle-candidate",
                "Redirect cycle candidate",
                "medium",
                "medium",
                len(redirect_cycles),
                "A redirect target matches the redirecting request URL. Validate the surrounding navigation before calling it a loop.",
                samples[:top],
            )
        )

    findings.sort(key=lambda item: (SEVERITY_ORDER[item["severity"]], -item["count"]))
    total_duration = sum(durations)
    return {
        "schemaVersion": 1,
        "source": {"file": source.name, "type": "har"},
        "summary": {
            "totalEntries": len(entries),
            "statusCounts": {str(key): value for key, value in sorted(statuses.items())},
            "methodCounts": dict(methods.most_common()),
            "domainCounts": dict(domains.most_common(top)),
            "averageDurationMs": round(total_duration / len(durations), 2)
            if durations
            else 0,
            "p95DurationMs": round(percentile(durations, 0.95), 2),
            "maximumDurationMs": round(max(durations), 2) if durations else 0,
        },
        "findings": findings,
        "performance": {
            "topSlowRequests": [
                evidence_for_har(index, entry)
                for index, entry in sorted(enumerate(entries), key=lambda item: number(item[1].get("time")), reverse=True)[:top]
            ],
            "timingPhaseTotalsMs": {
                phase: round(sum(number((entry.get("timings") or {}).get(phase)) for entry in entries), 2)
                for phase in ("blocked", "dns", "connect", "ssl", "send", "wait", "receive")
            },
        },
        "domainAnalysis": build_domain_analysis(entries, top),
        "requestJourney": build_request_journey(entries, top),
        "parserHealth": {
            "parseStatusCounts": {"parsed": len(entries), "partial": 0, "fallback": 0},
            "parseFormatCounts": {"har": len(entries)},
            "parseWarningCounts": {},
        },
        "limitations": [
            "Status 0 is not proof of CORS.",
            "Request and response bodies, cookies, authorization values, and query values are not emitted.",
            "Causality requires correlation with browser, server, proxy, or network evidence.",
        ],
    }


def normalize_level(level: str | None) -> str:
    value = (level or "").lower()
    if value in {"fatal", "severe", "error"}:
        return "error"
    if value in {"warn", "warning"}:
        return "warn"
    return value or "unknown"


def analyze_console(text: str, source: Path, top: int) -> dict[str, Any]:
    entries: list[dict[str, Any]] = []
    status_counts: Counter[str] = Counter()
    level_counts: Counter[str] = Counter()
    warning_counts: Counter[str] = Counter()
    cors_entries: list[dict[str, Any]] = []
    http_error_entries: list[dict[str, Any]] = []

    for line_number, raw_line in enumerate(text.splitlines(), 1):
        if not raw_line.strip():
            continue
        timestamp_match = TIMESTAMP_RE.search(raw_line)
        level_match = LEVEL_RE.search(raw_line)
        cors_match = CORS_FAILURE_RE.search(raw_line)
        status_match = HTTP_STATUS_RE.search(raw_line)
        status_value = None
        if status_match:
            status_value = whole_number(
                status_match.group("protocol_status") or status_match.group("label_status")
            )

        explicit_signals = sum(
            bool(value)
            for value in (timestamp_match, level_match, cors_match, status_match)
        )
        if timestamp_match and level_match:
            parse_status = "parsed"
            confidence = "high"
            parse_format = "generic-level"
        elif explicit_signals:
            parse_status = "partial"
            confidence = "medium"
            parse_format = "browser-console" if cors_match else "generic-level"
        else:
            parse_status = "fallback"
            confidence = "low"
            parse_format = "fallback"

        warnings: list[str] = []
        if not timestamp_match:
            warnings.append("timestamp-not-detected")
        if not level_match and not cors_match and not (
            status_value is not None and status_value >= 400
        ):
            warnings.append("severity-not-detected")
        if parse_status == "fallback":
            warnings.append("unsupported-line-format")
        for warning in warnings:
            warning_counts[warning] += 1

        entry = {
            "lineNumber": line_number,
            "timestamp": timestamp_match.group("timestamp") if timestamp_match else None,
            "level": normalize_level(level_match.group("level") if level_match else None),
            "httpStatus": status_value,
            "parseStatus": parse_status,
            "parseFormat": parse_format,
            "parseConfidence": confidence,
            "parseWarnings": warnings,
            "message": sanitize_text(raw_line),
        }
        entries.append(entry)
        status_counts[parse_status] += 1
        level_counts[entry["level"]] += 1
        if cors_match:
            cors_entries.append(entry)
        if status_value is not None and status_value >= 400:
            http_error_entries.append(entry)

    findings: list[dict[str, Any]] = []
    if cors_entries:
        findings.append(
            finding(
                "explicit-cors-failures",
                "Explicit CORS failure messages",
                "high",
                "high",
                len(cors_entries),
                "Browser text explicitly reports a CORS or cross-origin failure.",
                cors_entries[:top],
            )
        )
    if http_error_entries:
        findings.append(
            finding(
                "explicit-http-errors",
                "Explicit HTTP error statuses",
                "high",
                "high",
                len(http_error_entries),
                "Console text contains explicit HTTP protocol or status-label errors.",
                http_error_entries[:top],
            )
        )
    explicit_error_entries = [
        entry
        for entry in entries
        if entry["level"] == "error"
        and entry not in cors_entries
        and entry not in http_error_entries
    ]
    if explicit_error_entries:
        findings.append(
            finding(
                "explicit-error-level",
                "Explicit error-level log entries",
                "high",
                "high",
                len(explicit_error_entries),
                "The source explicitly labels these entries as errors.",
                explicit_error_entries[:top],
            )
        )
    fallback_entries = [entry for entry in entries if entry["parseStatus"] == "fallback"]
    if fallback_entries:
        findings.append(
            finding(
                "fallback-evidence",
                "Unsupported console-line formats",
                "info",
                "low",
                len(fallback_entries),
                "Unknown lines were preserved without severity promotion.",
                fallback_entries[:top],
            )
        )

    findings.sort(key=lambda item: (SEVERITY_ORDER[item["severity"]], -item["count"]))
    return {
        "schemaVersion": 1,
        "source": {"file": source.name, "type": "console"},
        "summary": {
            "totalEntries": len(entries),
            "levelCounts": dict(level_counts.most_common()),
            "explicitCorsFailures": len(cors_entries),
            "explicitHttpErrors": len(http_error_entries),
        },
        "findings": findings,
        "parserHealth": {
            "parseStatusCounts": {
                "parsed": status_counts["parsed"],
                "partial": status_counts["partial"],
                "fallback": status_counts["fallback"],
            },
            "parseFormatCounts": dict(
                Counter(entry["parseFormat"] for entry in entries).most_common()
            ),
            "parseWarningCounts": dict(warning_counts.most_common()),
        },
        "limitations": [
            "Regex parsing covers known formats but does not guarantee universal classification.",
            "Unknown lines are preserved as low-confidence fallback evidence.",
            "Neutral preflight and access-control text is not classified as CORS failure.",
            "Sensitive-looking values are redacted from emitted message samples.",
        ],
    }


def load_and_analyze(path: Path, top: int) -> dict[str, Any]:
    if path.suffix.lower() == ".gz":
        with gzip.open(path, "rt", encoding="utf-8-sig", errors="replace") as source_file:
            raw = source_file.read()
    else:
        raw = path.read_text(encoding="utf-8-sig", errors="replace")
    initial_json_error: json.JSONDecodeError | None = None
    try:
        json.loads(raw)
    except json.JSONDecodeError as exc:
        initial_json_error = exc
    data, repaired_numeric_placeholders = repair_sanitized_har_json(raw)
    if (
        isinstance(data, dict)
        and isinstance(data.get("log"), dict)
        and isinstance(data["log"].get("entries"), list)
    ):
        report = analyze_har(data, path, top)
        if repaired_numeric_placeholders:
            report["parserHealth"]["parseWarningCounts"] = {
                "sanitizedNumericPlaceholderRepaired": repaired_numeric_placeholders
            }
            report["limitations"].append(
                "Sanitization left numeric HAR placeholders unquoted; "
                f"{repaired_numeric_placeholders} timing or size value(s) were normalized to 0 in memory. The source file was not changed."
            )
        return report
    if initial_json_error and '"log"' in raw and '"entries"' in raw:
        return {
            "schemaVersion": 1,
            "source": {"file": path.name, "type": "har"},
            "summary": {"totalEntries": 0, "statusCounts": {}},
            "findings": [],
            "parserHealth": {
                "parseStatusCounts": {"parsed": 0, "partial": 0, "fallback": 0},
                "parseFormatCounts": {"har": 0},
                "parseWarningCounts": {"invalidHarJson": 1},
            },
            "limitations": [
                "HAR JSON could not be parsed safely at "
                f"line {initial_json_error.lineno}, column {initial_json_error.colno}. ",
                "No safe bounded repair was available; the source file was not changed.",
            ],
        }
    return analyze_console(raw, path, top)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Analyze HAR or console evidence locally and conservatively."
    )
    parser.add_argument("input", type=Path, help="HAR or console-log file")
    parser.add_argument("--output", type=Path, help="write JSON report to this path")
    parser.add_argument(
        "--top",
        type=int,
        default=20,
        help="maximum evidence samples per finding (default: 20)",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    if not args.input.is_file():
        print(f"Input file not found: {args.input}", file=sys.stderr)
        return 2
    if args.top < 1:
        print("--top must be at least 1", file=sys.stderr)
        return 2
    report = load_and_analyze(args.input, args.top)
    rendered = json.dumps(report, indent=2, ensure_ascii=True)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    else:
        print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
