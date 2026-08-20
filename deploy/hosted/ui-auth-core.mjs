import {
  createHash,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify as verifySignature,
} from 'node:crypto';

const base64UrlDecode = (value) => Buffer.from(String(value), 'base64url');

export const createOpaqueToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export const createPkceChallenge = (verifier) => createHash('sha256')
  .update(verifier, 'ascii')
  .digest('base64url');

export const parseCookies = (header = '') => {
  const cookies = new Map();
  for (const item of String(header).split(';')) {
    const separator = item.indexOf('=');
    if (separator < 1) continue;
    const name = item.slice(0, separator).trim();
    const rawValue = item.slice(separator + 1).trim();
    try {
      cookies.set(name, decodeURIComponent(rawValue));
    } catch {
      cookies.set(name, rawValue);
    }
  }
  return cookies;
};

export const serializeCookie = (name, value, {
  maxAge,
  secure = true,
  httpOnly = true,
  sameSite = 'Lax',
  path = '/',
} = {}) => {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, `SameSite=${sameSite}`];
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  if (Number.isFinite(maxAge)) parts.push(`Max-Age=${Math.max(0, Math.floor(maxAge))}`);
  return parts.join('; ');
};

export const isSafeReturnTo = (value) => {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return false;
  try {
    const parsed = new URL(value, 'https://ui.invalid');
    return parsed.origin === 'https://ui.invalid' && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
};

export const constantTimeEqual = (left, right) => {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
};

export const parseBoundedInteger = (value, {
  name,
  minimum,
  maximum,
  defaultValue,
}) => {
  const candidate = value === undefined || value === null || value === ''
    ? defaultValue
    : Number(value);
  if (!Number.isSafeInteger(candidate) || candidate < minimum || candidate > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return candidate;
};

const decodeJwt = (token) => {
  const parts = String(token).split('.');
  if (parts.length !== 3 || parts.some((part) => !part)) throw new Error('ID token is malformed');
  let header;
  let payload;
  try {
    header = JSON.parse(base64UrlDecode(parts[0]).toString('utf8'));
    payload = JSON.parse(base64UrlDecode(parts[1]).toString('utf8'));
  } catch {
    throw new Error('ID token contains invalid JSON');
  }
  return { header, payload, signingInput: `${parts[0]}.${parts[1]}`, signature: base64UrlDecode(parts[2]) };
};

const hasAudience = (claim, expected) => Array.isArray(claim)
  ? claim.includes(expected)
  : claim === expected;

export const verifyIdToken = ({ token, jwks, issuer, audience, nonce, nowSeconds = Math.floor(Date.now() / 1000) }) => {
  const { header, payload, signingInput, signature } = decodeJwt(token);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('ID token uses an unsupported signature');
  const jwk = Array.isArray(jwks?.keys) ? jwks.keys.find((candidate) => candidate.kid === header.kid) : undefined;
  if (!jwk || jwk.kty !== 'RSA') throw new Error('ID token signing key was not found');
  const publicKey = createPublicKey({ key: jwk, format: 'jwk' });
  const validSignature = verifySignature('RSA-SHA256', Buffer.from(signingInput, 'ascii'), publicKey, signature);
  if (!validSignature) throw new Error('ID token signature is invalid');
  if (payload.iss !== issuer) throw new Error('ID token issuer is invalid');
  if (!hasAudience(payload.aud, audience)) throw new Error('ID token audience is invalid');
  if (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== audience) {
    throw new Error('ID token authorized party is invalid');
  }
  if (payload.azp !== undefined && payload.azp !== audience) throw new Error('ID token authorized party is invalid');
  if (!Number.isFinite(payload.exp) || payload.exp <= nowSeconds - 30) throw new Error('ID token has expired');
  if (!Number.isFinite(payload.iat) || payload.iat > nowSeconds + 60) throw new Error('ID token issued-at time is invalid');
  if (payload.nbf !== undefined && (!Number.isFinite(payload.nbf) || payload.nbf > nowSeconds + 30)) {
    throw new Error('ID token is not active yet');
  }
  if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('ID token subject is missing');
  if (nonce && !constantTimeEqual(payload.nonce || '', nonce)) throw new Error('ID token nonce is invalid');
  return payload;
};

export const redactAuthError = (error) => {
  const message = error instanceof Error ? error.message : 'Authentication failed';
  return message
    .replace(/client_secret=[^&\s]+/gi, 'client_secret=[REDACTED]')
    .replace(/(Bearer|Basic)\s+[^\s,]+/gi, '$1 [REDACTED]')
    .slice(0, 300);
};
