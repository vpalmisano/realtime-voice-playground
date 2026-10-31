const MODELS_CACHE_TTL_MS = 60 * 60 * 1000;

type ModelsCacheEntry = {
  models: { id: string; created: number }[];
  expiresAt: number;
};

const modelsCache = new Map<string, ModelsCacheEntry>();

export type OpenAIModelMode = 'realtime' | 'chat' | 'stt' | 'transcription' | 'tts';

export const OPENAI_REALTIME_FALLBACK_MODELS = [
  'gpt-live-1',
  'gpt-realtime-2.1',
  'gpt-realtime-2.1-mini',
  'gpt-realtime-2',
  'gpt-realtime-1.5',
  'gpt-realtime',
  'gpt-realtime-mini',
] as const;

export const OPENAI_CHAT_FALLBACK_MODELS = [
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.2',
  'gpt-5-mini',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4o',
  'gpt-4o-mini',
] as const;

export const OPENAI_STT_FALLBACK_MODELS = [
  'gpt-transcribe',
  'gpt-4o-transcribe',
  'gpt-4o-mini-transcribe',
  'whisper-1',
] as const;

/** Transcription models usable inside a realtime session (includes client-VAD models). */
export const OPENAI_TRANSCRIPTION_FALLBACK_MODELS = [
  'gpt-live-transcribe',
  'gpt-transcribe',
  'gpt-4o-transcribe',
  'gpt-4o-mini-transcribe',
  'whisper-1',
] as const;

export const OPENAI_TTS_FALLBACK_MODELS = ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'] as const;

export const OPENAI_VOICES = [
  'marin',
  'cedar',
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'fable',
  'onyx',
  'nova',
  'sage',
  'shimmer',
  'verse',
] as const;

function isOpenAIRealtimeModel(id: string) {
  const lower = id.toLowerCase();
  if (/transcribe|transcription|translate|whisper/.test(lower)) return false;
  return /realtime|gpt-live/.test(lower);
}

function isOpenAIChatModel(id: string) {
  const lower = id.toLowerCase();
  if (
    /realtime|transcribe|transcription|translate|whisper|tts|audio|embedding|moderation|image|dall-e|gpt-live/.test(
      lower,
    )
  ) {
    return false;
  }
  return /^(gpt-|o[1-9]|chatgpt)/.test(lower);
}

function isOpenAISttModel(id: string) {
  const lower = id.toLowerCase();
  // Exclude models that require client VAD (no server_vad support).
  if (/gpt-live-transcribe|gpt-realtime-whisper/.test(lower)) return false;
  return /transcribe|whisper/.test(lower) && !/diarize|translate/.test(lower);
}

function isOpenAITranscriptionModel(id: string) {
  const lower = id.toLowerCase();
  return /transcribe|whisper/.test(lower) && !/diarize|translate/.test(lower);
}

function isOpenAITtsModel(id: string) {
  const lower = id.toLowerCase();
  return /(^tts-|^gpt-4o-mini-tts)/.test(lower);
}

function filterForMode(mode: OpenAIModelMode) {
  switch (mode) {
    case 'realtime':
      return isOpenAIRealtimeModel;
    case 'stt':
      return isOpenAISttModel;
    case 'transcription':
      return isOpenAITranscriptionModel;
    case 'tts':
      return isOpenAITtsModel;
    default:
      return isOpenAIChatModel;
  }
}

function fallbackForMode(mode: OpenAIModelMode) {
  switch (mode) {
    case 'realtime':
      return OPENAI_REALTIME_FALLBACK_MODELS;
    case 'stt':
      return OPENAI_STT_FALLBACK_MODELS;
    case 'transcription':
      return OPENAI_TRANSCRIPTION_FALLBACK_MODELS;
    case 'tts':
      return OPENAI_TTS_FALLBACK_MODELS;
    default:
      return OPENAI_CHAT_FALLBACK_MODELS;
  }
}

async function getOpenAIModels(apiKey: string): Promise<{ id: string; created: number }[]> {
  const cached = modelsCache.get(apiKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.models;
  }

  const response = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    throw new Error(`Failed to list models (${response.status})`);
  }

  const data = (await response.json()) as { data?: { id: string; created: number }[] };
  const models = [...(data.data ?? [])].sort((a, b) => b.created - a.created);
  modelsCache.set(apiKey, { models, expiresAt: Date.now() + MODELS_CACHE_TTL_MS });
  return models;
}

export async function fetchModels(apiKey: string, mode: OpenAIModelMode): Promise<string[]> {
  const filter = filterForMode(mode);
  const fallback = fallbackForMode(mode);

  if (!apiKey) {
    return [...fallback];
  }

  const fetched = (await getOpenAIModels(apiKey)).filter(m => filter(m.id)).map(m => m.id);
  return fetched.length > 0 ? fetched : [...fallback];
}

export async function fetchVoices(): Promise<string[]> {
  return [...OPENAI_VOICES];
}
