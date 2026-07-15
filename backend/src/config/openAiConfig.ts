const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

type OpenAiEnv = Record<string, string | undefined>;

export interface OpenAiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

function normalizeBaseUrl(value: string | undefined): string {
  const baseUrl = (value || DEFAULT_OPENAI_BASE_URL).trim().replace(/\/+$/, '');

  if (!/^https:\/\//i.test(baseUrl)) {
    throw new Error('OPENAI_BASE_URL must use HTTPS.');
  }

  return baseUrl;
}

/**
 * Returns the configured OpenAI service without ever logging or exposing the API key.
 * The model remains explicit because governed keys can have different model allow-lists.
 */
export function getOpenAiConfig(env: OpenAiEnv = process.env): OpenAiConfig | null {
  const apiKey = env.OPENAI_API_KEY?.trim();
  const model = env.OPENAI_MODEL?.trim();

  if (!apiKey || !model) return null;

  return {
    baseUrl: normalizeBaseUrl(env.OPENAI_BASE_URL),
    apiKey,
    model,
  };
}

export function getOpenAiConfigurationError(env: OpenAiEnv = process.env): string {
  if (!env.OPENAI_API_KEY?.trim() || !env.OPENAI_MODEL?.trim()) {
    return 'OpenAI is not configured (missing OPENAI_API_KEY or OPENAI_MODEL).';
  }

  try {
    normalizeBaseUrl(env.OPENAI_BASE_URL);
  } catch (error) {
    return error instanceof Error ? error.message : 'OPENAI_BASE_URL is invalid.';
  }

  return '';
}
