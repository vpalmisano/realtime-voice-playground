import { GradiumClient, type Voice } from '@gradium/sdk';

const CACHE_TTL_MS = 60 * 60 * 1000;

export const GRADIUM_TTS_FALLBACK_MODELS = ['default', 'gradium-tts-beta'] as const;
export const GRADIUM_STT_FALLBACK_MODELS = ['default'] as const;

export const GRADIUM_LANGUAGES = ['en', 'fr', 'es', 'pt', 'de', 'any'] as const;

/** Gradium flagship voice "Emma". */
export const GRADIUM_VOICES = [{ name: 'Emma', id: 'YTpq7expH9539ERJ' }] as const;

type VoicesCacheEntry = {
  voices: { name: string; id: string }[];
  expiresAt: number;
};

const voicesCache = new Map<string, VoicesCacheEntry>();

function normalizeVoices(data: unknown): { name: string; id: string }[] {
  const list = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as { voices?: unknown }).voices)
      ? ((data as { voices: unknown[] }).voices ?? [])
      : [];

  const voices: { name: string; id: string }[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const voice = item as Voice;
    if (!voice.uid) continue;
    voices.push({ name: voice.name || voice.uid, id: voice.uid });
  }
  return voices;
}

export async function fetchVoices(apiKey: string): Promise<{ name: string; id: string }[]> {
  if (!apiKey) {
    return GRADIUM_VOICES.map(v => ({ name: v.name, id: v.id }));
  }

  const cached = voicesCache.get(apiKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.voices;
  }

  const client = new GradiumClient({ apiKey });
  const data = await client.voiceList({ includeCatalog: true });
  const voices = normalizeVoices(data);
  const result = voices.length ? voices : GRADIUM_VOICES.map(v => ({ name: v.name, id: v.id }));
  voicesCache.set(apiKey, { voices: result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}

export function bytesToBinaryString(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return binary;
}
