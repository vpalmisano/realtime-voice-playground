const API_BASE = 'https://api.phonic.ai';
const CACHE_TTL_MS = 5 * 60 * 1000;

export const PHONIC_SESSION_TOKEN_URL = `${API_BASE}/v1/auth/session_token`;
export const PHONIC_VOICES_URL = `${API_BASE}/v1/voices`;
export const PHONIC_AGENTS_URL = `${API_BASE}/v1/agents`;
export const PHONIC_WS_URL = 'wss://api.phonic.ai/v1/sts/ws';

export const PHONIC_MODELS = ['phonic-1', 'phonic-0.5'] as const;

export const PHONIC_TURN_TAKING = [
  'eager',
  'standard',
  'relaxed',
  'measured',
  'patient',
  'very_patient',
] as const;

export type PhonicTurnTaking = (typeof PHONIC_TURN_TAKING)[number];

export const PHONIC_FALLBACK_VOICES = [
  'sabrina',
  'grant',
  'sandeep',
  'landon',
  'shelby',
  'mason',
  'virginia',
  'eleanor',
  'gabrielle',
  'paula',
  'nolan',
  'roberto',
  'hikari',
  'tomoya',
  'eloise',
  'jerome',
  'daniela',
  'juliana',
  'valeria',
  'eduardo',
  'henri',
  'kourtney',
  'kaspar',
  'mei',
  'stella',
  'karoline',
  'amelia',
  'william',
  'joon',
  'hana',
  'mia',
  'derek',
  'divya',
  'alice',
  'karin',
  'phillip',
  'jackson',
  'gina',
  'michelle',
] as const;

type CacheEntry<T> = { value: T; expiresAt: number };

const voicesCache = new Map<string, CacheEntry<{ id: string; name: string }[]>>();
const agentsCache = new Map<string, CacheEntry<string[]>>();

function authHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

/** Mint a short-lived session token for browser WebSocket auth. */
export async function mintSessionToken(
  apiKey: string,
  ttlSeconds = 3600,
): Promise<{ sessionToken: string; expiresAt: string }> {
  const response = await fetch(PHONIC_SESSION_TOKEN_URL, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ ttl_seconds: ttlSeconds }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Failed to mint Phonic session token (${response.status}): ${detail}`);
  }

  const data = (await response.json()) as { session_token?: string; expires_at?: string };
  if (!data.session_token) {
    throw new Error('Phonic session token response did not include session_token');
  }
  return {
    sessionToken: data.session_token,
    expiresAt: data.expires_at ?? '',
  };
}

export function buildWebSocketUrl(sessionToken: string): string {
  const params = new URLSearchParams({ session_token: sessionToken });
  return `${PHONIC_WS_URL}?${params}`;
}

export async function fetchVoices(apiKey: string): Promise<{ id: string; name: string }[]> {
  if (!apiKey) {
    return PHONIC_FALLBACK_VOICES.map(id => ({ id, name: id }));
  }

  const cached = voicesCache.get(apiKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const response = await fetch(PHONIC_VOICES_URL, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Failed to fetch Phonic voices (${response.status}): ${detail}`);
  }

  const data = (await response.json()) as {
    voices?: { id?: string; name?: string }[];
  };
  const voices = (data.voices ?? [])
    .filter((v): v is { id: string; name: string } => Boolean(v.id))
    .map(v => ({ id: v.id, name: v.name || v.id }));

  if (!voices.length) {
    return PHONIC_FALLBACK_VOICES.map(id => ({ id, name: id }));
  }

  voicesCache.set(apiKey, { value: voices, expiresAt: Date.now() + CACHE_TTL_MS });
  return voices;
}

export async function fetchAgents(apiKey: string, project = 'main'): Promise<string[]> {
  if (!apiKey) {
    return [];
  }

  const cacheKey = `${apiKey}:${project}`;
  const cached = agentsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const params = new URLSearchParams({ project });
  const response = await fetch(`${PHONIC_AGENTS_URL}?${params}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Failed to fetch Phonic agents (${response.status}): ${detail}`);
  }

  const data = (await response.json()) as { agents?: { name?: string }[] };
  const agents = (data.agents ?? [])
    .map(a => a.name)
    .filter((name): name is string => Boolean(name));

  agentsCache.set(cacheKey, { value: agents, expiresAt: Date.now() + CACHE_TTL_MS });
  return agents;
}
