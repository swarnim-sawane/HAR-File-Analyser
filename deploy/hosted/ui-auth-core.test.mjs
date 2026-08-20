import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import {
  createPkceChallenge,
  isSafeReturnTo,
  parseBoundedInteger,
  parseCookies,
  serializeCookie,
  verifyIdToken,
} from './ui-auth-core.mjs';

test('creates an RFC 7636 S256 PKCE challenge', () => {
  assert.equal(
    createPkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  );
});

test('accepts only bounded integer configuration values', () => {
  assert.equal(parseBoundedInteger(undefined, {
    name: 'LIMIT', minimum: 1, maximum: 100, defaultValue: 10,
  }), 10);
  assert.equal(parseBoundedInteger('25', {
    name: 'LIMIT', minimum: 1, maximum: 100, defaultValue: 10,
  }), 25);
  assert.throws(() => parseBoundedInteger('not-a-number', {
    name: 'LIMIT', minimum: 1, maximum: 100, defaultValue: 10,
  }), /LIMIT/);
  assert.throws(() => parseBoundedInteger('101', {
    name: 'LIMIT', minimum: 1, maximum: 100, defaultValue: 10,
  }), /LIMIT/);
});

test('accepts only same-origin relative return paths', () => {
  assert.equal(isSafeReturnTo('/scorecard?file=1'), true);
  assert.equal(isSafeReturnTo('//attacker.example'), false);
  assert.equal(isSafeReturnTo('https://attacker.example'), false);
  assert.equal(isSafeReturnTo('/\\attacker.example'), false);
});

test('parses and emits hardened cookies', () => {
  assert.equal(parseCookies('one=1; session=abc%201').get('session'), 'abc 1');
  assert.equal(
    serializeCookie('__Host-har_session', 'abc', { maxAge: 60 }),
    '__Host-har_session=abc; Path=/; SameSite=Lax; HttpOnly; Secure; Max-Age=60',
  );
});

test('verifies a signed RS256 ID token and its security claims', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  jwk.kid = 'test-key';
  const now = 1_800_000_000;
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: jwk.kid })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: 'https://identity.oraclecloud.com/',
    aud: 'client-id',
    sub: 'user-id',
    nonce: 'nonce',
    iat: now - 1,
    exp: now + 300,
  })).toString('base64url');
  const signingInput = `${header}.${payload}`;
  const signature = sign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64url');
  const token = `${signingInput}.${signature}`;

  assert.equal(verifyIdToken({
    token,
    jwks: { keys: [jwk] },
    issuer: 'https://identity.oraclecloud.com/',
    audience: 'client-id',
    nonce: 'nonce',
    nowSeconds: now,
  }).sub, 'user-id');
  assert.throws(() => verifyIdToken({
    token,
    jwks: { keys: [jwk] },
    issuer: 'https://identity.oraclecloud.com/',
    audience: 'wrong-client',
    nonce: 'nonce',
    nowSeconds: now,
  }), /audience/);
});

test('rejects ID tokens that are not active or name another authorized party', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  jwk.kid = 'test-key';
  const now = 1_800_000_000;
  const issue = (claims) => {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: jwk.kid })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: 'https://identity.oraclecloud.com/',
      aud: 'client-id',
      sub: 'user-id',
      nonce: 'nonce',
      iat: now - 1,
      exp: now + 300,
      ...claims,
    })).toString('base64url');
    const signingInput = `${header}.${payload}`;
    const signature = sign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64url');
    return `${signingInput}.${signature}`;
  };
  const verify = (token) => verifyIdToken({
    token,
    jwks: { keys: [jwk] },
    issuer: 'https://identity.oraclecloud.com/',
    audience: 'client-id',
    nonce: 'nonce',
    nowSeconds: now,
  });

  assert.throws(() => verify(issue({ nbf: now + 120 })), /not active/);
  assert.throws(() => verify(issue({ aud: ['client-id', 'other-client'], azp: 'other-client' })), /authorized party/);
  assert.equal(verify(issue({ aud: ['client-id', 'other-client'], azp: 'client-id' })).sub, 'user-id');
});
