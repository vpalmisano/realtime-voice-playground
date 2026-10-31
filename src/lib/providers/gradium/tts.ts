import { GradiumClient } from '@gradium/sdk';
import { BaseProvider } from '../base.ts';
import { bytesToBinaryString } from './utils.ts';
import debug from 'debug';

const log = debug('realtime:gradium-tts');

export const AUDIO_SAMPLE_RATE = 24000;
export const DEFAULT_MODEL = 'default';
/** Gradium flagship voice "Emma". */
export const DEFAULT_VOICE_ID = 'YTpq7expH9539ERJ';

export type GradiumTTSOptions = {
  apiKey: string;
  model?: string;
  voiceId?: string;
};

export class GradiumTTS extends BaseProvider {
  private readonly client: GradiumClient;
  private readonly model: string;
  private readonly voiceId: string;
  private push: ((chunk: string) => void) | null = null;
  private abortController: AbortController | null = null;

  constructor(options: GradiumTTSOptions) {
    super();
    this.client = new GradiumClient({ apiKey: options.apiKey });
    this.model = options.model ?? DEFAULT_MODEL;
    this.voiceId = options.voiceId ?? DEFAULT_VOICE_ID;
  }

  async start() {
    if (this.running) {
      return;
    }
    this.running = true;
    log('start model=%s voice=%s', this.model, this.voiceId);

    this.notify(`Gradium TTS ready with model ${this.model}, voice ${this.voiceId}...\n`);

    const { push } = await this.setupOutputAudio(AUDIO_SAMPLE_RATE);
    this.push = push as (chunk: string) => void;
  }

  flush(): void {
    this.abortController?.abort();
    this.abortController = null;
    super.flush();
  }

  sendMessage(message: string) {
    if (!this.running || !this.push) {
      throw new Error('Gradium TTS is not running');
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
      const stream = await this.client.ttsStream(
        {
          model_name: this.model,
          voice_id: this.voiceId,
          output_format: `pcm_${AUDIO_SAMPLE_RATE}`,
        },
        text,
        { signal: abortController.signal },
      );

      for await (const chunk of stream.iterBytes()) {
        if (abortController.signal.aborted || !this.running) {
          await stream.close();
          break;
        }
        if (chunk.length) {
          this.push?.(bytesToBinaryString(chunk));
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
