import { describe, expect, it } from 'vitest';
import { getOpenAiConfig, getOpenAiConfigurationError } from './openAiConfig';

describe('OpenAI configuration', () => {
  it('uses the public OpenAI v1 endpoint by default', () => {
    expect(getOpenAiConfig({
      OPENAI_API_KEY: 'test-key',
      OPENAI_MODEL: 'approved-model',
    })).toEqual({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      model: 'approved-model',
    });
  });

  it('normalizes an approved OpenAI-compatible gateway URL', () => {
    expect(getOpenAiConfig({
      OPENAI_BASE_URL: 'https://gateway.example.com/v1/',
      OPENAI_API_KEY: 'test-key',
      OPENAI_MODEL: 'approved-model',
    })?.baseUrl).toBe('https://gateway.example.com/v1');
  });

  it('requires both the API key and explicitly approved model', () => {
    expect(getOpenAiConfig({ OPENAI_API_KEY: 'test-key' })).toBeNull();
    expect(getOpenAiConfigurationError({ OPENAI_API_KEY: 'test-key' }))
      .toMatch(/OPENAI_API_KEY or OPENAI_MODEL/i);
  });

  it('rejects a non-HTTPS endpoint', () => {
    expect(() => getOpenAiConfig({
      OPENAI_BASE_URL: 'http://insecure.example.com/v1',
      OPENAI_API_KEY: 'test-key',
      OPENAI_MODEL: 'approved-model',
    })).toThrow(/HTTPS/i);
  });
});
