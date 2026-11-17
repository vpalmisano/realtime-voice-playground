import { AssemblyAI, type StreamingSpeechModel, type StreamingTranscriber } from 'assemblyai';
import { BaseProvider, type VadOptions } from '../base.ts';
import debug from 'debug';

const log = debug('realtime:assemblyai-stt');

export const AUDIO_SAMPLE_RATE = 16000;
export const DEFAULT_MODEL: StreamingSpeechModel = 'universal-3-6-pro';

export type AssemblyAISTTOptions = {
  apiKey: string;
  model?: StreamingSpeechModel;
  chunkMs?: number;
};

export class AssemblyAISTT extends BaseProvider {
  readonly name = 'AssemblyAISTT';
  private readonly apiKey: string;
  private readonly client: AssemblyAI;
  private readonly model: StreamingSpeechModel;
  private readonly chunkMs: number;
  private connection: StreamingTranscriber | null = null;

  constructor(options: AssemblyAISTTOptions, vadOptions?: VadOptions) {
    super();
    this.client = new AssemblyAI({ apiKey: options.apiKey });
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_MODEL;
    this.chunkMs = options.chunkMs ?? 80;
    this.vadOptions = vadOptions;
  }

  async start() {
    if (this.running) {
      return;
    }
    this.running = true;
    log('start model=%s', this.model);

    this.notify(`Connecting to AssemblyAI STT with model ${this.model}...`);

    try {
      const transcriber = this.client.streaming.transcriber({
        token: this.apiKey,
        sampleRate: AUDIO_SAMPLE_RATE,
        speechModel: this.model,
        formatTurns: true,
      });
      this.connection = transcriber;

      transcriber.on('open', event => {
        log('open session=%s', event.id);
      });
      transcriber.on('turn', event => {
        if (!event.end_of_turn) {
          return;
        }
        const text = event.transcript?.trim();
        if (text) {
          log('final: %s', text);
          this.emit('text', text);
        }
      });
      transcriber.on('error', error => {
        log('error: %o', error);
        this.notifyError(error.message);
      });
      transcriber.on('close', (code, reason) => {
        log('close %s %s', code, reason);
        if (this.running) {
          this.stop(reason || `Connection closed (${code})`);
        }
      });

      await transcriber.connect();

      await this.setupSourceAudio(
        pcm16 => {
          if (!this.connection) return;
          const bytes = pcm16 as Int16Array;
          const audio = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
          this.connection.sendAudio(audio);
        },
        this.chunkMs,
        AUDIO_SAMPLE_RATE,
        'i16',
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
    void this.connection?.close();
    this.connection = null;
  }
}
