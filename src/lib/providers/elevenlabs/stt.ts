import {
  Scribe,
  RealtimeEvents,
  CommitStrategy,
  RealtimeConnection,
  AudioFormat,
} from '@elevenlabs/client';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { BaseProvider } from '../base.ts';
import debug from 'debug';

const log = debug('realtime:elevenlabs-stt');

export const DEFAULT_MODEL = 'scribe_v2_realtime';

export type ElevenLabsSTTOptions = {
  apiKey: string;
  modelId?: string;
  chunkMs?: number;
};

async function createEphemeralClientSecret(apiKey: string): Promise<string> {
  const client = new ElevenLabsClient({ apiKey });
  const { token } = await client.tokens.singleUse.create('realtime_scribe');
  return token;
}

export class ElevenLabsSTT extends BaseProvider {
  private readonly apiKey: string;
  private readonly modelId: string;
  private readonly chunkMs: number;
  private connection: RealtimeConnection | null = null;

  constructor(options: ElevenLabsSTTOptions) {
    super();
    this.apiKey = options.apiKey;
    this.modelId = options.modelId ?? DEFAULT_MODEL;
    this.chunkMs = options.chunkMs ?? 80;
  }

  async start() {
    if (this.running) {
      return;
    }
    this.running = true;
    log('start model=%s', this.modelId);

    try {
      const token = await createEphemeralClientSecret(this.apiKey);
      let connected = false;
      this.connection = Scribe.connect({
        token,
        modelId: this.modelId,
        commitStrategy: CommitStrategy.VAD,
        audioFormat: AudioFormat.PCM_16000,
        sampleRate: 16000,
      });
      this.connection.on(RealtimeEvents.SESSION_STARTED, data => {
        log('Session started:', data.session_id);
        connected = true;
      });
      this.connection.on(RealtimeEvents.CLOSE, () => {
        log('Connection closed');
        connected = false;
        this.stop('Connection closed');
      });
      this.connection.on(RealtimeEvents.AUDIO_STARTED, () => {
        log('audio started');
      });
      this.connection.on(RealtimeEvents.COMMITTED_TRANSCRIPT, data => {
        log('Committed transcript:', data.text);
        this.emit('text', data.text);
      });
      this.connection.on(RealtimeEvents.ERROR, error => {
        log('Scribe error:', error);
        connected = false;
        this.emit('error', error);
      });

      await this.setupSourceAudio(
        this.chunkMs,
        binary => {
          if (this.connection && connected) {
            this.connection.send({ audioBase64: btoa(binary as string) });
          }
        },
        true,
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

  protected closeSession(reason?: string) {
    log('closeSession %s', reason ?? '');
    this.connection?.close();
    this.connection = null;
  }
}
