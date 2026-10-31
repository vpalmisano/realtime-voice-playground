import { SpeechifyClient } from '@speechify/api';
import { BaseProvider } from '../base.ts';
import debug from 'debug';

const log = debug('realtime:speechify-tts');

export const AUDIO_SAMPLE_RATE = 24000;
export const DEFAULT_MODEL = 'simba-3.5';
export const DEFAULT_VOICE_ID = 'geffen_32';

export type SpeechifyTTSOptions = {
  apiKey: string;
  model?: string;
  voiceId?: string;
  language?: string;
};

export class SpeechifyTTS extends BaseProvider {
  private readonly client: SpeechifyClient;
  private readonly model: string;
  private readonly voiceId: string;
  private readonly language?: string;
  private push: ((bytes: Uint8Array<ArrayBuffer>) => void) | null = null;
  private abortController: AbortController | null = null;

  constructor(options: SpeechifyTTSOptions) {
    super();
    this.client = new SpeechifyClient({ token: options.apiKey });
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
      `Speechify TTS ready with model ${this.model}, voice ${this.voiceId}${
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
      throw new Error('Speechify TTS is not running');
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
      const response = await this.client.audio.stream(
        {
          Accept: 'audio/mpeg',
          body: {
            input: text,
            voice_id: this.voiceId,
            model: this.model as 'simba-3.5',
            output_format: 'mp3_24000_128',
            ...(this.language ? { language: this.language } : {}),
          },
        },
        { abortSignal: abortController.signal },
      );

      const stream = response.stream();
      if (!stream) {
        throw new Error('No stream available from Speechify TTS');
      }

      const reader = stream.getReader();
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
