const API_HOST = 'api.inworld.ai';
const API_BASE = `https://${API_HOST}`;
const CACHE_TTL_MS = 5 * 60 * 1000;

export const INWORLD_PROXY = API_BASE;
export const INWORLD_CALLS_URL = `${API_BASE}/v1/realtime/calls`;
export const INWORLD_ICE_SERVERS_URL = `${API_BASE}/v1/realtime/ice-servers`;
export const INWORLD_VOICES_URL = `${API_BASE}/voices/v1/voices`;
export const INWORLD_SESSION_TOKEN_URL = `${API_BASE}/v1/sessionTokens/token:generate`;

export function buildRealtimeWebSocketUrl(sessionId = `voice-${Date.now()}`): string {
  const params = new URLSearchParams({ key: sessionId, protocol: 'realtime' });
  return `wss://${API_HOST}/api/v1/realtime/session?${params}`;
}

export const INWORLD_LLM_FALLBACK_MODELS = [
  'openai/gpt-4o-mini',
  'openai/gpt-4.1-nano',
  'google-ai-studio/gemini-2.5-flash',
  'google-ai-studio/gemini-2.5-pro',
] as const;

export const INWORLD_TTS_MODELS = ['inworld-tts-2', 'inworld-tts-2-flash'] as const;

export const INWORLD_STT_MODELS = ['inworld/inworld-stt-1'] as const;

export const INWORLD_FALLBACK_VOICES = [
  'Alex',
  'Ashley',
  'Clive',
  'Dennis',
  'Olivia',
  'Sarah',
  'Shaun',
] as const;

export type InworldIceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

type VoicesCacheEntry = {
  voices: { name: string; id: string }[];
  expiresAt: number;
};

const voicesCache = new Map<string, VoicesCacheEntry>();

function decodeApiCredential(apiKey: string): { keyId: string; secret: string } {
  const decoded = atob(apiKey);
  const parts = decoded.split(':');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(
      'Expected Inworld Base64 API key (keyId:secret). Copy "Basic (Base64)" from Inworld Portal.',
    );
  }
  return { keyId: parts[0], secret: parts[1] };
}

function toHex(buffer: BufferSource): string {
  const bytes =
    buffer instanceof ArrayBuffer
      ? new Uint8Array(buffer)
      : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256(key: BufferSource, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
}

/** Mint a Realtime session token from the Base64 API credential (browser playground). */
export async function mintSessionToken(apiKey: string): Promise<{
  token: string;
  expirationTime?: string;
  sessionId?: string;
}> {
  const { keyId, secret } = decodeApiCredential(apiKey);
  const method = 'ai.inworld.engine.v1.SessionTokens/GenerateSessionToken';
  const datetime = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const nonce = [...crypto.getRandomValues(new Uint8Array(16))]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  let signature: BufferSource = new TextEncoder().encode(`IW1${secret}`);
  for (const part of [datetime, API_HOST, method, nonce, 'iw1_request']) {
    signature = await hmacSha256(signature, part);
  }

  const authorization = `IW1-HMAC-SHA256 ApiKey=${keyId},DateTime=${datetime},Nonce=${nonce},Signature=${toHex(signature)}`;
  const response = await fetch(INWORLD_SESSION_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ api_key: keyId }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Failed to mint Inworld session token (${response.status}): ${detail}`);
  }

  const data = (await response.json()) as {
    token?: string;
    expirationTime?: string;
    sessionId?: string;
  };
  if (!data.token) {
    throw new Error('Inworld session token response did not include a token');
  }
  return { token: data.token, expirationTime: data.expirationTime, sessionId: data.sessionId };
}

export async function fetchIceServers(apiKey: string): Promise<InworldIceServer[]> {
  const response = await fetch(INWORLD_ICE_SERVERS_URL, {
    headers: { Authorization: `Basic ${apiKey}` },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Failed to fetch Inworld ICE servers (${response.status}): ${detail}`);
  }
  const data = (await response.json()) as { ice_servers?: InworldIceServer[] };
  return data.ice_servers ?? [];
}

export async function fetchVoices(apiKey: string): Promise<{ name: string; id: string }[]> {
  if (!apiKey) {
    return INWORLD_FALLBACK_VOICES.map(id => ({ name: id, id }));
  }

  const cached = voicesCache.get(apiKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.voices;
  }

  const voices: { name: string; id: string }[] = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({
      filter: 'source = "SYSTEM" AND lang_code = "en"',
      orderBy: 'display_name asc',
      pageSize: '100',
      ...(pageToken ? { pageToken } : {}),
    });
    const response = await fetch(`${INWORLD_VOICES_URL}?${params}`, {
      headers: { Authorization: `Basic ${apiKey}` },
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Failed to fetch Inworld voices (${response.status}): ${detail}`);
    }
    const data = (await response.json()) as {
      voices?: { voiceId?: string; displayName?: string }[];
      nextPageToken?: string;
    };
    for (const voice of data.voices ?? []) {
      if (!voice.voiceId) continue;
      voices.push({
        id: voice.voiceId,
        name: voice.displayName || voice.voiceId,
      });
    }
    pageToken = data.nextPageToken ?? '';
  } while (pageToken);

  const unique = [...new Map(voices.map(v => [v.id, v])).values()];
  const result = unique.length ? unique : INWORLD_FALLBACK_VOICES.map(id => ({ name: id, id }));
  voicesCache.set(apiKey, { voices: result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}
