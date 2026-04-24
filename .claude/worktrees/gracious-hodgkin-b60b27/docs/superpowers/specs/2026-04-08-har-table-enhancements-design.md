# HAR Table Enhancements — Design Spec
**Date:** 2026-04-08  
**Status:** Approved

---

## Context

Google's HAR Analyser displays a **Timestamp column** as the first column in the entries table, lets users **sort by it**, shows **both request and response sizes**, and provides **visual analysis badges** (redirect, cached, slow, large) per row. Our tool lacked all four of these, making it harder to trace request sequences and visually scan for anomalies. This spec closes those gaps using a frontend-only approach — all required data (`startedDateTime`, `request.bodySize`, `response.bodySize`, `response.status`, `entry.time`) is already present in every loaded entry.

---

## Scope

Three changes to `src/components/RequestList.tsx` + CSS updates in `src/styles/globals.css`. No backend changes. Works for both small-file (in-memory) and large-file (paginated) modes.

---

## Feature 1: Timestamp Column + Sort-by-Timestamp

### Behaviour
- A new **Timestamp** column is the first column in the table.
- Format: `HH:MM:SS.mmm` extracted from `entry.startedDateTime` (ISO 8601).
- The column header is a clickable sort button, same as Status/Method/URL/Size/Time.
- **Default sort changes from `'time'` to `'timestamp'`** so entries appear in chronological order by default — matching Google's tool and user expectation.
- Clicking Timestamp header toggles asc/desc. Sort indicator (`↑`/`↓`/`⇅`) follows the same pattern as other columns.

### Implementation — `RequestList.tsx`
1. Extend type: `type SortField = 'status' | 'method' | 'url' | 'size' | 'time' | 'timestamp'`
2. Change initial state: `useState<SortField>('timestamp')`
3. Add sort case in `sortedEntries` useMemo:
   ```ts
   case 'timestamp':
     comparison = new Date(a.startedDateTime).getTime() - new Date(b.startedDateTime).getTime();
     break;
   ```
4. Add inline format helper (no new file needed):
   ```ts
   const formatTimestamp = (iso: string): string => {
     const d = new Date(iso);
     const hh = String(d.getHours()).padStart(2, '0');
     const mm = String(d.getMinutes()).padStart(2, '0');
     const ss = String(d.getSeconds()).padStart(2, '0');
     const ms = String(d.getMilliseconds()).padStart(3, '0');
     return `${hh}:${mm}:${ss}.${ms}`;
   };
   ```
5. Add header button as first child of `.request-list-header`:
   ```tsx
   <button className="header-cell sortable" onClick={() => handleSort('timestamp')}>
     Time {renderSortIcon('timestamp')}
   </button>
   ```
6. Add timestamp cell as first child of each row in `renderEntry`:
   ```tsx
   <span className="request-timestamp" title={entry.startedDateTime}>
     {formatTimestamp(entry.startedDateTime)}
   </span>
   ```

---

## Feature 2: Combined ↑↓ Size Cell

### Behaviour
- The existing "Size" column (response body only) becomes a dual-display cell.
- Format: `↑ 1.4KB  ↓ 2.6KB`
  - `↑` (upload/request) in purple (`#7c3aed`)
  - `↓` (download/response) in teal (`#0891b2`)
- `bodySize === -1` (unknown) renders as `—` not `-1 B`.
- Sort-by-size continues to sort on `response.bodySize` — most useful for finding heavy downloads.

### Implementation — `RequestList.tsx`
Replace in `renderEntry`:
```tsx
// Before:
<span className="request-size">{formatBytes(entry.response.bodySize)}</span>

// After — uses inline SVG arrow icons, not unicode arrows:
<span className="request-size">
  <span className="request-size-up"><SVG_ARROW_UP />{entry.request.bodySize >= 0 ? formatBytes(entry.request.bodySize) : '—'}</span>
  {' '}
  <span className="request-size-down"><SVG_ARROW_DOWN />{entry.response.bodySize >= 0 ? formatBytes(entry.response.bodySize) : '—'}</span>
</span>
// SVG_ARROW_UP / SVG_ARROW_DOWN: viewBox 0 0 16 16, 10×10, currentColor stroke, no fill
```

---

## Feature 3: Analysis Badges in URL Cell

### Behaviour
Small inline badges appended inside the URL cell. No new column; the URL cell is `1fr` and can absorb them.

| Badge | SVG Icon | Colour | Condition |
|-------|----------|--------|-----------|
| Redirect | Curved arrow right (SVG) | Orange `#ea580c` | `status >= 300 && status < 400` |
| Cached | Circle with dot / disk (SVG) | Grey `#64748b` | `status === 304` OR (`status === 200 && response.bodySize === 0`) |
| Slow | Clock / hourglass (SVG) | Amber `#d97706` | `entry.time > 3000` |
| Large | Upload arrow up (SVG) | Red `#dc2626` | `response.bodySize > 1_000_000` |

**Icon rule:** All badges use inline SVG elements (16×16 viewBox, `currentColor` fill/stroke). No unicode symbols, no emoji anywhere in the UI.

Badges are rendered only when the condition is true. A single entry may have multiple badges (e.g. redirect + slow).

### Implementation — `RequestList.tsx`
Add helper:
```ts
// Each badge carries an inline SVG (ReactElement) using currentColor so CSS colours apply.
const getAnalysisBadges = (entry: Entry): { key: string; svg: React.ReactElement; className: string; title: string }[] => {
  const badges = [];
  const { status } = entry.response;
  if (status >= 300 && status < 400)
    badges.push({ key: 'redirect', svg: <SVG_REDIRECT />, className: 'badge-redirect', title: 'Redirect' });
  if (status === 304 || (status === 200 && entry.response.bodySize === 0))
    badges.push({ key: 'cached', svg: <SVG_CACHED />, className: 'badge-cached', title: 'Cached' });
  if (entry.time > 3000)
    badges.push({ key: 'slow', svg: <SVG_SLOW />, className: 'badge-slow', title: 'Slow (>3s)' });
  if (entry.response.bodySize > 1_000_000)
    badges.push({ key: 'large', svg: <SVG_LARGE />, className: 'badge-large', title: 'Large response (>1MB)' });
  return badges;
};
// SVG components defined as small inline arrow/icon JSX above the component.
// All use viewBox="0 0 16 16", width/height 12, fill/stroke="currentColor".
```

Replace URL cell in `renderEntry`:
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
  {getAnalysisBadges(entry).length > 0 && (
    <span className="analysis-badges">
      {getAnalysisBadges(entry).map(b => (
        <span key={b.key} className={`analysis-badge ${b.className}`} title={b.title}>
          {b.svg} {/* inline SVG, currentColor */}
        </span>
      ))}
    </span>
  )}
</span>
```

---

## CSS Changes — `src/styles/globals.css`

### Grid updates (3 locations)

**Line 745** `.request-list-header` and **Line 813** `.request-item`:
```css
/* Before */
grid-template-columns: 70px 80px 1fr 90px 100px 200px;

/* After */
grid-template-columns: 90px 70px 80px 1fr 110px 100px 180px;
```

**Lines 1249–1251 + 1418–1420** (responsive ≤768px):
```css
/* Before */
grid-template-columns: 50px 60px 1fr 60px;

/* After — drop Timestamp, keep Status+Method+URL+Time */
grid-template-columns: 50px 60px 1fr 80px;
```

### New classes (append at bottom of `globals.css`)

```css
/* === HAR Table Enhancements === */

.request-timestamp {
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: #6366f1;
    letter-spacing: -0.01em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.request-size-up { color: #7c3aed; font-size: 11px; }
.request-size-down { color: #0891b2; font-size: 11px; }

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
}

.analysis-badges {
    display: flex;
    align-items: center;
    gap: 3px;
    flex-shrink: 0;
}

.analysis-badge {
    font-size: 10px;
    cursor: default;
    line-height: 1;
}

.badge-redirect { color: #ea580c; }
.badge-cached   { color: #64748b; }
.badge-slow     { color: #d97706; }
.badge-large    { color: #dc2626; }

/* Dark mode overrides */
html.dark-mode .request-timestamp { color: #818cf8; }
html.dark-mode .request-size-up   { color: #a78bfa; }
html.dark-mode .request-size-down { color: #22d3ee; }
html.dark-mode .badge-cached      { color: #94a3b8; }
```

---

## Files Modified

| File | Change |
|------|--------|
| `src/components/RequestList.tsx` | Add `'timestamp'` sort field, `formatTimestamp()`, `getAnalysisBadges()`, new timestamp cell, updated size cell, badges in URL cell |
| `src/styles/globals.css` | Update 3 grid definitions, append new CSS classes at bottom |

No other files touched. No backend changes.

---

## Verification

1. Upload any HAR file → entries table shows Timestamp as first column in `HH:MM:SS.mmm` format
2. Click **Time** column header → entries sort chronologically (asc); click again → newest first (desc)
3. Size column shows `↑ xKB ↓ yKB` for all entries; entries with unknown size show `—`
4. A 3xx entry shows `↪` badge; a 304 shows `◉`; a >3s entry shows `⚡`; a >1MB response shows `▲`
5. Dark mode toggle — all new elements adopt dark palette correctly
6. Responsive: at ≤768px timestamp column is hidden, table remains usable
