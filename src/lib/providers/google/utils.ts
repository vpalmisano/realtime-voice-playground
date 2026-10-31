import { GoogleGenAI, type Model } from '@google/genai';

const MODELS_CACHE_TTL_MS = 60 * 60 * 1000;

type ModelsCacheEntry = {
  models: Model[];
  expiresAt: number;
};

const modelsCache = new Map<string, ModelsCacheEntry>();

export type GoogleModelMode = 'realtime' | 'llm' | 'stt' | 'tts';

export const GOOGLE_REALTIME_FALLBACK_MODELS = [
  'gemini-3.8-live',
  'gemini-3.8-live-extended-thinking',
  'gemini-3.1-flash-live-preview',
  'gemini-2.5-flash-native-audio-preview-12-2025',
] as const;

export const GOOGLE_LLM_FALLBACK_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.1-pro-preview',
  'gemini-3-flash-preview',
] as const;

export const GOOGLE_STT_FALLBACK_MODELS = ['gemini-3.5-transcribe-live'] as const;

export const GOOGLE_TTS_FALLBACK_MODELS = [
  'gemini-3.8-flash-tts',
  'gemini-3.8-flash-lite-tts',
  'gemini-3.1-flash-tts-preview',
] as const;

export const GOOGLE_VOICES = [
  'Achernar',
  'Achird',
  'Algenib',
  'Algieba',
  'Alnilam',
  'Aoede',
  'Autonoe',
  'Callirrhoe',
  'Charon',
  'Despina',
  'Enceladus',
  'Erinome',
  'Fenrir',
  'Gacrux',
  'Iapetus',
  'Kore',
  'Laomedeia',
  'Leda',
  'Orus',
  'Puck',
  'Pulcherrima',
  'Rasalgethi',
  'Sadachbia',
  'Sadaltager',
  'Schedar',
  'Sulafat',
  'Umbriel',
  'Vindemiatrix',
  'Zephyr',
  'Zubenelgenubi',
] as const;

function modelId(model: Model): string {
  return (model.name ?? '').replace(/^models\//, '');
}

function isGoogleRealtimeModel(model: Model) {
  return model.supportedActions?.includes('bidiGenerateContent') ?? false;
}

function isGoogleLlmModel(model: Model) {
  const actions = model.supportedActions ?? [];
  if (!actions.includes('generateContent')) return false;
  if (actions.includes('bidiGenerateContent')) return false;

  const id = modelId(model).toLowerCase();
  if (/^gemini-2(\.|$)/.test(id)) return false;
  if (/embed|imagen|image|tts|aqa|robotics|veo|lyria|native-audio|live|transcri/.test(id)) {
    return false;
  }
  return true;
}

function isGoogleSttModel(model: Model) {
  const id = modelId(model).toLowerCase();
  return id.includes('transcribe') && (id.includes('live') || isGoogleRealtimeModel(model));
}

function isGoogleTtsModel(model: Model) {
  const id = modelId(model).toLowerCase();
  return id.includes('tts');
}

async function getGoogleModels(apiKey: string): Promise<Model[]> {
  const cached = modelsCache.get(apiKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.models;
  }

  const ai = new GoogleGenAI({ apiKey });
  const pager = await ai.models.list();
  const models: Model[] = [];
  for await (const model of pager) {
    models.push(model);
  }

  modelsCache.set(apiKey, { models, expiresAt: Date.now() + MODELS_CACHE_TTL_MS });
  return models;
}

function filterForMode(mode: GoogleModelMode) {
  switch (mode) {
    case 'realtime':
      return isGoogleRealtimeModel;
    case 'stt':
      return isGoogleSttModel;
    case 'tts':
      return isGoogleTtsModel;
    default:
      return isGoogleLlmModel;
  }
}

function fallbackForMode(mode: GoogleModelMode) {
  switch (mode) {
    case 'realtime':
      return GOOGLE_REALTIME_FALLBACK_MODELS;
    case 'stt':
      return GOOGLE_STT_FALLBACK_MODELS;
    case 'tts':
      return GOOGLE_TTS_FALLBACK_MODELS;
    default:
      return GOOGLE_LLM_FALLBACK_MODELS;
  }
}

export async function fetchModels(apiKey: string, mode: GoogleModelMode): Promise<string[]> {
  const filter = filterForMode(mode);
  const fallback = fallbackForMode(mode);

  if (!apiKey) {
    return [...fallback];
  }

  const fetched = (await getGoogleModels(apiKey)).filter(filter).map(modelId).filter(Boolean);
  return fetched.length > 0 ? fetched : [...fallback];
}

export async function fetchVoices(): Promise<string[]> {
  return [...GOOGLE_VOICES];
}
