import Cartesia from '@cartesia/cartesia-js';
import { BaseProvider } from '../base.ts';
import debug from 'debug';

const log = debug('realtime:cartesia-tts');

export const AUDIO_SAMPLE_RATE = 24000;
export const DEFAULT_MODEL = 'sonic-latest';
/** Cartesia "Katie" voice. */
export const DEFAULT_VOICE_ID = 'f786b574-daa5-4673-aa0c-cbe3e8534c02';

export type CartesiaTTSOptions = {
  apiKey: string;
  model?: string;
  voiceId?: string;
  language?: string;
};

export class CartesiaTTS extends BaseProvider {
  private readonly client: Cartesia;
  private readonly model: string;
  private readonly voiceId: string;
  private readonly language?: string;
  private push: ((bytes: Uint8Array<ArrayBuffer>) => void) | null = null;
  private abortController: AbortController | null = null;

  constructor(options: CartesiaTTSOptions) {
    super();
    this.client = new Cartesia({ apiKey: options.apiKey });
    this.model = options.model ?? DEFAULT_MODEL;
    this.voiceId = options.voiceId ?? DEFAULT_VOICE_ID;
    this.language = options.language || undefined;
  }

  async start() {
    if (this.running) {
      return;
    }
    this.running = true;
    log('start model=%s voice=%s language=%s', this.model, this.voiceId, this.language ?? '');

    this.notify(
      `Cartesia TTS ready with model ${this.model}, voice ${this.voiceId}${
        this.language ? `, language ${this.language}` : ''
      }...\n`,
    );

    const { push } = await this.setupOutputAudio(AUDIO_SAMPLE_RATE, 'mp3');
    this.push = push as (bytes: Uint8Array<ArrayBuffer>) => void;
  }

  flush(): void {
    this.abortController?.abort();
    this.abortController = null;
    super.flush();
  }

  sendMessage(message: string) {
    if (!this.running || !this.push) {
      throw new Error('Cartesia TTS is not running');
    }
    const text = message.trim();
    if (!text) {
      return;
    }
    void this.synthesize(text);
  }

  private async synthesize(text: string) {
    log('synthesize: "%s"', text);
    this.abortController?.abort();
    const abortController = new AbortController();
    this.abortController = abortController;

    try {
      const response = await this.client.tts.generate(
        {
          model_id: this.model,
          transcript: text,
          voice: this.voiceId,
          output_format: {
            container: 'mp3',
            sample_rate: AUDIO_SAMPLE_RATE,
            bit_rate: 128000,
          },
          ...(this.language ? { language: this.language as 'en' } : {}),
        },
        { signal: abortController.signal },
      );

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No stream available from Cartesia TTS');
      }

      while (this.running) {
        if (abortController.signal.aborted) {
          await reader.cancel();
          break;
        }
        const { done, value } = await reader.read();
        if (done) break;
        if (value?.length) {
          this.push?.(value);
        }
      }
    } catch (error) {
      if (abortController.signal.aborted) {
        log('synthesize aborted');
        return;
      }
      log('synthesize error: %o', error);
      this.notify(`> Error: ${error instanceof Error ? error.message : 'Unknown error'}\n`);
    } finally {
      if (this.abortController === abortController) {
        this.abortController = null;
      }
    }
  }

  protected closeSession(reason?: string): void {
    log('closeSession %s', reason ?? '');
    this.abortController?.abort();
    this.abortController = null;
    this.push = null;
  }
}
