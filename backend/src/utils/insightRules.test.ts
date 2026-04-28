import { describe, expect, it } from 'vitest';
import {
  buildDeterministicInsights,
  mergeDeterministicInsights,
  type InsightSection,
} from './insightRules';

const CORS_CONTEXT = [
  'CONSOLE LOG SUMMARY: total:3 log:1 error:1 warn:1',
  "CORS / PREFLIGHT BLOCKING ERRORS (1 total - analyse before warnings):",
  "CORS_BLOCKED endpoint=https://ords.consolenergy.com/ords/pdbttest/mpr/mpr_module/ceix_mine_location_lov origin=https://vbcs.example.oraclecloud.com missing_header=Access-Control-Allow-Origin preflight=true message=Access to fetch at 'https://ords.consolenergy.com/ords/pdbttest/mpr/mpr_module/ceix_mine_location_lov' from origin 'https://vbcs.example.oraclecloud.com' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: No 'Access-Control-Allow-Origin' header is present on the requested resource.",
  'CORS_SYMPTOM TypeError: Failed to fetch',
  'LOW-PRIORITY WARNINGS (1 total, showing 1):',
  'WARN [oraclejet.js]: ArrayDataProvider constructor option keyAttributes is deprecated.',
].join('\n');

describe('deterministic CORS insight rules', () => {
  it('builds a high-priority ORDS/proxy CORS finding from explicit console evidence', () => {
    const sections = buildDeterministicInsights(CORS_CONTEXT, 'console');
    const finding = sections[0]?.findings[0];

    expect(finding).toMatchObject({
      severity: 'high',
      product: 'ORDS',
      component: 'ORDS/proxy CORS',
    });
    expect(finding.title).toMatch(/CORS preflight blocked/i);
    expect(finding.why).toMatch(/root cause/i);
    expect(finding.why).toMatch(/TypeError: Failed to fetch/i);
    expect(finding.evidence).toContain('https://ords.consolenergy.com/ords/pdbttest/mpr/mpr_module/ceix_mine_location_lov');
    expect(finding.evidence).toContain('https://vbcs.example.oraclecloud.com');
    expect(finding.evidence).toContain('Access-Control-Allow-Origin');
    expect(finding.fix).toMatch(/ORDS/i);
    expect(finding.fix).toMatch(/OPTIONS/i);
  });

  it('keeps deterministic CORS findings ahead of model deprecation findings', () => {
    const modelSections: InsightSection[] = [
      {
        type: 'critical_issues',
        title: 'Critical Issues',
        findings: [
          {
            severity: 'medium',
            title: 'ArrayDataProvider deprecation warning',
            product: 'VBCS',
            component: 'Oracle JET',
            what: 'A deprecation warning is present.',
            why: 'The app uses a deprecated ArrayDataProvider option.',
            evidence: 'ArrayDataProvider keyAttributes deprecation warning',
            fix: 'Update the Oracle JET ArrayDataProvider configuration in the VBCS page module.',
          },
        ],
      },
    ];

    const merged = mergeDeterministicInsights(modelSections, buildDeterministicInsights(CORS_CONTEXT, 'console'));

    expect(merged[0].findings[0].title).toMatch(/CORS preflight blocked/i);
    expect(merged[0].findings[1].title).toMatch(/ArrayDataProvider/i);
  });
});
