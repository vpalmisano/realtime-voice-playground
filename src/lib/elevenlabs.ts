import { OpenAIRealtimeWebSocket, RealtimeAgent, RealtimeSession } from '@openai/agents/realtime';
import { appendMessage } from '../MessagesLog.vue';
import { type TurnDetection } from './openai';
import { processInputAudioTrack, processOutputAudioTrack } from './utils';
import { chunkMs } from '../PerfSettings.vue';
import { DEFAULT_CONTEXT, ProviderSession } from './provider';
import debug from 'debug';

const log = debug('realtime:elevenlabs');

export const REALTIME_URL = 'wss://api.elevenlabs.io/v1/convai/realtime';
export const AUDIO_SAMPLE_RATE = 24000;

export type ElevenLabsSessionOptions = {
  model?: string;
  voice?: string;
  apiKey: string;
  context?: string;
  turnDetection?: TurnDetection;
};

export const DEFAULT_MODEL = 'eleven_realtime_v1_mini';
export const DEFAULT_VOICE = 'brian';
export const MODELS = ['eleven_realtime_v1_mini', 'eleven_realtime_v1_max'] as const;
export const VOICES = [
  'brian',
  'rachel',
  'adam',
  'antoni',
  'arnold',
  'bella',
  'domi',
  'elli',
  'josh',
  'sam',
] as const;

async function createEphemeralClientSecret(
  apiKey: string,
  options: {
    model: string;
    voice: string;
    context: string;
    turnDetection: TurnDetection;
  },
): Promise<string> {
  // REST API expects snake_case (unlike the ElevenLabs JS SDK, which camelCases).
  const toApiTurnDetection = (turnDetection: TurnDetection) => {
    const base = {
      type: turnDetection.type,
      create_response: true,
      interrupt_response: true,
    };
    if (turnDetection.type === 'server_vad') {
      return {
        ...base,
        threshold: turnDetection.threshold,
        prefix_padding_ms: turnDetection.prefixPaddingMs,
        silence_duration_ms: turnDetection.silenceDurationMs,
      };
    }
    // ElevenLabs accepts low|medium|high (no "auto").
    const eagerness = turnDetection.eagerness === 'auto' ? 'medium' : turnDetection.eagerness;
    return { ...base, eagerness };
  };

  const response = await fetch('https://api.elevenlabs.io/v1/convai/realtime/client_secrets', {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      session: {
        type: 'realtime',
        model: options.model,
        instructions: options.context,
        output_modalities: ['audio'],
        audio: {
          input: {
            format: { type: 'audio/pcm', rate: AUDIO_SAMPLE_RATE },
            turn_detection: toApiTurnDetection(options.turnDetection),
          },
          output: {
            format: { type: 'audio/pcm' },
            voice: options.voice,
          },
        },
      },
      expires_after: { anchor: 'created_at', seconds: 600 },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    if (/convai_write/i.test(detail)) {
      throw new Error(
        `ElevenLabs API key is missing the "convai_write" permission. ` +
          `Edit the key at https://elevenlabs.io/app/settings/api-keys and enable Conversational AI write access (or disable key restrictions).`,
      );
    }
    throw new Error(`Failed to create realtime client secret (${response.status}): ${detail}`);
  }

  const data = (await response.json()) as { value?: string };
  if (!data.value) {
    throw new Error('Realtime client secret response did not include a value');
  }
  return data.value;
}

export class ElevenLabsSession extends ProviderSession {
  public readonly transportType = 'websocket' as const;
  private readonly model: string;
  private readonly voice: string;
  private readonly apiKey: string;
  private readonly context: string;
  private readonly turnDetection: TurnDetection;

  private session: RealtimeSession | null = null;

  constructor(options: ElevenLabsSessionOptions) {
    super();
    this.model = options.model ?? DEFAULT_MODEL;
    this.voice = options.voice ?? DEFAULT_VOICE;
    this.apiKey = options.apiKey;
    this.context = options.context ?? DEFAULT_CONTEXT;
    this.turnDetection = options.turnDetection ?? {
      type: 'semantic_vad',
      eagerness: 'medium',
    };
  }

  async start() {
    if (this.running) {
      return;
    }
    log('start');
    this.running = true;

    await appendMessage(
      `Connecting to ElevenLabs via ${this.transportType} with model ${this.model}, voice ${this.voice}...\n`,
    );

    try {
      const sourceAudioTrack = await this.getMediaStream();

      const agent = new RealtimeAgent({
        name: 'ElevenLabs agent',
        instructions: this.context,
      });

      this.session = new RealtimeSession(agent, {
        transport: new OpenAIRealtimeWebSocket({
          useInsecureApiKey: false,
          url: REALTIME_URL,
        }),
        model: this.model,
        config: {
          outputModalities: ['audio'],
          audio: {
            output: { voice: this.voice },
          },
        },
      });

      const { close: closeInput } = await processInputAudioTrack(
        sourceAudioTrack,
        AUDIO_SAMPLE_RATE,
        pcm16 => this.session?.sendAudio(pcm16),
        chunkMs.value,
      );
      this.closeInputAudio = closeInput;

      const { push, flush, track, close } = await processOutputAudioTrack(AUDIO_SAMPLE_RATE);
      this.outputAudioTrack = track;
      this.closeAudioContext = close;

      this.session.transport.on('response.output_audio.delta', event => push(atob(event.delta)));
      this.session.transport.on('conversation.item.truncated', () => flush());
      this.session.transport.on('input_audio_buffer.speech_started', () => flush());
      this.session.on('audio_interrupted', () => flush());

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
      this.session.on('error', event => {
        log('session error: %o', event);
      });
      this.session.transport.on('connection_change', connectionStatus => {
        if (connectionStatus !== 'disconnected') return;
        if (!this.session) return;
        this.stop('Connection closed');
      });

      const clientSecret = await createEphemeralClientSecret(this.apiKey, {
        model: this.model,
        voice: this.voice,
        context: this.context,
        turnDetection: this.turnDetection,
      });

      await this.session.connect({ apiKey: clientSecret });

      if (!this.outputAudioTrack) {
        throw new Error('Failed to get output audio track');
      }
    } catch (error) {
      log('error: %o', error);
      this.stop('Failed to start session');
      throw error;
    }
  }

  sendMessage(message: string): void {
    this.session?.sendMessage(message);
  }

  protected closeSession(reason?: string): void {
    log('closeSession %s', reason ?? '');
    this.session?.interrupt();
    this.session?.close();
    this.session = null;
  }
}
