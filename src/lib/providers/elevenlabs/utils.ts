import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

const CACHE_TTL_MS = 60 * 60 * 1000;

export type ElevenLabsModelMode = 'realtime' | 'stt' | 'tts';

type ElevenLabsModel = {
  modelId: string;
  canDoTextToSpeech?: boolean;
};

export const ELEVENLABS_TTS_FALLBACK_MODELS = [
  'eleven_flash_v2_5',
  'eleven_turbo_v2_5',
  'eleven_multilingual_v2',
] as const;

export const ELEVENLABS_STT_FALLBACK_MODELS = ['scribe_v2_realtime'] as const;

export const ELEVENLABS_REALTIME_FALLBACK_MODELS = [
  'eleven_realtime_v1_mini',
  'eleven_realtime_v1_max',
] as const;

/** Premade voices used when the API key is missing or the voices request fails. */
export const ELEVENLABS_VOICES = [
  { name: 'Rachel', id: '21m00Tcm4TlvDq8ikWAM' },
  { name: 'Adam', id: 'pNInz6obpgDQGcFmaJgB' },
  { name: 'Bella', id: 'EXAVITQuSeLhmc4a2' },
  { name: 'Antoni', id: 'ErXwobaYiN019PkySvjV' },
  { name: 'Elli', id: 'MF3mGyEYCl7XYWbV9V6O' },
  { name: 'Josh', id: 'TxGEqnHWrfWFTfGW9XjX' },
  { name: 'Arnold', id: 'VR6AewLTigWG4xSOukaG' },
  { name: 'Sam', id: 'yoZ06aMxZJJ28mfd3POQ' },
  { name: 'Brian', id: 'brian' },
] as const;

type ModelsCacheEntry = {
  models: ElevenLabsModel[];
  expiresAt: number;
};

type VoicesCacheEntry = {
  voices: { name: string; id: string }[];
  expiresAt: number;
};

const modelsCache = new Map<string, ModelsCacheEntry>();
const voicesCache = new Map<string, VoicesCacheEntry>();

function isTtsModel(model: ElevenLabsModel) {
  if (!model.canDoTextToSpeech) return false;
  const id = model.modelId.toLowerCase();
  return !/scribe|realtime/.test(id);
}

function isSttModel(model: ElevenLabsModel) {
  const id = model.modelId.toLowerCase();
  return id.includes('scribe') && id.includes('realtime');
}

function isRealtimeModel(model: ElevenLabsModel) {
  const id = model.modelId.toLowerCase();
  return /eleven_realtime|realtime_v1/.test(id) && !id.includes('scribe');
}

function filterForMode(mode: ElevenLabsModelMode) {
  switch (mode) {
    case 'stt':
      return isSttModel;
    case 'realtime':
      return isRealtimeModel;
    default:
      return isTtsModel;
  }
}

function fallbackForMode(mode: ElevenLabsModelMode) {
  switch (mode) {
    case 'stt':
      return ELEVENLABS_STT_FALLBACK_MODELS;
    case 'realtime':
      return ELEVENLABS_REALTIME_FALLBACK_MODELS;
    default:
      return ELEVENLABS_TTS_FALLBACK_MODELS;
  }
}

async function getModels(apiKey: string): Promise<ElevenLabsModel[]> {
  const cached = modelsCache.get(apiKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.models;
  }

  const client = new ElevenLabsClient({ apiKey });
  const models = await client.models.list();
  modelsCache.set(apiKey, { models, expiresAt: Date.now() + CACHE_TTL_MS });
  return models;
}

export async function fetchModels(apiKey: string, mode: ElevenLabsModelMode): Promise<string[]> {
  const filter = filterForMode(mode);
  const fallback = fallbackForMode(mode);

  if (!apiKey) {
    return [...fallback];
  }

  const fetched = (await getModels(apiKey))
    .filter(filter)
    .map(m => m.modelId)
    .filter(Boolean);
  return fetched.length > 0 ? fetched : [...fallback];
}

export async function fetchVoices(apiKey: string): Promise<{ name: string; id: string }[]> {
  if (!apiKey) {
    return ELEVENLABS_VOICES.map(v => ({ name: v.name, id: v.id }));
  }

  const cached = voicesCache.get(apiKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.voices;
  }

  const client = new ElevenLabsClient({ apiKey });
  const voices: { name: string; id: string }[] = [];
  let nextPageToken: string | undefined;
  do {
    const page = await client.voices.search({
      pageSize: 100,
      nextPageToken,
      sort: 'name',
      sortDirection: 'asc',
    });
    for (const voice of page.voices) {
      if (!voice.voiceId) continue;
      voices.push({ name: voice.name || voice.voiceId, id: voice.voiceId });
    }
    nextPageToken = page.hasMore ? page.nextPageToken : undefined;
  } while (nextPageToken);

  const result = voices.length ? voices : ELEVENLABS_VOICES.map(v => ({ name: v.name, id: v.id }));
  voicesCache.set(apiKey, { voices: result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}
