import Cartesia from '@cartesia/cartesia-js';

const CACHE_TTL_MS = 60 * 60 * 1000;

export const CARTESIA_TTS_FALLBACK_MODELS = [
  'sonic-latest',
  'sonic-3.6',
  'sonic-3.5',
  'sonic-3',
] as const;

export const CARTESIA_VOICES = [
  { name: 'Katie', id: 'f786b574-daa5-4673-aa0c-cbe3e8534c02' },
] as const;

type ModelsCacheEntry = {
  models: string[];
  expiresAt: number;
};

type VoicesCacheEntry = {
  voices: { name: string; id: string }[];
  expiresAt: number;
};

type ModelsListResponse = {
  data?: { id: string; capability: string }[];
};

const modelsCache = new Map<string, ModelsCacheEntry>();
const voicesCache = new Map<string, VoicesCacheEntry>();

export async function fetchModels(apiKey: string): Promise<string[]> {
  if (!apiKey) {
    return [...CARTESIA_TTS_FALLBACK_MODELS];
  }

  const cached = modelsCache.get(apiKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.models;
  }

  const client = new Cartesia({ apiKey });
  const response = (await client.get('/models', {
    query: { capability: 'tts' },
  })) as ModelsListResponse;
  const ids = (response.data ?? []).map(model => model.id).filter(Boolean);
  const models = ids.length ? ids : [...CARTESIA_TTS_FALLBACK_MODELS];
  modelsCache.set(apiKey, { models, expiresAt: Date.now() + CACHE_TTL_MS });
  return models;
}

export async function fetchVoices(apiKey: string): Promise<{ name: string; id: string }[]> {
  if (!apiKey) {
    return CARTESIA_VOICES.map(v => ({ name: v.name, id: v.id }));
  }

  const cached = voicesCache.get(apiKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.voices;
  }

  const client = new Cartesia({ apiKey });
  const voices: { name: string; id: string }[] = [];
  for await (const voice of client.voices.list({ limit: 100 })) {
    voices.push({ name: voice.name, id: voice.id });
  }
  const result = voices.length ? voices : CARTESIA_VOICES.map(v => ({ name: v.name, id: v.id }));
  voicesCache.set(apiKey, { voices: result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}
