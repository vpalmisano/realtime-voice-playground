import OpenAI from 'openai';
import { BaseProvider } from '../base.ts';
import debug from 'debug';

const log = debug('realtime:openai-tts');

export const AUDIO_SAMPLE_RATE = 24000;
export const DEFAULT_MODEL = 'gpt-4o-mini-tts';
export const DEFAULT_VOICE = 'coral';

export type OpenAITTSOptions = {
  apiKey: string;
  model?: string;
  voice?: string;
  instructions?: string;
};

export class OpenAITTS extends BaseProvider {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly voice: string;
  private readonly instructions?: string;
  private push: ((bytes: Uint8Array<ArrayBuffer>) => void) | null = null;
  private abortController: AbortController | null = null;

  constructor(options: OpenAITTSOptions) {
    super();
    this.client = new OpenAI({
      apiKey: options.apiKey,
      dangerouslyAllowBrowser: true,
    });
    this.model = options.model ?? DEFAULT_MODEL;
    this.voice = options.voice ?? DEFAULT_VOICE;
    this.instructions = options.instructions;
  }

  async start() {
    if (this.running) {
      return;
    }
    this.running = true;
    log('start model=%s voice=%s', this.model, this.voice);

    this.notify(`OpenAI TTS ready with model ${this.model}, voice ${this.voice}...\n`);

    const { push } = await this.setupOutputAudio(AUDIO_SAMPLE_RATE, 'mp3');
    this.push = push as (bytes: Uint8Array<ArrayBuffer>) => void;
  }

  flush(): void {
    this.abortController?.abort();
    this.abortController = null;
    super.flush();
  }

  sendMessage(message: string) {
    if (!this.running || !this.push || !this.flush) {
      throw new Error('OpenAI TTS is not running');
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
      const response = await this.client.audio.speech.create(
        {
          model: this.model,
          voice: this.voice as 'alloy',
          input: text,
          response_format: 'mp3',
          ...(this.instructions ? { instructions: this.instructions } : {}),
        },
        { signal: abortController.signal },
      );

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No reader available');
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
