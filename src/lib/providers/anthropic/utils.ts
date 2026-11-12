const MODELS_CACHE_TTL_MS = 60 * 60 * 1000;
const ANTHROPIC_VERSION = '2023-06-01';

type ModelsCacheEntry = {
  models: string[];
  expiresAt: number;
};

const modelsCache = new Map<string, ModelsCacheEntry>();

export const ANTHROPIC_LLM_FALLBACK_MODELS = [
  'claude-sonnet-5-5',
  'claude-haiku-5-5',
  'claude-opus-5-5',
  'claude-sonnet-5',
  'claude-opus-5',
  'claude-haiku-4-5',
  'claude-sonnet-4-6',
  'claude-opus-4-6',
] as const;

async function getAnthropicModels(apiKey: string): Promise<string[]> {
  const cached = modelsCache.get(apiKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.models;
  }

  const response = await fetch('https://api.anthropic.com/v1/models?limit=100', {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to list models (${response.status})`);
  }

  const data = (await response.json()) as { data?: { id: string }[] };
  const models = (data.data ?? []).map(m => m.id);
  modelsCache.set(apiKey, { models, expiresAt: Date.now() + MODELS_CACHE_TTL_MS });
  return models;
}

export async function fetchModels(apiKey: string): Promise<string[]> {
  if (!apiKey) {
    return [...ANTHROPIC_LLM_FALLBACK_MODELS];
  }

  const fetched = await getAnthropicModels(apiKey);
  return fetched.length > 0 ? fetched : [...ANTHROPIC_LLM_FALLBACK_MODELS];
}
