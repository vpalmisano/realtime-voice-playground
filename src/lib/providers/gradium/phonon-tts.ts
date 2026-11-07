import { PhononTTS, type Quant } from 'phonon-tts';
import { AwaitQueue, AwaitQueueRemovedTaskError, AwaitQueueStoppedError } from 'awaitqueue';
import { BaseProvider, type VadOptions } from '../base.ts';
import { DEFAULT_VOICE_ID, PHONON_VOICE_URLS } from './phonon-voices.ts';
import debug from 'debug';

const log = debug('realtime:gradium-phonon-tts');

export const AUDIO_SAMPLE_RATE = 24000;
const MODEL_REV = '8c64b55ec301728e2d1695bfea87a08a267d0c2d';
const MODEL_BASE = `https://huggingface.co/gradium/phonon-31m-en/resolve/${MODEL_REV}`;

export { DEFAULT_VOICE_ID };
export const DEFAULT_QUANT = 'q8' as const;
export const PHONON_QUANTS = ['q8', 'f32'] as const;
export type PhononQuant = (typeof PHONON_QUANTS)[number];
export const PHONON_DEVICES = ['auto', 'webgpu', 'cpu'] as const;
export type PhononDevice = (typeof PHONON_DEVICES)[number];

export type GradiumPhononTTSOptions = {
  voiceId?: string;
  quant?: PhononQuant;
  device?: PhononDevice;
};

export class GradiumPhononTTS extends BaseProvider {
  private readonly voiceId: string;
  private readonly quant: PhononQuant;
  private readonly preferredDevice: PhononDevice;
  private readonly asyncQueue = new AwaitQueue();
  private push: ((chunk: Float32Array) => void) | null = null;
  private abortController: AbortController | null = null;
  private tts: PhononTTS | null = null;
  private activeStream: { cancel: () => void } | null = null;

  constructor(options: GradiumPhononTTSOptions = {}, vadOptions?: VadOptions) {
    super();
    this.voiceId = options.voiceId ?? DEFAULT_VOICE_ID;
    this.quant = options.quant ?? DEFAULT_QUANT;
    this.preferredDevice = options.device ?? 'auto';
    this.vadOptions = vadOptions;
  }

  async start() {
    if (this.running) {
      return;
    }
    this.running = true;
    log(
      'start voice=%s quant=%s device=%s isolated=%s',
      this.voiceId,
      this.quant,
      this.preferredDevice,
      crossOriginIsolated,
    );
    this.notify(
      `Loading Gradium Phonon (${this.quant} / ${this.preferredDevice}` +
        `${crossOriginIsolated ? ', threaded' : ', single-thread'})...\n`,
    );

    try {
      const tts = await PhononTTS.load({
        lang: 'en',
        quant: this.quant as Quant,
        device: this.preferredDevice,
        model: {
          weights: {
            q8: `${MODEL_BASE}/model.q8.gguf`,
            f32: `${MODEL_BASE}/model.safetensors`,
          },
          tokenizer: `${MODEL_BASE}/tokenizer.json`,
          config: `${MODEL_BASE}/config.json`,
          voices: { ...PHONON_VOICE_URLS },
          defaultVoice: this.voiceId,
        },
        voices: [this.voiceId],
      });
      if (!this.running) {
        tts.dispose();
        return;
      }

      this.tts = tts;
      const { push } = await this.setupOutputAudio(tts.sampleRate || AUDIO_SAMPLE_RATE, 'f32');
      this.push = push;
      this.notify(
        `Gradium Phonon ready (voice ${this.voiceId}, ${tts.device}` +
          `${tts.device === 'cpu' ? ` ×${tts.threads}` : ''}).\n`,
      );
      if (!crossOriginIsolated) {
        this.notify(
          `> Note: page is not cross-origin isolated (${tts.threadsReason}). ` +
            `Serve with COOP/COEP for multi-thread CPU.\n`,
        );
      }
    } catch (error) {
      log('start error: %o', error);
      this.notify(`> Error: ${error instanceof Error ? error.message : 'Unknown error'}\n`);
      this.stop('Failed to start Gradium Phonon TTS');
      throw error;
    }
  }

  flush(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.activeStream?.cancel();
    this.activeStream = null;
    while (this.asyncQueue.size > 1) {
      this.asyncQueue.remove(this.asyncQueue.size - 1);
    }
    super.flush();
  }

  sendMessage(message: string) {
    if (!this.running || !this.push || !this.tts) {
      throw new Error('Gradium Phonon TTS is not running');
    }
    const text = message.trim();
    if (!text) {
      return;
    }
    void this.asyncQueue
      .push(() => this.synthesize(text))
      .catch(error => {
        if (
          error instanceof AwaitQueueStoppedError ||
          error instanceof AwaitQueueRemovedTaskError
        ) {
          return;
        }
        log('queue error: %o', error);
      });
  }

  private async synthesize(text: string) {
    const tts = this.tts;
    if (!tts) {
      return;
    }

    log('synthesize: "%s"', text);
    const abortController = new AbortController();
    this.abortController = abortController;

    try {
      if (!tts.voices.includes(this.voiceId)) {
        const url = PHONON_VOICE_URLS[this.voiceId];
        if (!url) {
          throw new Error(`Unknown Phonon voice "${this.voiceId}"`);
        }
        await tts.addVoice(this.voiceId, url);
      }

      const stream = tts.stream(text, {
        voice: this.voiceId,
        signal: abortController.signal,
      });
      this.activeStream = stream;

      for await (const pcm of stream) {
        if (abortController.signal.aborted || !this.running) {
          stream.cancel();
          break;
        }
        if (pcm.length) {
          this.push?.(pcm);
        }
      }
      await stream.done.catch(() => undefined);
    } catch (error) {
      if (abortController.signal.aborted) {
        log('synthesize aborted');
        return;
      }
      log('synthesize error: %o', error);
      this.notify(`> Error: ${error instanceof Error ? error.message : 'Unknown error'}\n`);
    } finally {
      this.activeStream = null;
      if (this.abortController === abortController) {
        this.abortController = null;
      }
    }
  }

  protected closeSession(reason?: string): void {
    log('closeSession %s', reason ?? '');
    this.abortController?.abort();
    this.abortController = null;
    this.activeStream?.cancel();
    this.activeStream = null;
    this.asyncQueue.stop();
    this.push = null;
    this.tts?.dispose();
    this.tts = null;
  }
}
