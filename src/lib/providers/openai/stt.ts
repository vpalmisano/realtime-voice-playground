import OpenAI from 'openai';
import { OpenAIRealtimeWebSocket } from 'openai/realtime/websocket';
import { BaseProvider } from '../base.ts';
import debug from 'debug';

const log = debug('realtime:openai-stt');

export const AUDIO_SAMPLE_RATE = 24000;
export const DEFAULT_MODEL = 'gpt-4o-transcribe';

export type OpenAISTTOptions = {
  apiKey: string;
  model?: string;
  silenceDurationMs?: number;
  threshold?: number;
  chunkMs?: number;
};

async function createEphemeralClientSecret(
  apiKey: string,
  model: string,
  silenceDurationMs: number,
  threshold: number,
): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      session: {
        type: 'transcription',
        audio: {
          input: {
            format: {
              type: 'audio/pcm',
              rate: AUDIO_SAMPLE_RATE,
            },
            transcription: { model },
            turn_detection: {
              type: 'server_vad',
              threshold,
              silence_duration_ms: silenceDurationMs,
              prefix_padding_ms: 300,
            },
          },
        },
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Failed to create transcription client secret (${response.status}): ${detail}`);
  }

  const data = (await response.json()) as { value?: string };
  if (!data.value) {
    throw new Error('Transcription client secret response did not include a value');
  }
  return data.value;
}

export class OpenAISTT extends BaseProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly silenceDurationMs: number;
  private readonly threshold: number;
  private readonly chunkMs: number;
  private connection: OpenAIRealtimeWebSocket | null = null;

  constructor(options: OpenAISTTOptions) {
    super();
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_MODEL;
    this.silenceDurationMs = options.silenceDurationMs ?? 500;
    this.threshold = options.threshold ?? 0.5;
    this.chunkMs = options.chunkMs ?? 80;
  }

  async start() {
    if (this.running) {
      return;
    }
    this.running = true;
    log('start model=%s', this.model);

    this.notify(`Connecting to OpenAI STT with model ${this.model}...\n`);

    try {
      const ephemeralKey = await createEphemeralClientSecret(
        this.apiKey,
        this.model,
        this.silenceDurationMs,
        this.threshold,
      );

      const client = new OpenAI({
        apiKey: ephemeralKey,
        dangerouslyAllowBrowser: true,
      });
      this.connection = await OpenAIRealtimeWebSocket.create(client, {
        intent: 'transcription',
        dangerouslyAllowBrowser: true,
      });

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('OpenAI STT WebSocket open timeout')),
          15000,
        );
        this.connection!.socket.addEventListener('open', () => {
          clearTimeout(timeout);
          resolve();
        });
        this.connection!.on('error', event => {
          clearTimeout(timeout);
          reject(new Error(event.message || event.error?.message || 'OpenAI STT WebSocket error'));
        });
      });

      this.connection.on('conversation.item.input_audio_transcription.completed', event => {
        const text = event.transcript?.trim();
        if (text) {
          log('final: %s', text);
          this.emit('text', text);
        }
      });
      this.connection.on('conversation.item.input_audio_transcription.delta', event => {
        log('delta: %s', event.delta);
      });
      this.connection.on('conversation.item.input_audio_transcription.failed', event => {
        log('transcription failed: %o', event.error);
      });
      this.connection.on('error', event => {
        log('error: %o', event.error);
      });
      this.connection.socket.addEventListener('close', () => {
        log('WebSocket closed');
        if (this.running) {
          this.stop('Connection closed');
        }
      });

      await this.setupSourceAudio(
        this.chunkMs,
        binary => {
          if (!this.connection) return;
          this.connection.send({
            type: 'input_audio_buffer.append',
            audio: btoa(binary as string),
          });
        },
        true,
        AUDIO_SAMPLE_RATE,
      );
    } catch (error) {
      log('error: %o', error);
      this.stop('Failed to start session');
      throw error;
    }
  }

  sendMessage() {
    throw new Error('Not implemented');
  }

  protected closeSession(reason?: string): void {
    log('closeSession %s', reason ?? '');
    this.connection?.close();
    this.connection = null;
  }
}
