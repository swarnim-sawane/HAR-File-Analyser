import { getDatabase } from '../config/database';
import type { PostgresStore } from '../persistence/postgresStore';
import { logInfo, logWarn } from '../config/observability';

export const AI_USAGE_COLLECTION = 'ai_usage_events';
export const AI_USAGE_OPERATIONS = ['chat', 'insights', 'status_probe'] as const;

export type AiUsageOperation = (typeof AI_USAGE_OPERATIONS)[number];
export type AiUsageStatus = 'completed' | 'failed';

export interface OpenAiTokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

export interface OpenAiResponseMetadata {
  responseId?: string;
  model?: string;
  usage?: OpenAiTokenUsage;
}

export interface AiUsagePricing {
  inputUsdPerMillionTokens: number;
  cachedInputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
  cachedInputRateSource: 'configured' | 'input_rate_fallback';
}

export interface AiUsageEventInput {
  requestId: string;
  operation: AiUsageOperation;
  status: AiUsageStatus;
  model: string;
  providerResponseId?: string;
  providerHttpStatus?: number;
  durationMs: number;
  usage?: OpenAiTokenUsage;
  failureCategory?: 'configuration' | 'upstream_http' | 'stream' | 'unknown';
  createdAt?: Date;
}

interface AiUsageEventDocument extends AiUsageEventInput {
  provider: 'openai';
  usageCaptured: boolean;
  pricing: AiUsagePricing | null;
  estimatedCostUsd: number | null;
  createdAt: Date;
}

interface AggregateRow {
  _id: string | null;
  requestCount: number;
  completedRequests: number;
  failedRequests: number;
  usageCapturedRequests: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  costedRequests: number;
}

interface AiUsageAggregateResult {
  totals: AggregateRow[];
  byModel: AggregateRow[];
  byOperation: AggregateRow[];
  byDay: AggregateRow[];
}

export interface AiUsageSummaryQuery {
  from: Date;
  to: Date;
  operation?: AiUsageOperation;
  model?: string;
}

export interface AiUsageSummaryQueryResult {
  value?: AiUsageSummaryQuery;
  error?: string;
}

const DEFAULT_SUMMARY_DAYS = 30;
const MAX_SUMMARY_DAYS = 366;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object'
    ? value as Record<string, unknown>
    : null;
}

function toNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  return Math.floor(value);
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function extractOpenAiResponseMetadata(payload: unknown): OpenAiResponseMetadata {
  const event = asRecord(payload);
  if (!event) return {};

  const response = asRecord(event.response) ?? event;
  const usage = asRecord(response.usage);
  const inputDetails = asRecord(usage?.input_tokens_details);
  const outputDetails = asRecord(usage?.output_tokens_details);

  const inputTokens = toNonNegativeInteger(usage?.input_tokens);
  const cachedInputTokens = toNonNegativeInteger(inputDetails?.cached_tokens);
  const outputTokens = toNonNegativeInteger(usage?.output_tokens);
  const reasoningTokens = toNonNegativeInteger(outputDetails?.reasoning_tokens);
  const reportedTotalTokens = toNonNegativeInteger(usage?.total_tokens);
  const hasUsage = [
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningTokens,
    reportedTotalTokens,
  ].some((value) => value !== undefined);

  const normalizedInputTokens = inputTokens ?? 0;
  const normalizedOutputTokens = outputTokens ?? 0;

  return {
    responseId: readOptionalString(response.id),
    model: readOptionalString(response.model),
    ...(hasUsage
      ? {
          usage: {
            inputTokens: normalizedInputTokens,
            cachedInputTokens: Math.min(cachedInputTokens ?? 0, normalizedInputTokens),
            outputTokens: normalizedOutputTokens,
            reasoningTokens: Math.min(reasoningTokens ?? 0, normalizedOutputTokens),
            totalTokens: reportedTotalTokens ?? normalizedInputTokens + normalizedOutputTokens,
          },
        }
      : {}),
  };
}

function parseRate(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function getAiUsagePricing(
  env: Record<string, string | undefined> = process.env,
): AiUsagePricing | null {
  const inputRate = parseRate(env.OPENAI_INPUT_USD_PER_1M_TOKENS);
  const outputRate = parseRate(env.OPENAI_OUTPUT_USD_PER_1M_TOKENS);
  if (inputRate === null || outputRate === null) return null;

  const cachedRateText = env.OPENAI_CACHED_INPUT_USD_PER_1M_TOKENS?.trim();
  const configuredCachedRate = parseRate(env.OPENAI_CACHED_INPUT_USD_PER_1M_TOKENS);
  if (cachedRateText && configuredCachedRate === null) return null;
  return {
    inputUsdPerMillionTokens: inputRate,
    cachedInputUsdPerMillionTokens: configuredCachedRate ?? inputRate,
    outputUsdPerMillionTokens: outputRate,
    cachedInputRateSource: configuredCachedRate === null ? 'input_rate_fallback' : 'configured',
  };
}

export function estimateOpenAiCostUsd(
  usage: OpenAiTokenUsage,
  pricing: AiUsagePricing,
): number {
  const cachedInputTokens = Math.min(usage.cachedInputTokens, usage.inputTokens);
  const uncachedInputTokens = Math.max(0, usage.inputTokens - cachedInputTokens);
  const estimatedCost = (
    uncachedInputTokens * pricing.inputUsdPerMillionTokens
    + cachedInputTokens * pricing.cachedInputUsdPerMillionTokens
    + usage.outputTokens * pricing.outputUsdPerMillionTokens
  ) / 1_000_000;

  return Number(estimatedCost.toFixed(12));
}

export function isAiUsageTrackingEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.AI_USAGE_TRACKING_ENABLED?.trim().toLowerCase() === 'false') return false;
  return env.NODE_ENV !== 'test' || env.AI_USAGE_TRACKING_ENABLED === 'true';
}

export async function recordAiUsageEvent(
  input: AiUsageEventInput,
  database: PostgresStore = getDatabase(),
): Promise<boolean> {
  if (!isAiUsageTrackingEnabled()) return false;

  const pricing = getAiUsagePricing();
  const estimatedCostUsd = input.usage && pricing
    ? estimateOpenAiCostUsd(input.usage, pricing)
    : null;
  const document: AiUsageEventDocument = {
    ...input,
    provider: 'openai',
    durationMs: Math.max(0, Math.round(input.durationMs)),
    usageCaptured: Boolean(input.usage),
    pricing,
    estimatedCostUsd,
    createdAt: input.createdAt ?? new Date(),
  };

  try {
    await database.query(`
      INSERT INTO ai_usage_events (
        request_id, operation, status, provider, model, response_id, provider_http_status,
        duration_ms, usage_captured, input_tokens, cached_input_tokens, output_tokens,
        reasoning_tokens, total_tokens, estimated_cost_usd, pricing, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17)
      ON CONFLICT (request_id) DO NOTHING
    `, [
      document.requestId,
      document.operation,
      document.status,
      document.provider,
      document.model,
      document.providerResponseId ?? null,
      document.providerHttpStatus ?? null,
      document.durationMs,
      document.usageCaptured,
      document.usage?.inputTokens ?? 0,
      document.usage?.cachedInputTokens ?? 0,
      document.usage?.outputTokens ?? 0,
      document.usage?.reasoningTokens ?? 0,
      document.usage?.totalTokens ?? 0,
      document.estimatedCostUsd,
      document.pricing ? JSON.stringify(document.pricing) : null,
      document.createdAt,
    ]);
    logInfo('ai.usage.recorded', {
      requestId: document.requestId,
      operation: document.operation,
      status: document.status,
      model: document.model,
      providerHttpStatus: document.providerHttpStatus,
      inputUnits: document.usage?.inputTokens ?? null,
      cachedInputUnits: document.usage?.cachedInputTokens ?? null,
      outputUnits: document.usage?.outputTokens ?? null,
      totalUnits: document.usage?.totalTokens ?? null,
      estimatedCostUsd,
    });
    return true;
  } catch (error) {
    logWarn('ai.usage.persistence_failed', {
      requestId: input.requestId,
      operation: input.operation,
      status: input.status,
      error,
    });
    return false;
  }
}

function getSingleQueryValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined;
}

export function parseAiUsageSummaryQuery(
  query: Record<string, unknown>,
  now: Date = new Date(),
): AiUsageSummaryQueryResult {
  const toText = getSingleQueryValue(query.to);
  const fromText = getSingleQueryValue(query.from);
  const to = toText ? new Date(toText) : now;
  const from = fromText
    ? new Date(fromText)
    : new Date(to.getTime() - DEFAULT_SUMMARY_DAYS * 24 * 60 * 60 * 1000);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return { error: 'from and to must be valid ISO-8601 timestamps.' };
  }
  if (from > to) {
    return { error: 'from must be earlier than or equal to to.' };
  }
  if (to.getTime() - from.getTime() > MAX_SUMMARY_DAYS * 24 * 60 * 60 * 1000) {
    return { error: `The requested range cannot exceed ${MAX_SUMMARY_DAYS} days.` };
  }

  const operationText = getSingleQueryValue(query.operation);
  const operation = operationText && AI_USAGE_OPERATIONS.includes(operationText as AiUsageOperation)
    ? operationText as AiUsageOperation
    : undefined;
  if (operationText && !operation) {
    return { error: `operation must be one of: ${AI_USAGE_OPERATIONS.join(', ')}.` };
  }

  const model = getSingleQueryValue(query.model);
  if (model && model.length > 200) {
    return { error: 'model must be 200 characters or fewer.' };
  }

  return {
    value: {
      from,
      to,
      ...(operation ? { operation } : {}),
      ...(model ? { model } : {}),
    },
  };
}

function emptyAggregateRow(id: string | null = null): AggregateRow {
  return {
    _id: id,
    requestCount: 0,
    completedRequests: 0,
    failedRequests: 0,
    usageCapturedRequests: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
    costedRequests: 0,
  };
}

function serializeAggregateRow(row: AggregateRow) {
  return {
    requests: row.requestCount,
    completedRequests: row.completedRequests,
    failedRequests: row.failedRequests,
    usageCapturedRequests: row.usageCapturedRequests,
    usageMissingRequests: row.requestCount - row.usageCapturedRequests,
    inputTokens: row.inputTokens,
    cachedInputTokens: row.cachedInputTokens,
    outputTokens: row.outputTokens,
    reasoningTokens: row.reasoningTokens,
    totalTokens: row.totalTokens,
    estimatedCostUsd: row.costedRequests > 0
      ? Number(row.estimatedCostUsd.toFixed(12))
      : null,
    costedRequests: row.costedRequests,
    unpricedRequests: row.requestCount - row.costedRequests,
  };
}

export async function getAiUsageSummary(
  query: AiUsageSummaryQuery,
  database: PostgresStore = getDatabase(),
) {
  const clauses = ['created_at >= $1', 'created_at <= $2'];
  const values: unknown[] = [query.from, query.to];
  if (query.operation) {
    values.push(query.operation);
    clauses.push(`operation = $${values.length}`);
  }
  if (query.model) {
    values.push(query.model);
    clauses.push(`model = $${values.length}`);
  }
  const where = clauses.join(' AND ');
  const aggregates = `
    COUNT(*)::int AS "requestCount",
    COUNT(*) FILTER (WHERE status='completed')::int AS "completedRequests",
    COUNT(*) FILTER (WHERE status='failed')::int AS "failedRequests",
    COUNT(*) FILTER (WHERE usage_captured)::int AS "usageCapturedRequests",
    COALESCE(SUM(input_tokens),0)::bigint AS "inputTokens",
    COALESCE(SUM(cached_input_tokens),0)::bigint AS "cachedInputTokens",
    COALESCE(SUM(output_tokens),0)::bigint AS "outputTokens",
    COALESCE(SUM(reasoning_tokens),0)::bigint AS "reasoningTokens",
    COALESCE(SUM(total_tokens),0)::bigint AS "totalTokens",
    COALESCE(SUM(estimated_cost_usd),0)::numeric AS "estimatedCostUsd",
    COUNT(*) FILTER (WHERE estimated_cost_usd IS NOT NULL)::int AS "costedRequests"
  `;
  const [totalsResult, modelResult, operationResult, dayResult] = await Promise.all([
    database.query(`SELECT NULL::text AS _id, ${aggregates} FROM ai_usage_events WHERE ${where}`, values),
    database.query(`SELECT model AS _id, ${aggregates} FROM ai_usage_events WHERE ${where} GROUP BY model ORDER BY SUM(total_tokens) DESC`, values),
    database.query(`SELECT operation AS _id, ${aggregates} FROM ai_usage_events WHERE ${where} GROUP BY operation ORDER BY COUNT(*) DESC`, values),
    database.query(`SELECT TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS _id, ${aggregates} FROM ai_usage_events WHERE ${where} GROUP BY 1 ORDER BY 1`, values),
  ]);
  const normalize = (row: Record<string, unknown>): AggregateRow => ({
    _id: row._id == null ? null : String(row._id),
    requestCount: Number(row.requestCount ?? 0),
    completedRequests: Number(row.completedRequests ?? 0),
    failedRequests: Number(row.failedRequests ?? 0),
    usageCapturedRequests: Number(row.usageCapturedRequests ?? 0),
    inputTokens: Number(row.inputTokens ?? 0),
    cachedInputTokens: Number(row.cachedInputTokens ?? 0),
    outputTokens: Number(row.outputTokens ?? 0),
    reasoningTokens: Number(row.reasoningTokens ?? 0),
    totalTokens: Number(row.totalTokens ?? 0),
    estimatedCostUsd: Number(row.estimatedCostUsd ?? 0),
    costedRequests: Number(row.costedRequests ?? 0),
  });
  const aggregateResult: AiUsageAggregateResult = {
    totals: totalsResult.rows.map(normalize),
    byModel: modelResult.rows.map(normalize),
    byOperation: operationResult.rows.map(normalize),
    byDay: dayResult.rows.map(normalize),
  };
  const totals = aggregateResult.totals[0] ?? emptyAggregateRow();
  const currentPricing = getAiUsagePricing();

  return {
    provider: 'openai' as const,
    generatedAt: new Date().toISOString(),
    range: {
      from: query.from.toISOString(),
      to: query.to.toISOString(),
    },
    filters: {
      operation: query.operation ?? null,
      model: query.model ?? null,
    },
    totals: serializeAggregateRow(totals),
    byModel: aggregateResult.byModel.map((row) => ({
      model: row._id,
      ...serializeAggregateRow(row),
    })),
    byOperation: aggregateResult.byOperation.map((row) => ({
      operation: row._id,
      ...serializeAggregateRow(row),
    })),
    byDay: aggregateResult.byDay.map((row) => ({
      date: row._id,
      ...serializeAggregateRow(row),
    })),
    pricing: {
      currency: 'USD',
      estimate: true,
      configured: Boolean(currentPricing),
      currentRatesPerMillionTokens: currentPricing,
      note: currentPricing
        ? 'Estimated cost uses the pricing snapshot stored with each request; compare with the provider invoice for billing.'
        : 'Token usage is tracked, but cost remains unpriced until input and output rates are configured.',
    },
    privacy: {
      promptsStored: false,
      responsesStored: false,
      apiKeysStored: false,
    },
  };
}
