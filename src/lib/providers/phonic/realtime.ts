import { DEFAULT_CONTEXT, BaseProvider, type VadOptions } from '../base.ts';
import {
  buildWebSocketUrl,
  mintSessionToken,
  PHONIC_MODELS,
  type PhonicTurnTaking,
} from './utils.ts';
import debug from 'debug';

const log = debug('realtime:phonic');

/** Phonic rejects audio chunks longer than 40 ms; use 20 ms for headroom. */
export const MAX_CHUNK_MS = 40;
export const DEFAULT_CHUNK_MS = 20;
export const AUDIO_SAMPLE_RATE = 16000;
export const INPUT_FORMAT = 'pcm_16000';
export const OUTPUT_FORMAT = 'pcm_16000';

export type PhonicRealtimeOptions = {
  apiKey: string;
  model?: string;
  voice?: string;
  agent?: string;
  project?: string;
  context?: string;
  turnTaking?: PhonicTurnTaking;
  chunkMs?: number;
};

export const DEFAULT_MODEL = PHONIC_MODELS[0];
export const DEFAULT_VOICE = 'sabrina';
export const DEFAULT_PROJECT = 'main';
export const DEFAULT_TURN_TAKING: PhonicTurnTaking = 'standard';

type PhonicServerMessage = {
  type: string;
  audio?: string;
  text?: string;
  error?: { message?: string; code?: string } | string;
  warning?: { message?: string; code?: string };
  conversation_id?: string;
};

export class PhonicRealtime extends BaseProvider {
  readonly name = 'PhonicRealtime';
  private readonly apiKey: string;
  private readonly model: string;
  private readonly voice: string;
  private readonly agent: string | undefined;
  private readonly project: string;
  private readonly context: string;
  private readonly turnTaking: PhonicTurnTaking;
  private readonly chunkMs: number;

  private websocket: WebSocket | null = null;
  private ready = false;
  private pushOutputAudio: ((chunk: string) => void) | null = null;
  private flushOutputAudioBuffer: (() => void) | null = null;

  constructor(options: PhonicRealtimeOptions, vadOptions?: VadOptions) {
    super();
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_MODEL;
    this.voice = options.voice ?? DEFAULT_VOICE;
    this.agent = options.agent?.trim() || undefined;
    this.project = options.project?.trim() || DEFAULT_PROJECT;
    this.context = options.context ?? DEFAULT_CONTEXT;
    this.turnTaking = options.turnTaking ?? DEFAULT_TURN_TAKING;
    this.chunkMs = Math.min(Math.max(options.chunkMs ?? DEFAULT_CHUNK_MS, 10), MAX_CHUNK_MS);
    this.vadOptions = vadOptions;
  }

  async start() {
    if (this.running) {
      return;
    }
    log('start');
    this.running = true;
    this.ready = false;

    const label = this.agent ? `agent ${this.agent}` : `model ${this.model}, voice ${this.voice}`;
    this.notify(`Connecting to Phonic (${label})...`);

    try {
      const { sessionToken } = await mintSessionToken(this.apiKey);
      const { push, flush } = await this.setupOutputAudio(AUDIO_SAMPLE_RATE);
      this.pushOutputAudio = push;
      this.flushOutputAudioBuffer = flush;

      await this.connectWebSocket(sessionToken);

      await this.setupSourceAudio(
        binary => {
          if (!this.ready || !this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
            return;
          }
          this.sendEvent({
            type: 'audio_chunk',
            audio: btoa(binary as string),
          });
        },
        this.chunkMs,
        AUDIO_SAMPLE_RATE,
        'i16',
        'string',
      );
    } catch (error) {
      log('error: %o', error);
      this.stop('Failed to start session');
      throw error;
    }
  }

  sendMessage(message: string) {
    if (!this.ready) {
      this.notifyError('Phonic session is not ready yet');
      return;
    }
    this.sendEvent({
      type: 'generate_reply',
      user_message: message,
    });
  }

  protected closeSession(reason?: string): void {
    log('closeSession %s', reason ?? '');
    this.ready = false;
    this.pushOutputAudio = null;
    this.flushOutputAudioBuffer = null;
    if (this.websocket) {
      this.websocket.onopen = null;
      this.websocket.onmessage = null;
      this.websocket.onerror = null;
      this.websocket.onclose = null;
      if (
        this.websocket.readyState === WebSocket.OPEN ||
        this.websocket.readyState === WebSocket.CONNECTING
      ) {
        this.websocket.close(1000, reason ?? 'closed');
      }
      this.websocket = null;
    }
  }

  private connectWebSocket(sessionToken: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = buildWebSocketUrl(sessionToken);
      this.websocket = new WebSocket(url);

      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('Timed out waiting for Phonic ready_to_start_conversation'));
      }, 20000);

      this.websocket.addEventListener('open', () => {
        log('websocket open');
        this.sendConfig();
      });

      this.websocket.addEventListener('message', event => {
        let msg: PhonicServerMessage;
        try {
          msg = JSON.parse(String(event.data)) as PhonicServerMessage;
        } catch {
          log('non-json websocket message: %o', event.data);
          return;
        }

        if (!settled && msg.type === 'ready_to_start_conversation') {
          settled = true;
          clearTimeout(timeout);
          this.ready = true;
          this.notify('Phonic conversation ready');
          resolve();
          return;
        }

        if (!settled && msg.type === 'error') {
          settled = true;
          clearTimeout(timeout);
          reject(new Error(formatPhonicError(msg)));
          return;
        }

        this.onServerMessage(msg);
      });

      this.websocket.addEventListener('error', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(new Error('Phonic WebSocket connection error'));
      });

      this.websocket.addEventListener('close', event => {
        clearTimeout(timeout);
        log('websocket close code=%s reason=%s', event.code, event.reason);
        if (!settled) {
          settled = true;
          reject(new Error(event.reason || `WebSocket closed before ready (code ${event.code})`));
          return;
        }
        if (!this.running) return;
        this.stop(event.reason || `WebSocket closed (${event.code})`);
      });
    });
  }

  private sendConfig() {
    const config: Record<string, unknown> = {
      type: 'config',
      project: this.project,
      model: this.model,
      system_prompt: this.context,
      voice_id: this.voice,
      input_format: INPUT_FORMAT,
      output_format: OUTPUT_FORMAT,
      turn_taking: this.turnTaking,
      // Keep the socket alive while the playground is connected; inactivity is rare with mic stream.
      websocket_timeout_sec: 300,
    };
    if (this.agent) {
      config.agent = this.agent;
    }
    this.sendEvent(config);
  }

  private sendEvent(event: Record<string, unknown>) {
    if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.websocket.send(JSON.stringify(event));
  }

  private onServerMessage(msg: PhonicServerMessage) {
    switch (msg.type) {
      case 'audio_chunk':
        if (msg.audio) {
          this.pushOutputAudio?.(atob(msg.audio));
        }
        break;
      case 'user_started_speaking':
      case 'interrupted_response':
        this.flushOutputAudioBuffer?.();
        this.flush();
        break;
      case 'conversation_created':
        if (msg.conversation_id) {
          log(`Conversation ${msg.conversation_id}`);
        }
        break;
      case 'input_text':
        if (msg.text) {
          log(`Input text: ${msg.text}`);
        }
        break;
      case 'assistant_finished_speaking':
        log('Assistant finished speaking');
        break;
      case 'assistant_ended_conversation':
        this.stop('Assistant ended conversation');
        break;
      case 'error':
        this.notifyError(formatPhonicError(msg));
        break;
      case 'warning':
        if (msg.warning?.message) {
          log(`Warning: ${msg.warning.message}`);
        }
        break;
      default:
        break;
    }
  }
}

function formatPhonicError(msg: PhonicServerMessage): string {
  if (typeof msg.error === 'string') {
    return msg.error;
  }
  if (msg.error && typeof msg.error === 'object' && msg.error.message) {
    return msg.error.message;
  }
  return 'Phonic error';
}
