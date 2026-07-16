const LOCAL_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:4000',
] as const;

const VM_FRONTEND_ORIGINS = [
  'http://10.65.39.163:3000',
  'http://celvpvm05798.us.oracle.com:3000',
] as const;

export function parseConfiguredOrigins(value = ''): string[] {
  return value
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
}

export function buildAllowedOrigins(corsOrigin = process.env.CORS_ORIGIN || ''): string[] {
  return Array.from(new Set([
    ...LOCAL_ORIGINS,
    ...VM_FRONTEND_ORIGINS,
    ...parseConfiguredOrigins(corsOrigin),
  ]));
}

export function isOriginAllowed(
  origin: string | undefined,
  allowedOrigins: readonly string[] = buildAllowedOrigins()
): boolean {
  return !origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin);
}
