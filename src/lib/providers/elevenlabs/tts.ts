import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { BaseProvider } from '../base.ts';
import debug from 'debug';

const log = debug('realtime:elevenlabs-tts');

export const AUDIO_SAMPLE_RATE = 24000;
export const DEFAULT_MODEL = 'eleven_flash_v2_5';
/** Premade "Rachel" voice. */
export const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';

export type ElevenLabsTTSOptions = {
  apiKey: string;
  voiceId?: string;
  modelId?: string;
};

type TtsServerMessage = {
  audio?: string;
  isFinal?: boolean;
  error?: string;
  message?: string;
};

async function createEphemeralClientSecret(apiKey: string): Promise<string> {
  const client = new ElevenLabsClient({ apiKey });
  const { token } = await client.tokens.singleUse.create('tts_websocket');
  return token;
}

export class ElevenLabsTTS extends BaseProvider {
  private readonly apiKey: string;
  private readonly voiceId: string;
  private readonly modelId: string;
  private connection: WebSocket | null = null;
  private push: ((chunk: string) => void) | null = null;

  constructor(options: ElevenLabsTTSOptions) {
    super();
    this.apiKey = options.apiKey;
    this.voiceId = options.voiceId ?? DEFAULT_VOICE_ID;
    this.modelId = options.modelId ?? DEFAULT_MODEL;
  }

  async start() {
    if (this.running) {
      return;
    }
    this.running = true;
    log('start model=%s voice=%s', this.modelId, this.voiceId);

    try {
      const token = await createEphemeralClientSecret(this.apiKey);
      const { push } = await this.setupOutputAudio(AUDIO_SAMPLE_RATE);
      this.push = push as (chunk: string) => void;

      const params = new URLSearchParams({
        model_id: this.modelId,
        output_format: `pcm_${AUDIO_SAMPLE_RATE}`,
        single_use_token: token,
        inactivity_timeout: '180',
        auto_mode: 'true',
      });
      const url = `wss://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(this.voiceId)}/stream-input?${params}`;

      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(url);
        this.connection = ws;

        ws.onopen = () => {
          ws.send(
            JSON.stringify({
              text: ' ',
              voice_settings: {
                stability: 0.5,
                similarity_boost: 0.8,
                use_speaker_boost: false,
              },
            }),
          );
          log('WebSocket open');
          resolve();
        };

        ws.onmessage = event => {
          try {
            const data = JSON.parse(String(event.data)) as TtsServerMessage;
            if (data.audio) {
              this.push?.(atob(data.audio));
            }
            if (data.isFinal) {
              log('Final audio chunk received');
            }
            if (data.error) {
              log('TTS error: %s %s', data.error, data.message ?? '');
            }
          } catch (error) {
            log('Failed to parse message: %o', error);
          }
        };

        ws.onerror = () => {
          reject(new Error('ElevenLabs TTS WebSocket error'));
        };

        ws.onclose = () => {
          log('WebSocket closed');
          this.connection = null;
          if (this.running) {
            this.stop('Connection closed');
          }
        };
      });
    } catch (error) {
      log('error: %o', error);
      this.stop('Failed to start session');
      throw error;
    }
  }

  sendMessage(message: string) {
    if (!this.connection || this.connection.readyState !== WebSocket.OPEN) {
      throw new Error('connection is not open');
    }
    const text = message.endsWith(' ') ? message : `${message} `;
    log('sendMessage: "%s"', text);
    this.connection.send(JSON.stringify({ text, flush: true }));
  }

  closeSession(reason?: string) {
    log('closeSession', reason);
    if (this.connection?.readyState === WebSocket.OPEN) {
      try {
        this.connection.send(JSON.stringify({ text: '' }));
      } catch (error) {
        log('Failed to send close message: %o', error);
      }
      this.connection.close();
    }
    this.connection = null;
    this.push = null;
  }
}
