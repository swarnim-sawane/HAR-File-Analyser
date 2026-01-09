// src/utils/formatters.ts

export const formatBytes = (bytes: number, decimals: number = 2): string => {
  if (bytes === 0) return '0 Bytes';
  if (bytes < 0) return 'N/A';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

export const formatTime = (ms: number, includeMs: boolean = true): string => {
  if (ms < 0) return 'N/A';
  if (ms === 0) return '0ms';

  if (ms < 1000) {
    return `${ms.toFixed(0)}ms`;
  }

  if (ms < 60000) {
    const seconds = (ms / 1000).toFixed(2);
    return includeMs ? `${seconds}s` : `${Math.round(ms / 1000)}s`;
  }

  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return `${minutes}m ${seconds}s`;
};

export const formatDate = (dateString: string): string => {
  try {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return dateString;
  }
};

export const formatUrl = (url: string, maxLength: number = 80): string => {
  if (url.length <= maxLength) return url;

  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname;
    const path = urlObj.pathname + urlObj.search + urlObj.hash;

    if (domain.length + path.length <= maxLength) {
      return url;
    }

    const availableLength = maxLength - domain.length - 3; // 3 for "..."
    if (availableLength < 10) {
      return url.substring(0, maxLength - 3) + '...';
    }

    const startLength = Math.floor(availableLength / 2);
    const endLength = availableLength - startLength;

    return `${domain}${path.substring(0, startLength)}...${path.substring(
      path.length - endLength
    )}`;
  } catch {
    return url.substring(0, maxLength - 3) + '...';
  }
};

export const formatDomain = (url: string): string => {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return url;
  }
};

export const formatHttpVersion = (version: string): string => {
  const versionMap: Record<string, string> = {
    'HTTP/0.9': 'HTTP/0.9',
    'HTTP/1.0': 'HTTP/1.0',
    'HTTP/1.1': 'HTTP/1.1',
    'HTTP/2.0': 'HTTP/2',
    'h2': 'HTTP/2',
    'h2c': 'HTTP/2',
    'HTTP/3.0': 'HTTP/3',
    'h3': 'HTTP/3',
  };

  return versionMap[version] || version;
};

export const formatMimeType = (mimeType: string): string => {
  const parts = mimeType.split(';')[0].trim();
  
  const typeMap: Record<string, string> = {
    'text/html': 'HTML',
    'text/css': 'CSS',
    'text/javascript': 'JS',
    'application/javascript': 'JS',
    'application/json': 'JSON',
    'image/png': 'PNG',
    'image/jpeg': 'JPEG',
    'image/gif': 'GIF',
    'image/svg+xml': 'SVG',
    'image/webp': 'WebP',
    'font/woff': 'WOFF',
    'font/woff2': 'WOFF2',
    'application/font-woff': 'WOFF',
    'application/font-woff2': 'WOFF2',
  };

  return typeMap[parts] || parts;
};

export const formatPercentage = (value: number, total: number): string => {
  if (total === 0) return '0%';
  return `${((value / total) * 100).toFixed(1)}%`;
};

export const getColorForTiming = (phase: string): string => {
  const colorMap: Record<string, string> = {
    blocked: '#94a3b8',
    dns: '#60a5fa',
    connect: '#34d399',
    ssl: '#fbbf24',
    send: '#fb923c',
    wait: '#f87171',
    receive: '#a78bfa',
  };

  return colorMap[phase] || '#94a3b8';
};

export const truncateString = (str: string, maxLength: number): string => {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
};
