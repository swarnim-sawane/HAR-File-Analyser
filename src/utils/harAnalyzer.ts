// src/utils/harAnalyzer.ts
import { Entry, Page, Timings } from '../types/har';

export class HarAnalyzer {
  // src/utils/harAnalyzer.ts - Update this method
    static filterByStatusCode(entries: Entry[], codes: number[]): Entry[] {
        return entries.filter(entry => {
            const status = entry.response.status;
            return codes.some(code => {
                if (code === 0) return status === 0;
                const range = Math.floor(code / 100);
                const statusRange = Math.floor(status / 100);
                return range === statusRange;
            });
        });
    }


  static groupByPage(entries: Entry[], pages: Page[]): Map < string, Entry[] > {
    const grouped = new Map<string, Entry[]>();

    pages.forEach(page => {
        const pageEntries = entries.filter(entry => entry.pageref === page.id);
        grouped.set(page.id, pageEntries);
    });

    // Group entries without pageref
    const orphanEntries = entries.filter(entry => !entry.pageref);
    if(orphanEntries.length > 0) {
    grouped.set('_orphan', orphanEntries);
}

return grouped;
  }

  static searchEntries(entries: Entry[], term: string): Entry[] {
    const lowerTerm = term.toLowerCase();
    return entries.filter(entry =>
        entry.request.url.toLowerCase().includes(lowerTerm) ||
        entry.request.method.toLowerCase().includes(lowerTerm) ||
        entry.response.statusText.toLowerCase().includes(lowerTerm)
    );
}

  static calculateTotalTime(timings: Timings): number {
    return (
        (timings.blocked || 0) +
        (timings.dns || 0) +
        (timings.connect || 0) +
        (timings.send || 0) +
        (timings.wait || 0) +
        (timings.receive || 0) +
        (timings.ssl || 0)
    );
}

  static getPerformanceMetrics(entries: Entry[]) {
    const totalRequests = entries.length;
    const totalSize = entries.reduce((sum, entry) =>
        sum + entry.response.bodySize, 0
    );
    const totalTime = entries.reduce((sum, entry) =>
        sum + entry.time, 0
    );

    const statusCounts = entries.reduce((acc, entry) => {
        const statusClass = Math.floor(entry.response.status / 100) * 100;
        acc[statusClass] = (acc[statusClass] || 0) + 1;
        return acc;
    }, {} as Record<number, number>);

    const avgTime = totalRequests > 0 ? totalTime / totalRequests : 0;

    return {
        totalRequests,
        totalSize,
        totalTime,
        avgTime,
        statusCounts,
    };
}

  static getMimeTypeBreakdown(entries: Entry[]): Record < string, number > {
    return entries.reduce((acc, entry) => {
        const mimeType = entry.response.content.mimeType;
        acc[mimeType] = (acc[mimeType] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);
}

  static getTimingBreakdown(entry: Entry) {
    const { timings } = entry;
    return {
        blocked: timings.blocked || 0,
        dns: timings.dns || 0,
        connect: timings.connect || 0,
        ssl: timings.ssl || 0,
        send: timings.send || 0,
        wait: timings.wait || 0,
        receive: timings.receive || 0,
    };
}
}
