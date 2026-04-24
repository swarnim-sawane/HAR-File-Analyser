import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useHarData } from '../useHarData';
import { makeHarFile, makeHarJson, makeEntry, makeRequest, makeResponse } from '../../test-utils/fixtures';

function makeFile(content: string): File {
  return new File([new Blob([content])], 'test.har', { type: 'application/json' });
}

describe('useHarData — initial state', () => {
  it('starts with null harData and empty filteredEntries', () => {
    const { result } = renderHook(() => useHarData());
    expect(result.current.harData).toBeNull();
    expect(result.current.filteredEntries).toHaveLength(0);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('has default status code filters with 2xx/3xx/4xx/5xx active', () => {
    const { result } = renderHook(() => useHarData());
    const { statusCodes } = result.current.filters;
    expect(statusCodes['2xx']).toBe(true);
    expect(statusCodes['3xx']).toBe(true);
    expect(statusCodes['4xx']).toBe(true);
    expect(statusCodes['5xx']).toBe(true);
    expect(statusCodes['0']).toBe(false);
    expect(statusCodes['1xx']).toBe(false);
  });
});

describe('useHarData — loadHarFile', () => {
  it('sets harData after loading a valid file', async () => {
    const { result } = renderHook(() => useHarData());
    await act(async () => {
      await result.current.loadHarFile(makeFile(makeHarJson()));
    });
    expect(result.current.harData).not.toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('sets filteredEntries after loading', async () => {
    const { result } = renderHook(() => useHarData());
    const entries = [makeEntry(), makeEntry()];
    await act(async () => {
      await result.current.loadHarFile(makeFile(makeHarJson(entries)));
    });
    expect(result.current.filteredEntries.length).toBeGreaterThan(0);
  });

  it('sets error for corrupt file content', async () => {
    const { result } = renderHook(() => useHarData());
    await act(async () => {
      await result.current.loadHarFile(makeFile('not valid json'));
    });
    expect(result.current.harData).toBeNull();
    expect(result.current.error).not.toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('clears selectedEntry when loading a new file', async () => {
    const { result } = renderHook(() => useHarData());
    // Load initial data
    await act(async () => {
      await result.current.loadHarData(makeHarFile());
    });
    // Set selected entry
    act(() => {
      result.current.setSelectedEntry(makeEntry());
    });
    expect(result.current.selectedEntry).not.toBeNull();
    // Load new file — should clear selected entry
    await act(async () => {
      await result.current.loadHarFile(makeFile(makeHarJson()));
    });
    expect(result.current.selectedEntry).toBeNull();
  });
});

describe('useHarData — loadHarData', () => {
  it('accepts a pre-parsed HarFile object', async () => {
    const { result } = renderHook(() => useHarData());
    const harData = makeHarFile([makeEntry(), makeEntry()]);
    await act(async () => {
      await result.current.loadHarData(harData);
    });
    expect(result.current.harData).toBe(harData);
    expect(result.current.filteredEntries).toHaveLength(2);
  });
});

describe('useHarData — status code filtering', () => {
  it('shows all entries when no status codes are active (no filter applied)', async () => {
    // The hook only filters when activeStatusCodes.length > 0.
    // When all are false, filtering is skipped and all entries are returned.
    const { result } = renderHook(() => useHarData());
    const e200 = makeEntry({ response: { ...makeResponse(), status: 200 } });
    const e404 = makeEntry({ response: { ...makeResponse(), status: 404 } });
    await act(async () => {
      await result.current.loadHarData(makeHarFile([e200, e404]));
    });
    // Disable all status codes
    act(() => {
      result.current.updateFilters({
        statusCodes: { '0': false, '1xx': false, '2xx': false, '3xx': false, '4xx': false, '5xx': false },
      });
    });
    // No active codes → no filtering → all entries returned
    expect(result.current.filteredEntries).toHaveLength(2);
  });

  it('shows only 4xx when only 4xx is active', async () => {
    const { result } = renderHook(() => useHarData());
    const e200 = makeEntry({ response: { ...makeResponse(), status: 200 } });
    const e404 = makeEntry({ response: { ...makeResponse(), status: 404 } });
    const e500 = makeEntry({ response: { ...makeResponse(), status: 500 } });
    await act(async () => {
      await result.current.loadHarData(makeHarFile([e200, e404, e500]));
    });
    act(() => {
      result.current.updateFilters({
        statusCodes: { '0': false, '1xx': false, '2xx': false, '3xx': false, '4xx': true, '5xx': false },
      });
    });
    expect(result.current.filteredEntries).toHaveLength(1);
    expect(result.current.filteredEntries[0].response.status).toBe(404);
  });
});

describe('useHarData — search filtering', () => {
  it('filters entries by search term', async () => {
    const { result } = renderHook(() => useHarData());
    const eUsers = makeEntry({ request: { ...makeRequest(), url: 'https://api.example.com/users' } });
    const eLogin = makeEntry({ request: { ...makeRequest(), url: 'https://api.example.com/login' } });
    await act(async () => {
      await result.current.loadHarData(makeHarFile([eUsers, eLogin]));
    });
    act(() => {
      result.current.updateFilters({ searchTerm: '/users' });
    });
    expect(result.current.filteredEntries).toHaveLength(1);
    expect(result.current.filteredEntries[0].request.url).toContain('/users');
  });

  it('returns all entries when search term is cleared', async () => {
    const { result } = renderHook(() => useHarData());
    const entries = [makeEntry(), makeEntry(), makeEntry()];
    await act(async () => {
      await result.current.loadHarData(makeHarFile(entries));
    });
    act(() => { result.current.updateFilters({ searchTerm: 'zzznomatch' }); });
    expect(result.current.filteredEntries).toHaveLength(0);
    act(() => { result.current.updateFilters({ searchTerm: '' }); });
    expect(result.current.filteredEntries).toHaveLength(3);
  });
});

describe('useHarData — clearData', () => {
  it('resets all state to initial values', async () => {
    const { result } = renderHook(() => useHarData());
    await act(async () => { await result.current.loadHarData(makeHarFile()); });
    act(() => { result.current.updateFilters({ searchTerm: 'test' }); });
    act(() => { result.current.clearData(); });
    expect(result.current.harData).toBeNull();
    expect(result.current.filteredEntries).toHaveLength(0);
    expect(result.current.error).toBeNull();
    expect(result.current.filters.searchTerm).toBe('');
    expect(result.current.selectedEntry).toBeNull();
  });
});
