---
name: analyze-har-evidence
description: Analyze HAR files and browser or server console logs locally with the HAR Analyzer's evidence-first workflow. Use when troubleshooting failed requests, latency, redirect or authentication journeys, CORS or status-zero failures, retries, domains, cache or compression issues, browser exceptions, and when producing a privacy-safe support diagnosis from HAR or console evidence.
---

# Analyze HAR Evidence

Use the bundled analyzer first, then interpret its output. Keep deterministic
evidence separate from hypotheses.

## Workflow

1. Work on a copy only when an output artifact is needed. Never alter the source evidence.
2. Identify the input as a HAR (`.har`, `.json`, or `.har.gz`) or a browser/server console log.
3. Run the deterministic analyzer from this skill directory:

   ```powershell
   python scripts/analyze_evidence.py "<input-file>" --output "<report.json>"
   ```

   If `python` is unavailable, use the workspace's bundled Python runtime when
   Codex exposes one, or ask the user to provide a working Python executable.
   Do not silently replace deterministic analysis with an unsupported manual
   parser.

   For a HAR-shaped file that fails JSON parsing after sanitization, the
   analyzer automatically uses `scripts/repair_sanitized_har.py`. It performs
   one bounded in-memory repair: only unquoted placeholders in known numeric
   HAR timing or size fields become `0`. Never rewrite the source file, never
   attempt an open-ended model reconstruction, and do not delay the analysis
   to ask about this safe repair. Report the repair count from `parserHealth`.
   If that bounded repair cannot parse the HAR, report the JSON parse location
   and ask for a valid exported HAR or an explicitly user-approved repaired copy.

4. Review `summary`, `findings`, `requestJourney`, `domainAnalysis`,
   `performance`, `parserHealth`, and `limitations`. Treat the JSON as the
   source of deterministic facts.
5. Correlate only related evidence by timestamp, sanitized URL, domain, status,
   redirect target, and repeated signature. If HAR and console inputs are both
   supplied, run the analyzer once for each and join only observations that
   share a timestamp, host, route, or explicit error text.
6. Read `references/analyzer-contract.md` before making CORS, authentication,
   causality, or severity claims.
7. Produce the final response using `references/report-template.md`.

## Presentation Contract

Return the visual support report in `references/report-template.md` unless the
user explicitly asks for raw JSON, a terse answer, or a machine-readable
artifact. Keep it fast and information-dense:

- Lead with a compact status strip and use `Ã°Å¸â€Â´`, `Ã°Å¸Å¸Â `, `Ã°Å¸Å¸Â¡`, `Ã°Å¸Å¸Â¢`, and `Ã¢Å¡Âª` as
  consistent severity markers. Do not use HTML, custom CSS, or color names.
- Use one compact finding table with at most eight rows. Put the evidence
  reference in the same row as the claim.
- Highlight only the most important values with bold text: failure count,
  endpoint/path, HTTP status, duration, and recommended next action.
- Include a small Mermaid `flowchart LR` request journey when the evidence has
  at least three meaningful states. For smaller captures, use one plain-text
  arrow line instead. Never put query values, secrets, or raw customer data in
  a flow label.
- Omit empty sections and raw event dumps. Link to the JSON output when a full
  evidence inventory is required.
- Keep the default report under 700 words and derive every visual from the
  deterministic output; do not spend time creating decorative diagrams.

## Evidence Rules

- Treat status `0` as a network-failure candidate, not proof of CORS.
- Classify CORS only when an explicit browser failure message or a HAR status
  text/comment explicitly says so. Do not infer CORS from an `OPTIONS` request.
- Do not interpret arbitrary numbers as HTTP statuses. Text such as
  `200 in 500ms` is not a 5xx failure.
- Treat redirects, repeated requests, missing cache headers, and absent
  compression as observations until the evidence supports a user-visible impact.
- Treat a 401/403 as an observed authorization response, not proof that a
  credential is invalid or that IAM configuration is wrong.
- Keep unknown console lines visible as low-confidence fallback evidence.
- Label conclusions as observed, correlated, or hypothesis.
- Cite the request index, timestamp, method, sanitized URL, status, duration, or
  console line number that supports each important finding.
- Present deterministic analyzer findings before AI-assisted interpretation.

## Privacy

- Analyze files locally. Do not upload evidence to external services.
- Do not reproduce cookies, authorization values, tokens, passwords, request or
  response bodies, or query-string values in reports.
- Do not expose URL user-info, `Set-Cookie` values, host-path data beyond what
  the supplied report needs, or raw console lines that contain secrets.
- Preserve the source file unchanged.
- Recommend sanitization before evidence is shared with another person or
  system.

## Priority Order

1. Failed requests and terminal failures.
2. Authentication, explicit CORS, and network failures.
3. Redirect loops, retries, and repeated failing endpoints.
4. Latency and blocking requests.
5. Compression, caching, insecure HTTP, and transfer-size observations.
6. Parser fallback evidence and unresolved unknowns.

Do not claim universal parser correctness. State that known formats use tested
rules while unsupported evidence is preserved with reduced confidence.

## Opt-in Improvement Feedback

After the final report, offer this short feedback block unless the user asked
for raw JSON, a terse answer, or explicitly declined follow-up:

---

## Help improve HAR Analyzer

*HAR and console contents are never recorded as feedback.*

**Does this analysis need improvement?**

**👍 No, this looks good**
**👎 Yes, I have a suggestion**
**Not now**

---

Do nothing when the user selects **No**, **Not now**, or **Skip**. Never create
positive feedback entries. If the user selects **Yes** without a detail, ask
exactly one follow-up: "What should improve: accuracy, clarity, missing
evidence, speed, or something else?" Do not record that selection by itself.

When the user provides improvement feedback, prepare the exact filing candidate
before asking for approval:

1. Create a concise area, issue summary, and non-sensitive reproduction
   context. Never include customer evidence, private URLs, tokens, cookies, or
   credentials.
2. Start a filing timer. Reuse an authenticated Confluence display name already
   resolved in the current task. Otherwise fetch the current **HAR Analyzer
   Feedback Form** (page ID `21487101808`) and resolve the reporter in one
   concurrent read batch. Use a current-user or profile tool when available;
   otherwise run the read-only CQL search
   `creator = currentUser() ORDER BY created DESC` with limit `1` and use its
   `created_user` display name. Do not store or display the returned email.
3. Do not read page comments, attachments, children, or labels; do not search
   for the page by title; do not call a classification endpoint; and do not
   probe both Confluence connectors.
4. If automatic identity lookup returns nothing, use a display name already
   supplied in the conversation. Only then ask: "What Oracle username should I
   record as the reporter?"

Do not ask for a username when `currentUser()` resolves it. Never infer the
reporter from a Windows path, machine account, HAR contents, email address, or
customer evidence.

Write the fetched page Markdown to a temporary UTF-8 file and run the bundled
row builder from this skill directory:

```powershell
python scripts/prepare_feedback.py `
  --page-markdown "<current-page.md>" `
  --reported-by "<Confluence display name>" `
  --area "<allowed area>" `
  --issue "<sanitized summary>" `
  --context "<non-sensitive input type and observed behavior>" `
  --output "<candidate.json>"
```

Use only these areas: `Analysis quality`, `Performance`, `Input handling`,
`Feedback workflow`, `Documentation`, or `Other`. The script validates the
active table contract after recognizing either ATX (`##`) or Confluence Setext
level-2 headings, calculates the next `HAR-###` identifier across active and
archived rows, writes only to the active table, removes URLs, email addresses,
credential-like values, control characters, and Markdown table delimiters, and
returns `rowMarkdown`, `updatedPageMarkdown`, and a verification record. It
never modifies the fetched page file.

Show `confirmationPreview.rowMarkdown` exactly, state **Page classification:
Oracle Restricted**, then ask exactly the script's
`confirmationPreview.prompt`: "Would you like me to file this issue for
review?" This is the only approval prompt. If the user declines, delete the
temporary files and stop.

After approval, update the page once with `updatedPageMarkdown`. Set the
connector's confirmation flag only because the exact row and classification
were already shown and approved; never ask the user to approve the same row
again. Treat the update response as server verification when it contains both
a new page version and `verification.expectedRow`. Only when either is absent,
re-fetch the page once and verify the exact row. On a version conflict, re-fetch,
regenerate, and retry once; never overwrite a newer row. This is issue filing,
not a page comment. Delete temporary files after success or failure.

Keep local preparation below one second. Target one read batch within 15
seconds and the post-approval update within 20 seconds. Do not make exploratory
calls, repeated identity lookups, unconditional verification fetches, or
additional conversational approval turns. If one connector call takes more
than 30 seconds or fails, stop equivalent retries, identify the slow stage, and
use the ready-to-paste fallback below instead of consuming two minutes.

The prepared row has this contract:

| ID | Reported (UTC) | Reported by | Area | Issue | Reproduction context | Status | Owner | Tracking link |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| HAR-### | timestamp | Confluence display name | selected feedback area | sanitized feedback summary | non-sensitive input type and observed behavior | New | - | - |

Use one approved connector already available in the session: prefer Oracle
Central Confluence, or use Oracle GIU Confluence when Central is unavailable.
Do not probe both. Do not add a comment or alter attachments, access, or any
other page content.

Treat the page classification as **Oracle Restricted** and include that fixed
value in the deterministic preview so the user's single approval covers the
connector request. Never ask the user to choose a classification or call a
classification endpoint. Omit the update field when possible; when the schema
requires it, supply `Oracle Restricted`. If classification metadata is rejected
or unavailable, retry the content update once with the field omitted or null;
null means "do not modify classification," never "clear classification." A
classification warning must not invalidate a row verified in the update
response. If the row cannot be updated without a separate classification
operation, do not claim it was filed and use the fallback below.

If neither approved connector is available, do not claim that the issue was
recorded. Offer this choice: "To record it now,
install an Oracle Central Confluence or Oracle GIU Confluence connector and
retry; or copy this ready-to-paste row into the HAR Analyzer Feedback Form."
Then provide `rowMarkdown` from the local script in a fenced Markdown block,
including **Reported by**. Resolve the reporter first using the same rules
above. Never include evidence contents or sensitive values in that fallback.
