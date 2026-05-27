# Support Analyzer MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first usable MCP server so LLM clients can upload support evidence, run deterministic analyzer lookups, ask AI Diagnosis, and open the exact visual workspace.

**Architecture:** Implement a stdio MCP facade in the HAR backend package. The MCP layer keeps a small workspace registry, calls existing HAR/log APIs for deterministic analysis, calls Support Workbench APIs for attachments and AI Diagnosis, and returns structured evidence plus workbench deep links.

**Tech Stack:** TypeScript, Node stdio, JSON-RPC 2.0 MCP messages, existing HAR backend APIs, existing Support Workbench APIs, Vitest.

---

### Task 1: MCP Core And Tool Catalog

**Files:**
- Create: `backend/src/mcp/types.ts`
- Create: `backend/src/mcp/fileClassifier.ts`
- Create: `backend/src/mcp/toolCatalog.ts`
- Test: `backend/src/mcp/supportAnalyzerMcp.test.ts`

- [ ] Write failing tests for broad file classification and tool catalog names.
- [ ] Implement the minimal classifier and catalog.
- [ ] Run `npm run test -- src/mcp/supportAnalyzerMcp.test.ts` from `backend`.

### Task 2: Support Analyzer API Client

**Files:**
- Create: `backend/src/mcp/supportAnalyzerClient.ts`
- Test: `backend/src/mcp/supportAnalyzerMcp.test.ts`

- [ ] Write failing tests for workspace creation, deep link generation, HAR/log upload routing, search routing, inspect routing, and AI Diagnosis prompt polling.
- [ ] Implement API client methods using injected `fetch` for testability.
- [ ] Run the MCP test file.

### Task 3: Stdio MCP Server

**Files:**
- Create: `backend/src/mcp/stdioServer.ts`
- Create: `backend/src/mcp/server.ts`
- Modify: `backend/package.json`
- Test: `backend/src/mcp/supportAnalyzerMcp.test.ts`

- [ ] Write failing tests for JSON-RPC `initialize`, `tools/list`, and `tools/call`.
- [ ] Implement newline-delimited JSON-RPC stdio handling.
- [ ] Add `mcp` and `start:mcp` scripts.
- [ ] Run MCP tests, backend typecheck, and backend build.

### Task 4: Documentation And VCAP Notes

**Files:**
- Modify: `VM_RUNBOOK.md`
- Modify: `src/content/documentation.ts`

- [ ] Document what the MCP server offers and how to run it locally/VCAP.
- [ ] Document that VCAP remains artifact-only and MCP dependencies/artifacts must be copied from local builds.
- [ ] Run focused docs/UI tests impacted by documentation.
