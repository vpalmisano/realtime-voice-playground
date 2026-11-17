import { AssemblyAI } from 'assemblyai';
import { AwaitQueue, AwaitQueueRemovedTaskError, AwaitQueueStoppedError } from 'awaitqueue';
import { BaseProvider, type VadOptions } from '../base.ts';
import debug from 'debug';

const log = debug('realtime:assemblyai-tts');

export const AUDIO_SAMPLE_RATE = 24000;
export const DEFAULT_MODEL = 'assemblyai-tts-1';
export const DEFAULT_VOICE_ID = 'aai-kyla';
export const DEFAULT_REGION = 'us';

export type AssemblyAITTSOptions = {
  apiKey: string;
  model?: string;
  voiceId?: string;
  language?: string;
  region?: 'us' | 'eu';
};

export class AssemblyAITTS extends BaseProvider {
  readonly name = 'AssemblyAITTS';
  private readonly client: AssemblyAI;
  private readonly model: string;
  private readonly voiceId: string;
  private readonly language?: string;
  private readonly asyncQueue = new AwaitQueue();
  private push: ((chunk: string | Uint8Array) => void) | null = null;
  private abortController: AbortController | null = null;

  constructor(options: AssemblyAITTSOptions, vadOptions?: VadOptions) {
    super();
    this.model = options.model ?? DEFAULT_MODEL;
    this.voiceId = options.voiceId ?? DEFAULT_VOICE_ID;
    this.language = options.language || undefined;
    const region = options.region ?? DEFAULT_REGION;
    this.client = new AssemblyAI({
      apiKey: options.apiKey,
      ttsBaseUrl: `https://tts.${region}.assemblyai.com`,
    });
    this.vadOptions = vadOptions;
  }

  async start() {
    if (this.running) {
      return;
    }
    this.running = true;
    log('start model=%s voice=%s language=%s', this.model, this.voiceId, this.language ?? '');

    this.notify(
      `AssemblyAI TTS ready with model ${this.model}, voice ${this.voiceId}${
        this.language ? `, language ${this.language}` : ''
      }...`,
    );

    const { push } = await this.setupOutputAudio(AUDIO_SAMPLE_RATE);
    this.push = push;
  }

  flush(): void {
    this.abortController?.abort();
    this.abortController = null;
    while (this.asyncQueue.size > 1) {
      this.asyncQueue.remove(this.asyncQueue.size - 1);
    }
    super.flush();
  }

  sendMessage(message: string) {
    if (!this.running || !this.push) {
      throw new Error('AssemblyAI TTS is not running');
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
    log('synthesize: "%s"', text);
    const abortController = new AbortController();
    this.abortController = abortController;

    try {
      const speech = await this.client.tts.stream(
        {
          text,
          voice_id: this.voiceId,
          model_id: this.model,
          encoding: 'pcm_s16le',
          sample_rate: AUDIO_SAMPLE_RATE,
          container: 'raw',
          ...(this.language
            ? {
                language: this.language as
                  'english' | 'spanish' | 'german' | 'french' | 'italian' | 'portuguese',
              }
            : {}),
        },
        { signal: abortController.signal },
      );

      for await (const value of speech) {
        if (!this.running || abortController.signal.aborted) {
          speech.cancel();
          break;
        }
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
      this.notifyError(error instanceof Error ? error.message : 'Unknown error');
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
    this.asyncQueue.stop();
    this.push = null;
  }
}
