export interface RuntimeBaseUrlOptions {
  configuredUrl?: string;
  developmentUrl: string;
  isDevelopment: boolean;
  origin?: string;
}

const withoutTrailingSlash = (value: string): string =>
  value.length > 1 ? value.replace(/\/+$/, '') : value;

/**
 * Resolve a browser runtime endpoint without ever sending a production request
 * to the developer workstation. A missing URL (or the build-time same-origin
 * markers "." and "/") resolves to the page origin outside development.
 */
export const resolveRuntimeBaseUrl = ({
  configuredUrl,
  developmentUrl,
  isDevelopment,
  origin = '',
}: RuntimeBaseUrlOptions): string => {
  const configured = configuredUrl?.trim();
  const normalizedOrigin = withoutTrailingSlash(origin.trim());

  if (!configured) {
    return isDevelopment ? withoutTrailingSlash(developmentUrl) : normalizedOrigin;
  }

  if (configured === '.' || configured === './' || configured === '/') {
    return normalizedOrigin;
  }

  if (configured.startsWith('/') && normalizedOrigin) {
    return `${normalizedOrigin}${withoutTrailingSlash(configured)}`;
  }

  // An HTTPS production page must never send evidence to an insecure endpoint.
  // Besides being blocked as mixed content/CSP by modern browsers, allowing an
  // old private or developer HTTP URL here risks routing uploaded evidence to
  // the wrong runtime. Development keeps explicit HTTP endpoints available.
  if (!isDevelopment && normalizedOrigin.startsWith('https://')) {
    try {
      const configuredProtocol = new URL(configured).protocol;
      if (configuredProtocol === 'http:' || configuredProtocol === 'ws:') {
        return normalizedOrigin;
      }
    } catch {
      // Preserve existing handling for non-URL values; the caller will surface
      // an actionable request error rather than silently inventing an endpoint.
    }
  }

  return withoutTrailingSlash(configured);
};

const browserOrigin =
  typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : '';
const isDevelopment = Boolean(import.meta.env.DEV);
const developmentBackendUrl = import.meta.env.DEV ? 'http://localhost:4000' : '';

export const API_BASE_URL = resolveRuntimeBaseUrl({
  configuredUrl: import.meta.env.VITE_API_URL,
  developmentUrl: developmentBackendUrl,
  isDevelopment,
  origin: browserOrigin,
});

export const BACKEND_BASE_URL = resolveRuntimeBaseUrl({
  configuredUrl: import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL,
  developmentUrl: developmentBackendUrl,
  isDevelopment,
  origin: browserOrigin,
});

export const WS_BASE_URL = resolveRuntimeBaseUrl({
  configuredUrl: import.meta.env.VITE_WS_URL,
  developmentUrl: developmentBackendUrl,
  isDevelopment,
  origin: browserOrigin,
});
