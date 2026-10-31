import {
  RealtimeAgent,
  RealtimeSession,
  OpenAIRealtimeWebRTC,
  OpenAIRealtimeWebSocket,
} from '@openai/agents/realtime';
import { getWeatherTool } from '../../tools.ts';
import webrtcperf from '../../../webrtcperf.ts';
import { BaseProvider } from '../base.ts';
import debug from 'debug';

const log = debug('realtime:openai');

export type TransportType = 'webrtc' | 'websocket';

export type TurnDetection = {
  type: 'semantic_vad' | 'server_vad';
  eagerness?: 'auto' | 'low' | 'medium' | 'high';
  threshold?: number;
  prefixPaddingMs?: number;
  silenceDurationMs?: number;
};

export function buildTurnDetection(options: {
  type: TurnDetection['type'];
  eagerness?: TurnDetection['eagerness'];
  threshold?: number;
  prefixPaddingMs?: number;
  silenceDurationMs?: number;
}): TurnDetection {
  if (options.type === 'server_vad') {
    return {
      type: 'server_vad',
      threshold: options.threshold,
      prefixPaddingMs: options.prefixPaddingMs,
      silenceDurationMs: options.silenceDurationMs,
    };
  }
  return {
    type: 'semantic_vad',
    eagerness: options.eagerness,
  };
}

export type OpenAIRealtimeOptions = {
  transportType?: TransportType;
  model?: string;
  voice?: string;
  transcriptionModel?: string;
  apiKey: string;
  context?: string;
  turnDetection?: TurnDetection;
  chunkMs?: number;
};

export const TRANSPORTS = ['websocket', 'webrtc'] as const;
export const DEFAULT_VOICE = 'alloy';
export const TURN_DETECTION_TYPES = ['semantic_vad', 'server_vad'] as const;
export const EAGERNESS_OPTIONS = ['auto', 'low', 'medium', 'high'] as const;

export const DEFAULT_MODEL = 'gpt-realtime-2.1';
export const DEFAULT_TRANSCRIPTION_MODEL = 'gpt-4o-transcribe';

async function createEphemeralClientSecret(apiKey: string, model: string): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      session: {
        type: 'realtime',
        model,
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Failed to create realtime client secret (${response.status}): ${detail}`);
  }

  const data = (await response.json()) as { value?: string };
  if (!data.value) {
    throw new Error('Realtime client secret response did not include a value');
  }
  return data.value;
}

export class OpenAIRealtime extends BaseProvider {
  private readonly transportType: TransportType;
  private readonly model: string;
  private readonly voice: string;
  private readonly transcriptionModel: string;
  private readonly apiKey: string;
  private readonly context: string;
  private readonly turnDetection: TurnDetection;
  private readonly chunkMs: number;
  private audioElement: HTMLAudioElement | null = null;

  private session: RealtimeSession | null = null;

  constructor(options: OpenAIRealtimeOptions) {
    super();
    this.transportType = options.transportType ?? 'webrtc';
    this.model = options.model ?? DEFAULT_MODEL;
    this.voice = options.voice ?? DEFAULT_VOICE;
    this.transcriptionModel = options.transcriptionModel ?? 'gpt-4o-transcribe';
    this.apiKey = options.apiKey;
    this.turnDetection = options.turnDetection ?? {
      type: 'semantic_vad',
      eagerness: 'auto',
    };
    this.context = options.context ?? 'You help users answering questions.';
    this.chunkMs = options.chunkMs ?? 80;
  }

  async start() {
    if (this.running) {
      return;
    }
    log('start');
    this.running = true;

    this.notify(
      `Connecting to OpenAI via ${this.transportType} with model ${this.model}, voice ${this.voice}, transcription ${this.transcriptionModel}...\n`,
    );

    try {
      await this.getMediaStream();

      const transport = this.createTransport();

      const agent = new RealtimeAgent({
        name: 'Assistant',
        instructions: this.context,
        voice: this.voice,
        tools: [getWeatherTool],
      });

      this.session = new RealtimeSession(agent, {
        model: this.model,
        transport,
        config: {
          audio: {
            input: {
              format: {
                rate: 24000,
                type: 'audio/pcm',
              },
              turnDetection: {
                createResponse: true,
                interruptResponse: true,
                ...this.turnDetection,
              },
              transcription: {
                model: this.transcriptionModel,
              },
            },
            output: {
              format: {
                rate: 24000,
                type: 'audio/pcm',
              },
              voice: this.voice,
            },
          },
          outputModalities: ['audio'],
        },
      });

      if (this.transportType === 'websocket') {
        await this.setupSourceAudio(this.chunkMs, pcm16 => {
          this.session?.sendAudio(pcm16 as ArrayBuffer);
        });
        const { push, flush } = await this.setupOutputAudio(24000);
        const pushAudio = push as (chunk: string) => void;

        this.session.transport.on('response.output_audio.delta', event =>
          pushAudio(atob(event.delta)),
        );
        this.session.transport.on('conversation.item.truncated', () => flush());
        this.session.transport.on('input_audio_buffer.speech_started', () => flush());
      }

      const connectApiKey = await createEphemeralClientSecret(this.apiKey, this.model);

      this.session.on('*', event => log('session event %o', event));
      this.session.transport.on('*', event => {
        const itemId = 'item_id' in event ? event.item_id : undefined;
        log('transport %s item_id: %s %o', event.type, itemId, event);
      });
      this.session.transport.on('response.done', event => {
        const usage = event.response?.usage;
        if (!usage) {
          return;
        }
        const {
          input_tokens: promptTokenCount,
          output_tokens: responseTokenCount,
          total_tokens: totalTokenCount,
        } = usage;
        log('usage: %o', { promptTokenCount, responseTokenCount, totalTokenCount });
        if (promptTokenCount) {
          this.promptTokenCount += promptTokenCount;
        }
        if (responseTokenCount) {
          this.responseTokenCount += responseTokenCount;
        }
      });

      await this.session.connect({ apiKey: connectApiKey, model: this.model });

      if (this.transportType === 'webrtc') {
        this.outputAudioTrack = await webrtcperf.getTransceiversTrack('recv', 'audio');
      }

      if (!this.outputAudioTrack) {
        throw new Error('Failed to get output audio track');
      }
    } catch (error) {
      log('error: %o', error);
      this.stop('Failed to start session');
      throw error;
    }
  }

  private createTransport() {
    if (this.transportType === 'webrtc') {
      this.audioElement = document.createElement('audio');
      this.audioElement.autoplay = true;
      document.body.appendChild(this.audioElement);
      return new OpenAIRealtimeWebRTC({
        useInsecureApiKey: false,
        mediaStream: this.mediaStream!,
        audioElement: this.audioElement,
      });
    }
    return new OpenAIRealtimeWebSocket({
      useInsecureApiKey: false,
      url: `wss://api.openai.com/v1/realtime?model=${this.model}`,
    });
  }

  sendMessage(message: string): void {
    this.session?.sendMessage(message);
  }

  protected closeSession(reason?: string): void {
    log('closeSession %s', reason ?? '');
    this.session?.interrupt();
    this.session?.close();
    this.session = null;
    this.audioElement?.remove();
    this.audioElement = null;
  }
}
