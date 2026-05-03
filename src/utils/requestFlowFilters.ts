import type { Entry } from '../types/har';
import type { RequestFlowFocusMode } from '../types/requestFlow';
import type { ZoneRequest } from './requestFlowAnalyzer';

export function getRequestFlowEntryIdentity(entry: Entry): string {
  return [
    entry.startedDateTime,
    entry.request.method,
    entry.request.url,
    entry.response.status,
    entry.time ?? 0,
  ].join('|');
}

export function getVisibleRequestIndexes(
  entries: Entry[],
  visibleEntries?: Entry[]
): Set<number> | null {
  if (!visibleEntries) return null;

  const indexByEntry = new Map<Entry, number>();
  const indexesByIdentity = new Map<string, number[]>();

  entries.forEach((entry, index) => {
    indexByEntry.set(entry, index);

    const identity = getRequestFlowEntryIdentity(entry);
    const indexes = indexesByIdentity.get(identity) ?? [];
    indexes.push(index);
    indexesByIdentity.set(identity, indexes);
  });

  const next = new Set<number>();

  visibleEntries.forEach((entry) => {
    const directIndex = indexByEntry.get(entry);
    if (directIndex !== undefined) {
      next.add(directIndex);
      return;
    }

    indexesByIdentity.get(getRequestFlowEntryIdentity(entry))?.forEach((index) => {
      next.add(index);
    });
  });

  return next;
}

export function requestMatchesFlowFocus(
  request: Pick<ZoneRequest, 'failed' | 'isSlow'>,
  focusMode: RequestFlowFocusMode
): boolean {
  if (focusMode === 'errors') return request.failed;
  if (focusMode === 'slow') return request.isSlow;
  return true;
}
