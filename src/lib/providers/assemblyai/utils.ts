const CACHE_TTL_MS = 60 * 60 * 1000;

export const ASSEMBLYAI_STT_FALLBACK_MODELS = [
  'universal-3-6-pro',
  'universal-3-6',
  'universal-3-5-pro',
  'universal-streaming-multilingual',
  'universal-streaming-english',
] as const;

export const ASSEMBLYAI_TTS_FALLBACK_MODELS = ['assemblyai-tts-1'] as const;

export type AssemblyAIVoice = { name: string; id: string };

export const ASSEMBLYAI_TTS_VOICES: readonly AssemblyAIVoice[] = [
  { name: 'Kyla (English, American)', id: 'aai-kyla' },
  { name: 'Antonio Luis (Spanish, Mexican)', id: 'aai-antonioluis' },
  { name: 'Magdalena (German)', id: 'aai-magdalena' },
  { name: 'Giada (Italian)', id: 'aai-giada' },
  { name: 'Nelson (Portuguese, Brazilian)', id: 'aai-nelson' },
  { name: 'Donatien (French)', id: 'aai-donatien' },
] as const;

export const ASSEMBLYAI_TTS_REGIONS = [
  { title: 'US', value: 'us' },
  { title: 'EU', value: 'eu' },
] as const;

type Region = (typeof ASSEMBLYAI_TTS_REGIONS)[number]['value'];

type VoicesCacheEntry = {
  voices: AssemblyAIVoice[];
  expiresAt: number;
};

const voicesCache = new Map<string, VoicesCacheEntry>();

function parseVoice(raw: unknown): AssemblyAIVoice | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const voice = raw as Record<string, unknown>;
  const id = voice.voice_id ?? voice.id ?? voice.slug;
  if (typeof id !== 'string' || !id.trim()) {
    return null;
  }

  const name = voice.name ?? voice.display_name ?? voice.title;
  return {
    id,
    name: typeof name === 'string' && name.trim() ? name : id,
  };
}

function parseVoices(payload: unknown): AssemblyAIVoice[] {
  const source = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object'
      ? ((payload as Record<string, unknown>).voices ??
        (payload as Record<string, unknown>).items ??
        (payload as Record<string, unknown>).data ??
        [])
      : [];

  if (!Array.isArray(source)) {
    return [];
  }

  const unique = new Map<string, AssemblyAIVoice>();
  for (const item of source) {
    const voice = parseVoice(item);
    if (voice) {
      unique.set(voice.id, voice);
    }
  }

  return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchVoices(apiKey: string, region: Region): Promise<AssemblyAIVoice[]> {
  if (!apiKey) {
    return ASSEMBLYAI_TTS_VOICES.map(voice => ({ ...voice }));
  }

  const cacheKey = `${region}:${apiKey}`;
  const cached = voicesCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.voices;
  }

  const response = await fetch(`https://tts.${region}.assemblyai.com/v1/voices`, {
    headers: {
      Authorization: apiKey,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `AssemblyAI voices fetch failed with status ${response.status}`);
  }

  const parsed = parseVoices(await response.json());
  const voices = parsed.length ? parsed : ASSEMBLYAI_TTS_VOICES.map(voice => ({ ...voice }));
  voicesCache.set(cacheKey, {
    voices,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
  return voices;
}
