import { GradiumClient, type SttRealtime } from '@gradium/sdk';
import { BaseProvider } from '../base.ts';
import debug from 'debug';

const log = debug('realtime:gradium-stt');

export const AUDIO_SAMPLE_RATE = 24000;
export const DEFAULT_MODEL = 'default';
export const DEFAULT_LANGUAGE = 'en';
export const DEFAULT_DELAY_IN_FRAMES = 16;
export const DEFAULT_VAD_THRESHOLD = 0.5;
export const DEFAULT_VAD_CONSECUTIVE_STEPS = 3;

export const DELAY_IN_FRAMES_OPTIONS = [7, 8, 10, 12, 14, 16, 20, 24, 32, 36, 48] as const;

export type GradiumSTTOptions = {
  apiKey: string;
  model?: string;
  language?: string;
  delayInFrames?: number;
  vadThreshold?: number;
  vadConsecutiveSteps?: number;
  chunkMs?: number;
};

export class GradiumSTT extends BaseProvider {
  private readonly client: GradiumClient;
  private readonly model: string;
  private readonly language: string;
  private readonly delayInFrames: number;
  private readonly vadThreshold: number;
  private readonly vadConsecutiveSteps: number;
  private readonly chunkMs: number;
  private session: SttRealtime | null = null;
  private transcript: string[] = [];
  private highVadSteps = 0;
  private flushId = 0;
  private flushing = false;

  constructor(options: GradiumSTTOptions) {
    super();
    this.client = new GradiumClient({ apiKey: options.apiKey });
    this.model = options.model ?? DEFAULT_MODEL;
    this.language = options.language ?? DEFAULT_LANGUAGE;
    this.delayInFrames = options.delayInFrames ?? DEFAULT_DELAY_IN_FRAMES;
    this.vadThreshold = options.vadThreshold ?? DEFAULT_VAD_THRESHOLD;
    this.vadConsecutiveSteps = options.vadConsecutiveSteps ?? DEFAULT_VAD_CONSECUTIVE_STEPS;
    this.chunkMs = options.chunkMs ?? 80;
  }

  async start() {
    if (this.running) {
      return;
    }
    this.running = true;
    log('start model=%s language=%s delay=%d', this.model, this.language, this.delayInFrames);

    this.notify(
      `Connecting to Gradium STT with model ${this.model}, language ${this.language}...\n`,
    );

    try {
      this.session = await this.client
        .sttRealtime({
          model_name: this.model,
          input_format: 'pcm',
          json_config: {
            language: this.language,
            delay_in_frames: this.delayInFrames,
          },
        })
        .connect();

      void this.listen();

      await this.setupSourceAudio(
        this.chunkMs,
        binary => {
          if (!this.session || !this.running) return;
          void this.session.sendAudio(new Uint8Array(binary as ArrayBuffer));
        },
        false,
        AUDIO_SAMPLE_RATE,
      );
    } catch (error) {
      log('error: %o', error);
      this.stop('Failed to start session');
      throw error;
    }
  }

  private async listen() {
    const session = this.session;
    if (!session) return;

    try {
      for await (const msg of session) {
        if (!this.running) break;

        if (msg.type === 'text') {
          const text = msg.text?.trim();
          if (text) {
            log('text: %s', text);
            this.transcript.push(text);
          }
          continue;
        }

        if (msg.type === 'step') {
          const horizon = msg.vad?.[msg.vad.length - 1];
          const inactivity = horizon?.inactivity_prob ?? 0;
          this.highVadSteps = inactivity > this.vadThreshold ? this.highVadSteps + 1 : 0;

          if (
            !this.flushing &&
            this.highVadSteps >= this.vadConsecutiveSteps &&
            this.transcript.length > 0
          ) {
            this.flushing = true;
            this.flushId += 1;
            log('flush turn id=%d', this.flushId);
            void session.sendFlush(this.flushId);
          }
          continue;
        }

        if (msg.type === 'flushed') {
          const text = this.transcript.join(' ').trim();
          this.transcript = [];
          this.highVadSteps = 0;
          this.flushing = false;
          if (text) {
            log('final: %s', text);
            this.emit('text', text);
          }
          continue;
        }

        if (msg.type === 'error') {
          log('error: %s', msg.message ?? '');
          this.emit('error', new Error(msg.message || 'Gradium STT error'));
        }
      }
    } catch (error) {
      if (!this.running) return;
      log('listen error: %o', error);
      this.stop(error instanceof Error ? error.message : 'Gradium STT connection error');
    }
  }

  sendMessage() {
    throw new Error('Not implemented');
  }

  protected closeSession(reason?: string): void {
    log('closeSession %s', reason ?? '');
    const session = this.session;
    this.session = null;
    this.transcript = [];
    this.highVadSteps = 0;
    this.flushing = false;
    try {
      session?.close();
    } catch (error) {
      log('close error: %o', error);
    }
  }
}
