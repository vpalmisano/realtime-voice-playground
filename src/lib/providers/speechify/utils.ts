import { SpeechifyClient } from '@speechify/api';

const CACHE_TTL_MS = 60 * 60 * 1000;

export const SPEECHIFY_TTS_FALLBACK_MODELS = ['simba-3.5', 'simba-3.2', 'simba-3.0'] as const;

export const SPEECHIFY_VOICES = [{ name: 'Geffen', id: 'geffen_32' }] as const;

type ModelsCacheEntry = {
  models: string[];
  expiresAt: number;
};

type VoicesCacheEntry = {
  voices: { name: string; id: string }[];
  expiresAt: number;
};

const modelsCache = new Map<string, ModelsCacheEntry>();
const voicesCache = new Map<string, VoicesCacheEntry>();

export async function fetchModels(apiKey: string): Promise<string[]> {
  if (!apiKey) {
    return [...SPEECHIFY_TTS_FALLBACK_MODELS];
  }

  const cached = modelsCache.get(apiKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.models;
  }

  const client = new SpeechifyClient({ token: apiKey });
  const response = await client.models.list();
  const ids = response.models.map(model => model.id).filter(Boolean);
  const models = ids.length ? ids : [...SPEECHIFY_TTS_FALLBACK_MODELS];
  modelsCache.set(apiKey, { models, expiresAt: Date.now() + CACHE_TTL_MS });
  return models;
}

export async function fetchVoices(
  apiKey: string,
  model?: string,
): Promise<{ name: string; id: string }[]> {
  if (!apiKey) {
    return SPEECHIFY_VOICES.map(v => ({ name: v.name, id: v.id }));
  }

  const cacheKey = `${apiKey}:${model ?? ''}`;
  const cached = voicesCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.voices;
  }

  const client = new SpeechifyClient({ token: apiKey });
  const voices: { name: string; id: string }[] = [];
  const page = await client.voices.list({
    model,
    locale: 'en',
    limit: 200,
  });
  for await (const voice of page) {
    voices.push({ name: voice.display_name, id: voice.id });
  }
  const result = voices.length ? voices : SPEECHIFY_VOICES.map(v => ({ name: v.name, id: v.id }));
  voicesCache.set(cacheKey, { voices: result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}
