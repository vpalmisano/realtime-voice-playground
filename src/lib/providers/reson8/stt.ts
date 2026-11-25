import { BaseProvider, type VadOptions } from '../base.ts';
import debug from 'debug';

const log = debug('realtime:reson8-stt');

export const AUDIO_SAMPLE_RATE = 16000;
export const MODEL_ID = 'Reson8/Rumble-2-Flash';
export const ONNX_MODEL_ID = 'kaptionai/rumble-2-flash-web';

export type Reson8STTOptions = {
  language?: string;
  chunkMs?: number;
};

type WorkerMessage =
  | { type: 'progress'; message: string; value: number }
  | { type: 'ready' }
  | { type: 'text'; text: string }
  | { type: 'error'; error: string };

export class Reson8STT extends BaseProvider {
  readonly name = 'Reson8STT';
  private readonly language?: string;
  private readonly chunkMs: number;
  private audioBuffer = new Float32Array(0);
  private talking = false;
  private worker: Worker | null = null;

  constructor(options: Reson8STTOptions = {}, vadOptions?: VadOptions) {
    super();
    this.language = options.language?.trim() || undefined;
    this.chunkMs = options.chunkMs ?? 80;
    this.vadOptions = vadOptions;
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.audioBuffer = new Float32Array(0);
    this.talking = false;
    log('start model=%s onnx=%s language=%s', MODEL_ID, ONNX_MODEL_ID, this.language ?? 'auto');
    this.notify('Loading Reson8 Rumble-2-Flash for local WebGPU inference...');

    try {
      const worker = new Worker(new URL('./stt.worker.ts', import.meta.url), { type: 'module' });
      this.worker = worker;

      await new Promise<void>((resolve, reject) => {
        worker.onerror = event => reject(new Error(event.message || 'Reson8 STT worker failed'));
        worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
          const message = event.data;
          if (message.type === 'progress') {
            this.notifyProgress(message.message, message.value);
          } else if (message.type === 'ready') {
            resolve();
          } else if (message.type === 'text') {
            log('final: %s', message.text);
            this.emit('text', message.text);
          } else {
            this.notifyError(message.error);
            reject(new Error(message.error));
          }
        };
        worker.postMessage({ type: 'load', language: this.language });
      });

      await this.setupSourceAudio(
        binary => {
          if (!this.running || !this.talking || !this.worker) return;
          this.appendAudio(binary as Float32Array);
        },
        this.chunkMs,
        AUDIO_SAMPLE_RATE,
        'f32',
        'array',
      );

      this.sourceAudioVad?.on('start', () => {
        log('vad start');
        this.talking = true;
        this.audioBuffer = new Float32Array(0);
      });
      this.sourceAudioVad?.on('stop', () => {
        log('vad stop');
        this.talking = false;
        const audio = this.audioBuffer;
        this.audioBuffer = new Float32Array(0);
        if (audio.length && this.worker) {
          this.worker.postMessage({ type: 'transcribe', samples: audio }, [audio.buffer]);
        }
      });
    } catch (error) {
      log('start error: %o', error);
      this.stop('Failed to start Reson8 STT');
      throw error;
    }
  }

  private appendAudio(samples: Float32Array) {
    if (!samples.length) return;
    const merged = new Float32Array(this.audioBuffer.length + samples.length);
    merged.set(this.audioBuffer);
    merged.set(samples, this.audioBuffer.length);
    this.audioBuffer = merged;
  }

  sendMessage() {
    throw new Error('Not implemented');
  }

  protected closeSession(reason?: string): void {
    log('closeSession %s', reason ?? '');
    this.worker?.terminate();
    this.worker = null;
    this.audioBuffer = new Float32Array(0);
    this.talking = false;
  }
}
