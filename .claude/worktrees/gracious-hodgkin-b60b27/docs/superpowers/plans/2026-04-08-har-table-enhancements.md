# HAR Table Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a sortable Timestamp column, combined ↑↓ request/response size cell, and SVG analysis badges (redirect, cached, slow, large) to the HAR entries table.

**Architecture:** All changes are frontend-only — the data is already present in every loaded entry. `RequestList.tsx` gets new sort logic, a `formatTimestamp` utility, inline SVG icons via lucide-react, and a `getAnalysisBadges` helper. `globals.css` gets updated grid column definitions and new utility classes. No backend changes.

**Tech Stack:** React 18, TypeScript, lucide-react (already installed), vitest + @testing-library/react, globals.css (CSS custom properties + grid)

---

## File Map

| File | Change |
|------|--------|
| `src/components/RequestList.tsx` | Add `formatTimestamp` export, extend `SortField`, change default sort, add timestamp header+cell, update size cell, add `getAnalysisBadges`, update URL cell |
| `src/components/__tests__/RequestList.test.tsx` | New — tests for all new behaviour |
| `src/styles/globals.css` | Update grid at lines 745, 813, 1334; update responsive grids at lines 1251, 1420; append new CSS classes at bottom |

---

## Task 1: Test file scaffold + formatTimestamp tests

**Files:**
- Create: `src/components/__tests__/RequestList.test.tsx`
- Modify: `src/components/RequestList.tsx` (export `formatTimestamp` only)

- [ ] **Step 1: Create the test file with entry fixture and formatTimestamp tests**

```tsx
// src/components/__tests__/RequestList.test.tsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RequestList, { formatTimestamp } from '../RequestList';
import { Entry } from '../../types/har';

// Minimal entry factory — extend overrides per test
const makeEntry = (overrides: Partial<Entry> = {}): Entry => ({
  startedDateTime: '2026-03-18T06:17:56.461Z',
  time: 300,
  request: {
    method: 'GET',
    url: 'https://example.com/api/test',
    httpVersion: 'HTTP/1.1',
    cookies: [],
    headers: [],
    queryString: [],
    headersSize: 200,
    bodySize: 1024,
  },
  response: {
    status: 200,
    statusText: 'OK',
    httpVersion: 'HTTP/1.1',
    cookies: [],
    headers: [],
    content: { size: 2048, mimeType: 'application/json' },
    redirectURL: '',
    headersSize: 100,
    bodySize: 2048,
  },
  cache: {},
  timings: { send: 10, wait: 250, receive: 40 },
  ...overrides,
});

const noop = () => {};

describe('formatTimestamp', () => {
  it('extracts HH:MM:SS.mmm from a UTC ISO string', () => {
    expect(formatTimestamp('2026-03-18T06:17:56.461Z')).toBe('06:17:56.461');
  });

  it('extracts time from ISO string with positive offset', () => {
    expect(formatTimestamp('2026-03-18T14:30:00.123+05:30')).toBe('14:30:00.123');
  });

  it('handles ISO string without milliseconds', () => {
    expect(formatTimestamp('2026-03-18T09:00:00Z')).toBe('09:00:00');
  });

  it('returns the raw string if no T separator found', () => {
    expect(formatTimestamp('not-a-date')).toBe('not-a-date');
  });
});
```

- [ ] **Step 2: Run to confirm it fails (formatTimestamp not yet exported)**

```bash
cd "c:/Users/ssawane/Documents/Work/HAR LATEST/Deployed build/HAR-File-Analyser" && npx vitest run src/components/__tests__/RequestList.test.tsx
```

Expected: compile error — `formatTimestamp` is not exported from `RequestList`.

- [ ] **Step 3: Export formatTimestamp from RequestList.tsx**

Add this function above the `RequestList` component definition (before the `interface RequestListProps` block) and export it:

```ts
// In src/components/RequestList.tsx — add before the interface block

export const formatTimestamp = (iso: string): string => {
  const tIdx = iso.indexOf('T');
  if (tIdx === -1) return iso;
  const time = iso.slice(tIdx + 1);
  // Strip timezone suffix (Z or ±HH:MM)
  const clean = time.replace(/([Z]|[+-]\d{2}:\d{2})$/, '');
  // Return up to HH:MM:SS.mmm (12 chars)
  return clean.substring(0, 12);
};
```

- [ ] **Step 4: Run tests — formatTimestamp suite must pass**

```bash
cd "c:/Users/ssawane/Documents/Work/HAR LATEST/Deployed build/HAR-File-Analyser" && npx vitest run src/components/__tests__/RequestList.test.tsx
```

Expected: 4 passing tests in `formatTimestamp` describe block.

- [ ] **Step 5: Commit**

```bash
git add src/components/RequestList.tsx src/components/__tests__/RequestList.test.tsx
git commit -m "feat: export formatTimestamp utility for HAR timestamp column"
```

---

## Task 2: Timestamp sort field + default sort

**Files:**
- Modify: `src/components/RequestList.tsx` (SortField type, sort switch, default state)
- Modify: `src/components/__tests__/RequestList.test.tsx` (add sort tests)

- [ ] **Step 1: Add sort-by-timestamp tests to the test file**

Append inside the file (after the `formatTimestamp` describe block):

```tsx
describe('RequestList — timestamp sort', () => {
  const entries = [
    makeEntry({ startedDateTime: '2026-03-18T06:17:58.000Z', time: 100 }),
    makeEntry({ startedDateTime: '2026-03-18T06:17:56.000Z', time: 200 }),
    makeEntry({ startedDateTime: '2026-03-18T06:17:57.000Z', time: 150 }),
  ];

  it('renders entries in ascending timestamp order by default', () => {
    render(<RequestList entries={entries} selectedEntry={null} onSelectEntry={noop} timingType="relative" />);
    const timestamps = screen.getAllByTestId('request-timestamp').map(el => el.textContent);
    expect(timestamps[0]).toBe('06:17:56.000');
    expect(timestamps[1]).toBe('06:17:57.000');
    expect(timestamps[2]).toBe('06:17:58.000');
  });

  it('reverses order to descending when Timestamp header is clicked', async () => {
    const user = userEvent.setup();
    render(<RequestList entries={entries} selectedEntry={null} onSelectEntry={noop} timingType="relative" />);
    await user.click(screen.getByRole('button', { name: /timestamp/i }));
    const timestamps = screen.getAllByTestId('request-timestamp').map(el => el.textContent);
    expect(timestamps[0]).toBe('06:17:58.000');
    expect(timestamps[2]).toBe('06:17:56.000');
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
cd "c:/Users/ssawane/Documents/Work/HAR LATEST/Deployed build/HAR-File-Analyser" && npx vitest run src/components/__tests__/RequestList.test.tsx
```

Expected: FAIL — no `request-timestamp` test-id, no Timestamp header button.

- [ ] **Step 3: Extend SortField type and add sort case in RequestList.tsx**

**Replace line 14:**
```ts
// Before:
type SortField = 'status' | 'method' | 'url' | 'size' | 'time';

// After:
type SortField = 'status' | 'method' | 'url' | 'size' | 'time' | 'timestamp';
```

**Replace line 23 (default sort state):**
```ts
// Before:
const [sortField, setSortField] = useState<SortField>('time');

// After:
const [sortField, setSortField] = useState<SortField>('timestamp');
```

**Add timestamp case in the sort switch (after the `case 'time':` block, before the closing `}`):**
```ts
case 'timestamp':
  comparison = new Date(a.startedDateTime).getTime() - new Date(b.startedDateTime).getTime();
  break;
```

- [ ] **Step 4: Add the Timestamp header button and row cell**

**In the JSX return block, add as the first child of `.request-list-header` div (before the Status button):**
```tsx
<button
  className="header-cell sortable"
  onClick={() => handleSort('timestamp')}
>
  Time {renderSortIcon('timestamp')}
</button>
```

**In `renderEntry`, add as the first child of the row div (before the `request-status` span):**
```tsx
<span
  className="request-timestamp"
  data-testid="request-timestamp"
  title={entry.startedDateTime}
>
  {formatTimestamp(entry.startedDateTime)}
</span>
```

- [ ] **Step 5: Run tests — timestamp sort suite must pass**

```bash
cd "c:/Users/ssawane/Documents/Work/HAR LATEST/Deployed build/HAR-File-Analyser" && npx vitest run src/components/__tests__/RequestList.test.tsx
```

Expected: all 6 tests passing.

- [ ] **Step 6: Commit**

```bash
git add src/components/RequestList.tsx src/components/__tests__/RequestList.test.tsx
git commit -m "feat: add timestamp column with sort-by-timestamp (default ascending)"
```

---

## Task 3: Enhanced size cell with SVG arrows

**Files:**
- Modify: `src/components/RequestList.tsx`
- Modify: `src/components/__tests__/RequestList.test.tsx`

- [ ] **Step 1: Add size cell tests**

Append to the test file:

```tsx
describe('RequestList — size cell', () => {
  it('shows request and response sizes with labelled icons', () => {
    const entry = makeEntry({
      request: { ...makeEntry().request, bodySize: 1024 },
      response: { ...makeEntry().response, bodySize: 2048 },
    });
    render(<RequestList entries={[entry]} selectedEntry={null} onSelectEntry={noop} timingType="relative" />);
    expect(screen.getByTestId('size-upload')).toBeInTheDocument();
    expect(screen.getByTestId('size-download')).toBeInTheDocument();
    expect(screen.getByTestId('size-upload').textContent).toContain('1 KB');
    expect(screen.getByTestId('size-download').textContent).toContain('2 KB');
  });

  it('shows — for unknown bodySize (-1)', () => {
    const entry = makeEntry({
      request: { ...makeEntry().request, bodySize: -1 },
      response: { ...makeEntry().response, bodySize: -1 },
    });
    render(<RequestList entries={[entry]} selectedEntry={null} onSelectEntry={noop} timingType="relative" />);
    expect(screen.getByTestId('size-upload').textContent).toContain('—');
    expect(screen.getByTestId('size-download').textContent).toContain('—');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd "c:/Users/ssawane/Documents/Work/HAR LATEST/Deployed build/HAR-File-Analyser" && npx vitest run src/components/__tests__/RequestList.test.tsx
```

Expected: FAIL — no `size-upload`/`size-download` test-ids.

- [ ] **Step 3: Add lucide-react imports to RequestList.tsx**

At the top of `src/components/RequestList.tsx`, replace the existing import block with:

```ts
import React, { useState, useMemo } from 'react';
import {
  ArrowUp, ArrowDown, ArrowUpDown,
  CornerDownRight, HardDrive, Clock, AlertTriangle,
} from 'lucide-react';
import { Entry } from '../types/har';
import { HarAnalyzer } from '../utils/harAnalyzer';
import { formatBytes, formatTime } from '../utils/formatters';
```

- [ ] **Step 4: Replace sort icon renderer to use lucide icons**

Replace the `renderSortIcon` function (lines 77–84) with:

```tsx
const renderSortIcon = (field: SortField) => {
  if (sortField !== field) return <ArrowUpDown size={12} className="sort-icon" aria-hidden="true" />;
  return sortDirection === 'asc'
    ? <ArrowUp size={12} className="sort-icon active" aria-hidden="true" />
    : <ArrowDown size={12} className="sort-icon active" aria-hidden="true" />;
};
```

- [ ] **Step 5: Replace size cell in renderEntry**

Find and replace in `renderEntry` (currently line 104):
```tsx
// Before:
<span className="request-size">{formatBytes(entry.response.bodySize)}</span>

// After:
<span className="request-size">
  <span className="request-size-up" data-testid="size-upload">
    <ArrowUp size={10} aria-hidden="true" />
    {entry.request.bodySize >= 0 ? formatBytes(entry.request.bodySize) : '—'}
  </span>
  {' '}
  <span className="request-size-down" data-testid="size-download">
    <ArrowDown size={10} aria-hidden="true" />
    {entry.response.bodySize >= 0 ? formatBytes(entry.response.bodySize) : '—'}
  </span>
</span>
```

- [ ] **Step 6: Run tests — size suite must pass**

```bash
cd "c:/Users/ssawane/Documents/Work/HAR LATEST/Deployed build/HAR-File-Analyser" && npx vitest run src/components/__tests__/RequestList.test.tsx
```

Expected: all tests passing.

- [ ] **Step 7: Commit**

```bash
git add src/components/RequestList.tsx src/components/__tests__/RequestList.test.tsx
git commit -m "feat: show request and response sizes with SVG arrows in size cell"
```

---

## Task 4: Analysis badges with SVG icons

**Files:**
- Modify: `src/components/RequestList.tsx`
- Modify: `src/components/__tests__/RequestList.test.tsx`

- [ ] **Step 1: Add badge tests**

Append to the test file:

```tsx
describe('RequestList — analysis badges', () => {
  it('shows redirect badge for 3xx status', () => {
    const entry = makeEntry({ response: { ...makeEntry().response, status: 302 } });
    render(<RequestList entries={[entry]} selectedEntry={null} onSelectEntry={noop} timingType="relative" />);
    expect(screen.getByTitle('Redirect')).toBeInTheDocument();
  });

  it('shows cached badge for 304 status', () => {
    const entry = makeEntry({ response: { ...makeEntry().response, status: 304, bodySize: 0 } });
    render(<RequestList entries={[entry]} selectedEntry={null} onSelectEntry={noop} timingType="relative" />);
    expect(screen.getByTitle('Cached')).toBeInTheDocument();
  });

  it('shows cached badge for 200 with 0 bodySize', () => {
    const entry = makeEntry({ response: { ...makeEntry().response, status: 200, bodySize: 0 } });
    render(<RequestList entries={[entry]} selectedEntry={null} onSelectEntry={noop} timingType="relative" />);
    expect(screen.getByTitle('Cached')).toBeInTheDocument();
  });

  it('shows slow badge when time > 3000ms', () => {
    const entry = makeEntry({ time: 3500 });
    render(<RequestList entries={[entry]} selectedEntry={null} onSelectEntry={noop} timingType="relative" />);
    expect(screen.getByTitle('Slow (>3s)')).toBeInTheDocument();
  });

  it('shows large badge when response bodySize > 1MB', () => {
    const entry = makeEntry({ response: { ...makeEntry().response, bodySize: 1_100_000 } });
    render(<RequestList entries={[entry]} selectedEntry={null} onSelectEntry={noop} timingType="relative" />);
    expect(screen.getByTitle('Large response (>1MB)')).toBeInTheDocument();
  });

  it('shows no badges for a normal 200 response', () => {
    const entry = makeEntry(); // 200, 2048 bytes, 300ms
    render(<RequestList entries={[entry]} selectedEntry={null} onSelectEntry={noop} timingType="relative" />);
    expect(screen.queryByTitle('Redirect')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Cached')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Slow (>3s)')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Large response (>1MB)')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd "c:/Users/ssawane/Documents/Work/HAR LATEST/Deployed build/HAR-File-Analyser" && npx vitest run src/components/__tests__/RequestList.test.tsx
```

Expected: FAIL — badge titles not found in DOM.

- [ ] **Step 3: Add getAnalysisBadges helper in RequestList.tsx**

Add this function above the `RequestList` component (after `formatTimestamp`):

```ts
interface AnalysisBadge {
  key: string;
  icon: React.ReactElement;
  className: string;
  title: string;
}

const getAnalysisBadges = (entry: Entry): AnalysisBadge[] => {
  const badges: AnalysisBadge[] = [];
  const { status, bodySize } = entry.response;

  if (status >= 300 && status < 400) {
    badges.push({
      key: 'redirect',
      icon: <CornerDownRight size={12} aria-hidden="true" />,
      className: 'badge-redirect',
      title: 'Redirect',
    });
  }
  if (status === 304 || (status === 200 && bodySize === 0)) {
    badges.push({
      key: 'cached',
      icon: <HardDrive size={12} aria-hidden="true" />,
      className: 'badge-cached',
      title: 'Cached',
    });
  }
  if (entry.time > 3000) {
    badges.push({
      key: 'slow',
      icon: <Clock size={12} aria-hidden="true" />,
      className: 'badge-slow',
      title: 'Slow (>3s)',
    });
  }
  if (bodySize > 1_000_000) {
    badges.push({
      key: 'large',
      icon: <AlertTriangle size={12} aria-hidden="true" />,
      className: 'badge-large',
      title: 'Large response (>1MB)',
    });
  }
  return badges;
};
```

- [ ] **Step 4: Replace URL cell in renderEntry**

In `renderEntry`, replace:
```tsx
// Before:
<span className="request-url" title={entry.request.url}>
  {entry.request.url}
</span>

// After:
<span className="request-url-cell">
  <span className="request-url" title={entry.request.url}>
    {entry.request.url}
  </span>
  {(() => {
    const badges = getAnalysisBadges(entry);
    return badges.length > 0 ? (
      <span className="analysis-badges">
        {badges.map(b => (
          <span key={b.key} className={`analysis-badge ${b.className}`} title={b.title}>
            {b.icon}
          </span>
        ))}
      </span>
    ) : null;
  })()}
</span>
```

- [ ] **Step 5: Run tests — all suites must pass**

```bash
cd "c:/Users/ssawane/Documents/Work/HAR LATEST/Deployed build/HAR-File-Analyser" && npx vitest run src/components/__tests__/RequestList.test.tsx
```

Expected: all tests passing.

- [ ] **Step 6: Commit**

```bash
git add src/components/RequestList.tsx src/components/__tests__/RequestList.test.tsx
git commit -m "feat: add analysis badges (redirect, cached, slow, large) with lucide SVG icons"
```

---

## Task 5: CSS — grid updates

**Files:**
- Modify: `src/styles/globals.css` (4 grid definitions to update)

The grid goes from 6 columns to 7:
- **Before:** `70px 80px 1fr 90px 100px 200px` (Status, Method, URL, Size, Time, Timeline)
- **After:** `90px 70px 80px 1fr 110px 100px 180px` (Timestamp, Status, Method, URL, Size, Time, Timeline)

- [ ] **Step 1: Update line 745 — .request-list-header grid**

```css
/* Find: */
grid-template-columns: 70px 80px 1fr 90px 100px 200px;

/* In the block starting at line 740 (.request-list-header), replace with: */
grid-template-columns: 90px 70px 80px 1fr 110px 100px 180px;
```

The block at line 740 starts with `.request-list-header {` and contains `padding: 16px 24px`. This is the one to update first.

- [ ] **Step 2: Update line 813 — .request-item grid**

```css
/* In the block starting at line 811 (.request-item {), replace: */
grid-template-columns: 70px 80px 1fr 90px 100px 200px;
/* With: */
grid-template-columns: 90px 70px 80px 1fr 110px 100px 180px;
```

- [ ] **Step 3: Update line 1334 — second .request-list-header definition (Sortable Headers block)**

```css
/* In the block at line 1329 (comment: Sortable Headers), replace: */
grid-template-columns: 70px 80px 1fr 90px 100px 200px;
/* With: */
grid-template-columns: 90px 70px 80px 1fr 110px 100px 180px;
```

- [ ] **Step 4: Update both responsive 768px breakpoints**

There are two `@media (max-width: 768px)` blocks that set the grid. Update both:

**Block at line 1247** (`.request-list-header, .request-item` at line 1249):
```css
/* Before: */
grid-template-columns: 50px 60px 1fr 60px;
/* After: */
grid-template-columns: 50px 60px 1fr 80px;
```

**Block at line 1416** (`.request-list-header, .request-item` at line 1418):
```css
/* Before: */
grid-template-columns: 50px 60px 1fr 60px;
/* After: */
grid-template-columns: 50px 60px 1fr 80px;
```

Note: Both responsive blocks already hide `.request-waterfall` and `.request-time`. The `.request-timestamp` cell also needs to be hidden at mobile (added in Task 6).

- [ ] **Step 5: Verify the build compiles**

```bash
cd "c:/Users/ssawane/Documents/Work/HAR LATEST/Deployed build/HAR-File-Analyser" && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/styles/globals.css
git commit -m "style: update request list grid to 7 columns for timestamp column"
```

---

## Task 6: CSS — new classes + responsive + dark mode

**Files:**
- Modify: `src/styles/globals.css` (append at bottom)

- [ ] **Step 1: Append all new classes at the bottom of globals.css**

Add the following block at the very end of `src/styles/globals.css`:

```css
/* === HAR Table Enhancements (2026-04-08) === */

.request-timestamp {
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: #6366f1;
    letter-spacing: -0.01em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    display: flex;
    align-items: center;
}

.request-size-up {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    color: #7c3aed;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
}

.request-size-down {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    color: #0891b2;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
}

.request-url-cell {
    display: flex;
    align-items: center;
    gap: 6px;
    overflow: hidden;
    min-width: 0;
}

.request-url-cell .request-url {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.analysis-badges {
    display: flex;
    align-items: center;
    gap: 3px;
    flex-shrink: 0;
}

.analysis-badge {
    display: inline-flex;
    align-items: center;
    cursor: default;
    line-height: 1;
}

.badge-redirect { color: #ea580c; }
.badge-cached   { color: #64748b; }
.badge-slow     { color: #d97706; }
.badge-large    { color: #dc2626; }

/* Responsive: hide timestamp column on mobile */
@media (max-width: 768px) {
    .request-timestamp {
        display: none;
    }
}

/* Dark mode overrides */
html.dark-mode .request-timestamp  { color: #818cf8; }
html.dark-mode .request-size-up    { color: #a78bfa; }
html.dark-mode .request-size-down  { color: #22d3ee; }
html.dark-mode .badge-cached       { color: #94a3b8; }
html.dark-mode .badge-redirect     { color: #fb923c; }
html.dark-mode .badge-slow         { color: #fbbf24; }
html.dark-mode .badge-large        { color: #f87171; }
```

- [ ] **Step 2: Run full test suite**

```bash
cd "c:/Users/ssawane/Documents/Work/HAR LATEST/Deployed build/HAR-File-Analyser" && npx vitest run
```

Expected: all tests pass, including the existing FilterPanel and PerformanceMetrics suites.

- [ ] **Step 3: Run build to verify no type or CSS errors**

```bash
cd "c:/Users/ssawane/Documents/Work/HAR LATEST/Deployed build/HAR-File-Analyser" && npx tsc --noEmit && npm run build
```

Expected: build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/styles/globals.css
git commit -m "style: add CSS for timestamp, combined size, and analysis badge classes with dark mode"
```

---

## Verification Checklist

After all tasks complete, manually verify in the browser (`npm run dev`):

- [ ] Upload any `.har` file — Timestamp appears as first column in `HH:MM:SS.mmm` format
- [ ] Entries are sorted oldest-first by default (timestamp ascending)
- [ ] Clicking **Time** header sorts ascending; clicking again sorts descending; the lucide arrow icon updates accordingly
- [ ] Size column shows `↑ xKB ↓ yKB` with purple/teal SVG arrows; unknown sizes show `—`
- [ ] A redirect entry (3xx) shows the `CornerDownRight` icon in the URL cell
- [ ] A 304 entry shows the `HardDrive` icon
- [ ] Any entry with `time > 3000` shows the `Clock` icon  
- [ ] Any entry with response > 1MB shows the `AlertTriangle` icon
- [ ] Toggle dark mode — all new elements adopt dark palette (indigo→lighter, purple→lighter, etc.)
- [ ] Resize browser to ≤768px — timestamp column is hidden, table remains usable
