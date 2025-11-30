// src/utils/harExporter.ts

import { Entry } from '../types/har';
import { formatTime } from './formatters';

export class HarExporter {
  static exportToCSV(entries: Entry[], filename: string = 'har-export.csv'): void {
    const headers = [
      'Status',
      'Method',
      'URL',
      'Domain',
      'Type',
      'Size',
      'Time (ms)',
      'Protocol',
      'Started',
      'Server IP'
    ];
    
    const rows = entries.map(entry => {
      const url = new URL(entry.request.url);
      const contentType = entry.response.content.mimeType || '';
      const resourceType = this.getResourceType(contentType);
      
      return [
        entry.response.status.toString(),
        entry.request.method,
        `"${entry.request.url.replace(/"/g, '""')}"`,
        url.hostname,
        resourceType,
        this.formatSize(entry.response.bodySize),
        entry.time.toFixed(2),
        entry.request.httpVersion,
        entry.startedDateTime,
        entry.serverIPAddress || ''
      ];
    });

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    this.downloadFile(csvContent, filename, 'text/csv');
  }

  static exportToExcel(entries: Entry[], filename: string = 'har-export.csv'): void {
    const headers = [
      'Status',
      'Method',
      'URL',
      'Domain',
      'Type',
      'Size',
      'Time (ms)',
      'Protocol',
      'Started',
      'Server IP',
      'Request Headers',
      'Response Headers'
    ];
    
    const rows = entries.map(entry => {
      const url = new URL(entry.request.url);
      const contentType = entry.response.content.mimeType || '';
      const resourceType = this.getResourceType(contentType);
      const requestHeaders = entry.request.headers.map(h => `${h.name}: ${h.value}`).join('; ');
      const responseHeaders = entry.response.headers.map(h => `${h.name}: ${h.value}`).join('; ');
      
      return [
        entry.response.status.toString(),
        entry.request.method,
        `"${entry.request.url.replace(/"/g, '""')}"`,
        url.hostname,
        resourceType,
        this.formatSize(entry.response.bodySize),
        entry.time.toFixed(2),
        entry.request.httpVersion,
        entry.startedDateTime,
        entry.serverIPAddress || '',
        `"${requestHeaders.replace(/"/g, '""')}"`,
        `"${responseHeaders.replace(/"/g, '""')}"`
      ];
    });

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    this.downloadFile(csvContent, filename, 'text/csv');
  }

  private static formatSize(bytes: number): string {
    if (bytes === 0 || bytes === -1) return '0 B';
    if (bytes < 0) return 'N/A';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  }

  private static getResourceType(mimeType: string): string {
    if (mimeType.includes('javascript')) return 'script';
    if (mimeType.includes('css')) return 'stylesheet';
    if (mimeType.includes('image')) return 'image';
    if (mimeType.includes('font')) return 'font';
    if (mimeType.includes('html')) return 'document';
    if (mimeType.includes('json')) return 'xhr';
    if (mimeType.includes('xml')) return 'xhr';
    return 'other';
  }

  private static downloadFile(content: string, filename: string, mimeType: string): void {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  static getExportFilename(originalFilename: string, filterCount: number, totalCount: number): string {
    const timestamp = new Date().toISOString().split('T')[0];
    const baseName = originalFilename.replace(/\.[^/.]+$/, '');
    const suffix = filterCount === totalCount ? 'all' : `filtered-${filterCount}`;
    return `${baseName}-${suffix}-${timestamp}`;
  }
}
