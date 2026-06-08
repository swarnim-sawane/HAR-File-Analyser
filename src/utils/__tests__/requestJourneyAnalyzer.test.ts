import { describe, expect, it } from 'vitest';
import type { Entry } from '../../types/har';
import { makeEntry, makeRequest, makeResponse, makeTimings } from '../../test-utils/fixtures';
import { analyzeJourney } from '../requestJourneyAnalyzer';

const baseTime = Date.parse('2026-04-21T10:30:00.000Z');

type JourneyEntryOptions = {
  offsetMs: number;
  time?: number;
  method?: string;
  url: string;
  status?: number;
  statusText?: string;
  redirectURL?: string;
  mimeType?: string;
  size?: number;
  resourceType?: string;
  initiatorUrl?: string;
};

function buildJourneyEntry({
  offsetMs,
  time = 220,
  method = 'GET',
  url,
  status = 200,
  statusText = status === 200 ? 'OK' : '',
  redirectURL = '',
  mimeType = 'text/html',
  size = 1024,
  resourceType,
  initiatorUrl,
}: JourneyEntryOptions): Entry {
  const entry = makeEntry({
    startedDateTime: new Date(baseTime + offsetMs).toISOString(),
    time,
    request: makeRequest({ method, url }),
    response: makeResponse({
      status,
      statusText,
      redirectURL,
      headers: redirectURL ? [{ name: 'Location', value: redirectURL }] : [],
      content: { size, mimeType },
      bodySize: size,
    }),
    timings: makeTimings({ wait: Math.max(0, time - 80), receive: 20 }),
  }) as Entry & { _resourceType?: string; _initiator?: { url: string } };

  if (resourceType) entry._resourceType = resourceType;
  if (initiatorUrl) entry._initiator = { url: initiatorUrl };

  return entry;
}

function buildDe2LikeJourney(): Entry[] {
  return [
    buildJourneyEntry({
      offsetMs: 0,
      url: 'https://tmobile-ele-phx-vbcs-de2.oci.oracleoutsourcing.com/ic/builder/',
      status: 302,
      statusText: 'Found',
      redirectURL: 'https://idcs-e3ab914.identity.oraclecloud.com/oauth2/v1/authorize?client_id=vbcs',
      resourceType: 'document',
    }),
    buildJourneyEntry({
      offsetMs: 260,
      url: 'https://idcs-e3ab914.identity.oraclecloud.com/oauth2/v1/authorize?client_id=vbcs',
      status: 302,
      statusText: 'Found',
      redirectURL: 'https://login.oci.oraclecloud.com/sso/v1/login',
      resourceType: 'document',
    }),
    buildJourneyEntry({
      offsetMs: 520,
      url: 'https://login.oci.oraclecloud.com/sso/v1/login',
      resourceType: 'document',
    }),
    buildJourneyEntry({
      offsetMs: 760,
      time: 35,
      url: 'https://idcs-e3ab914.identity.oraclecloud.com/favicon.ico',
      status: 401,
      statusText: 'Unauthorized',
      mimeType: 'image/x-icon',
      resourceType: 'image',
    }),
    buildJourneyEntry({
      offsetMs: 940,
      url: 'https://idcs-e3ab914.identity.oraclecloud.com/oauth2/v1/token',
      method: 'POST',
      mimeType: 'application/json',
      resourceType: 'xhr',
    }),
    buildJourneyEntry({
      offsetMs: 1280,
      url: 'https://tmobile-ele-phx-vbcs-de2.oci.oracleoutsourcing.com/cloudgate/v1/oauth2/callback',
      status: 302,
      statusText: 'Found',
      redirectURL: '/ic/builder/',
      resourceType: 'document',
    }),
    buildJourneyEntry({
      offsetMs: 1520,
      time: 450,
      url: 'https://tmobile-ele-phx-vbcs-de2.oci.oracleoutsourcing.com/ic/builder/',
      resourceType: 'document',
    }),
    buildJourneyEntry({
      offsetMs: 2050,
      time: 640,
      url: 'https://static.oracle.com/cdn/jet/js/oj/v17/oj.js',
      mimeType: 'application/javascript',
      size: 8 * 1024 * 1024,
      resourceType: 'script',
      initiatorUrl: 'https://tmobile-ele-phx-vbcs-de2.oci.oracleoutsourcing.com/ic/builder/',
    }),
    buildJourneyEntry({
      offsetMs: 2150,
      time: 180,
      url: 'https://static.oracle.com/cdn/jet/css/redwood.css',
      mimeType: 'text/css',
      size: 1200 * 1024,
      resourceType: 'stylesheet',
      initiatorUrl: 'https://tmobile-ele-phx-vbcs-de2.oci.oracleoutsourcing.com/ic/builder/',
    }),
    buildJourneyEntry({
      offsetMs: 2400,
      time: 24,
      url: 'https://login.oci.oraclecloud.com/assets/logo.svg',
      status: 0,
      statusText: '',
      mimeType: 'image/svg+xml',
      size: 0,
      resourceType: 'image',
      initiatorUrl: 'https://login.oci.oraclecloud.com/sso/v1/login',
    }),
    buildJourneyEntry({
      offsetMs: 2600,
      time: 80,
      url: 'https://consent.truste.com/notice?domain=oracle.com',
      status: 0,
      statusText: '',
      mimeType: 'application/javascript',
      size: 0,
      resourceType: 'script',
    }),
    buildJourneyEntry({
      offsetMs: 3100,
      time: 59967,
      url: 'https://tmobile-ele-phx-vbcs-de2.oci.oracleoutsourcing.com/ic/builder/event',
      status: 101,
      statusText: 'Switching Protocols',
      mimeType: '',
      resourceType: 'websocket',
      initiatorUrl: 'https://tmobile-ele-phx-vbcs-de2.oci.oracleoutsourcing.com/ic/builder/',
    }),
    buildJourneyEntry({
      offsetMs: 66000,
      url: 'https://tmobile-ele-phx-vbcs-de2.oci.oracleoutsourcing.com/ic/builder/logout',
      status: 302,
      statusText: 'Found',
      redirectURL: '/cloudgate/logout.html',
      resourceType: 'document',
    }),
    buildJourneyEntry({
      offsetMs: 66300,
      url: 'https://idcs-e3ab914.identity.oraclecloud.com/sso/v1/user/logout',
      status: 303,
      statusText: 'See Other',
      redirectURL: 'https://tmobile-ele-phx-vbcs-de2.oci.oracleoutsourcing.com/ic/builder',
      resourceType: 'document',
    }),
    buildJourneyEntry({
      offsetMs: 66600,
      url: 'https://tmobile-ele-phx-vbcs-de2.oci.oracleoutsourcing.com/cloudgate/v1/oauth2/logout',
      status: 404,
      statusText: 'Not Found',
      resourceType: 'document',
    }),
  ];
}

describe('analyzeJourney', () => {
  it('groups a DE2-like trace into causal journey phases', () => {
    const journey = analyzeJourney(buildDe2LikeJourney());

    expect(journey.phases.map((phase) => phase.kind)).toEqual([
      'initial',
      'auth',
      'callback',
      'app-boot',
      'static',
      'consent',
      'persistent',
      'logout',
    ]);

    expect(journey.domainCount).toBe(5);
    expect(journey.requestCount).toBe(15);
    expect(journey.errorCount).toBe(1);
    expect(journey.slowCount).toBe(0);
  });

  it('treats identity and login requests as one authentication phase', () => {
    const authPhase = analyzeJourney(buildDe2LikeJourney()).phases.find(
      (phase) => phase.kind === 'auth'
    );

    expect(authPhase).toBeDefined();
    expect(authPhase?.title).toBe('Identity / authentication');
    expect(authPhase?.domains).toEqual(
      expect.arrayContaining([
        'idcs-e3ab914.identity.oraclecloud.com',
        'login.oci.oraclecloud.com',
      ])
    );
    expect(authPhase?.requests.some((request) => request.url.includes('/oauth2/v1/authorize'))).toBe(true);
    expect(authPhase?.stats.errorCount).toBe(0);
    expect(authPhase?.issues.some((issue) => issue.title.toLowerCase().includes('favicon'))).toBe(false);
  });

  it('surfaces callback, static dependencies, consent background, and logout issues', () => {
    const journey = analyzeJourney(buildDe2LikeJourney());
    const callbackPhase = journey.phases.find((phase) => phase.kind === 'callback');
    const staticPhase = journey.phases.find((phase) => phase.kind === 'static');
    const consentPhase = journey.phases.find((phase) => phase.kind === 'consent');
    const logoutPhase = journey.phases.find((phase) => phase.kind === 'logout');

    expect(callbackPhase?.summary).toMatch(/returned control/i);
    expect(staticPhase?.domains).toEqual(['static.oracle.com']);
    expect(staticPhase?.issues.map((issue) => issue.title).join(' ')).toMatch(/static load/i);
    expect(staticPhase?.stats.bytes).toBeGreaterThan(9 * 1024 * 1024);
    expect(consentPhase?.stats.status0Count).toBe(1);
    expect(consentPhase?.stats.errorCount).toBe(0);
    expect(consentPhase?.issues.map((issue) => issue.title).join(' ')).toMatch(/1 consent request cancelled/i);
    expect(logoutPhase?.stats.redirectCount).toBe(2);
    expect(logoutPhase?.stats.errorCount).toBe(1);
    expect(logoutPhase?.issues.map((issue) => issue.title).join(' ')).toMatch(/logout returned 404/i);
  });

  it('classifies long 101 event requests as persistent connections instead of slow errors', () => {
    const persistentPhase = analyzeJourney(buildDe2LikeJourney()).phases.find(
      (phase) => phase.kind === 'persistent'
    );

    expect(persistentPhase).toBeDefined();
    expect(persistentPhase?.title).toBe('Persistent connection');
    expect(persistentPhase?.requests).toHaveLength(1);
    expect(persistentPhase?.requests[0]).toMatchObject({
      status: 101,
      isPersistent: true,
      isSlow: false,
      failed: false,
    });
    expect(persistentPhase?.stats.slowCount).toBe(0);
    expect(persistentPhase?.stats.errorCount).toBe(0);
    expect(persistentPhase?.issues.some((issue) => issue.level === 'info')).toBe(true);
  });
});
