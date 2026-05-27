import { describe, expect, it } from 'vitest';
import { buildOpenApiDocument, renderOpenApiDocsHtml } from './openapiSpec';

describe('OpenAPI document', () => {
  it('describes the existing REST API surface for automation consumers', () => {
    const document = buildOpenApiDocument('https://har-analyzer.example.com');

    expect(document.openapi).toBe('3.0.3');
    expect(document.info.title).toBe('HAR File Analyzer API');
    expect(document.servers).toContainEqual({ url: 'https://har-analyzer.example.com' });

    expect(Object.keys(document.paths)).toEqual(expect.arrayContaining([
      '/health',
      '/api/upload/chunk',
      '/api/upload/complete',
      '/api/upload/progress/{fileId}',
      '/api/har/{fileId}',
      '/api/har/{fileId}/status',
      '/api/har/{fileId}/entries',
      '/api/har/{fileId}/entries/{index}',
      '/api/har/{fileId}/stats',
      '/api/har/{fileId}/search',
      '/api/v1/har/{fileId}/summary',
      '/api/v1/har/{fileId}/errors',
      '/api/v1/har/{fileId}/insights/context',
      '/api/v1/har/{fileId}/insights',
      '/api/sanitize/{fileId}/scan',
      '/api/sanitize/{fileId}',
      '/api/console-log/{fileId}/status',
      '/api/console-log/{fileId}/entries',
      '/api/console-log/{fileId}/entries/{index}',
      '/api/console-log/{fileId}/stats',
      '/api/console-log/{fileId}/search',
      '/api/ai/status',
      '/api/ai/insights',
      '/api/ai/chat',
    ]));

    expect(document.paths['/api/ai/insights'].post.operationId).toBe('generateAiInsights');
    expect(document.paths['/api/v1/har/{fileId}/summary'].get.operationId).toBe('getHarAutomationSummary');
    expect(document.paths['/api/v1/har/{fileId}/summary'].get.responses['202']).toBeDefined();
    expect(document.paths['/api/v1/har/{fileId}/errors'].get.operationId).toBe('listHarAutomationErrors');
    expect(document.paths['/api/v1/har/{fileId}/insights/context'].get.operationId).toBe('getHarAutomationInsightContext');
    expect(document.paths['/api/v1/har/{fileId}/insights'].post.operationId).toBe('generateHarAutomationInsights');
    expect(document.components.schemas.AutomationHarInsightsResponse).toBeDefined();
    expect(document.paths['/api/upload/chunk'].post.requestBody.content['multipart/form-data']).toBeDefined();
    expect(document.paths['/api/har/{fileId}/entries'].get.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'fileId', in: 'path', required: true }),
        expect.objectContaining({ name: 'page', in: 'query' }),
        expect.objectContaining({ name: 'limit', in: 'query' }),
      ]),
    );
  });

  it('renders a lightweight docs page pointing to the machine-readable spec', () => {
    const html = renderOpenApiDocsHtml('/openapi.json');

    expect(html).toContain('HAR File Analyzer API');
    expect(html).toContain('/openapi.json');
    expect(html).toContain('OCI automation');
    expect(html).toContain('Enterprise quick start');
    expect(html).toContain('Runtime And Data Handling Notes');
    expect(html).toContain('Recommended Integration Flow');
    expect(html).toContain('HAR Automation Workflow');
    expect(html).toContain('/api/v1/har/{fileId}/summary');
    expect(html).toContain('/api/v1/har/{fileId}/errors');
    expect(html).toContain('/api/v1/har/{fileId}/insights/context');
    expect(html).toContain('/api/v1/har/{fileId}/insights');
    expect(html).toContain('deterministic fallback');
    expect(html).toContain('PowerShell Smoke Test');
    expect(html).toContain('Required Local Services');
    expect(html).toContain('202 Accepted');
  });
});
