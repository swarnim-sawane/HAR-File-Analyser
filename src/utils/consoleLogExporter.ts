// src/utils/consoleLogExporter.ts

import { ConsoleLogEntry } from '../types/consolelog';
import { formatDate } from './formatters';

export class ConsoleLogExporter {
  static exportToCSV(entries: ConsoleLogEntry[], filename: string = 'console-logs.csv'): void {
    const headers = ['Level', 'Timestamp', 'Message', 'Source', 'Line', 'Column', 'Category', 'URL'];
    
    const rows = entries.map(entry => [
      entry.level,
      formatDate(entry.timestamp),
      `"${entry.message.replace(/"/g, '""')}"`, // Escape quotes
      entry.source || '',
      entry.lineNumber?.toString() || '',
      entry.columnNumber?.toString() || '',
      entry.category || '',
      entry.url || ''
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    this.downloadFile(csvContent, filename, 'text/csv');
  }

  static exportToExcel(entries: ConsoleLogEntry[], filename: string = 'console-logs.xlsx'): void {
    // For Excel, we'll use CSV format but with .xlsx extension
    // For true Excel format, you'd need a library like xlsx or exceljs
    const headers = ['Level', 'Timestamp', 'Message', 'Source', 'Line', 'Column', 'Category', 'URL', 'Stack Trace'];
    
    const rows = entries.map(entry => [
      entry.level,
      formatDate(entry.timestamp),
      `"${entry.message.replace(/"/g, '""')}"`,
      entry.source || '',
      entry.lineNumber?.toString() || '',
      entry.columnNumber?.toString() || '',
      entry.category || '',
      entry.url || '',
      entry.stackTrace ? `"${entry.stackTrace.replace(/"/g, '""')}"` : ''
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    // Download as CSV (Excel can open this)
    this.downloadFile(csvContent, filename.replace('.xlsx', '.csv'), 'text/csv');
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
