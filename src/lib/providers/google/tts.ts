import { GoogleGenAI, Modality } from '@google/genai';
import { BaseProvider } from '../base.ts';
import debug from 'debug';

const log = debug('realtime:google-tts');

export const AUDIO_SAMPLE_RATE = 24000;
export const DEFAULT_MODEL = 'gemini-3.8-flash-lite-tts';
export const DEFAULT_VOICE = 'Kore';

export type GoogleTTSOptions = {
  apiKey: string;
  model?: string;
  voice?: string;
};

export class GoogleTTS extends BaseProvider {
  private readonly client: GoogleGenAI;
  private readonly model: string;
  private readonly voice: string;
  private push: ((chunk: string) => void) | null = null;
  private abortController: AbortController | null = null;

  constructor(options: GoogleTTSOptions) {
    super();
    this.client = new GoogleGenAI({ apiKey: options.apiKey });
    this.model = options.model ?? DEFAULT_MODEL;
    this.voice = options.voice ?? DEFAULT_VOICE;
  }

  async start() {
    if (this.running) {
      return;
    }
    this.running = true;
    log('start model=%s voice=%s', this.model, this.voice);

    this.notify(`Google TTS ready with model ${this.model}, voice ${this.voice}...\n`);

    const { push } = await this.setupOutputAudio(AUDIO_SAMPLE_RATE);
    this.push = push as (chunk: string) => void;
  }

  flush(): void {
    this.abortController?.abort();
    this.abortController = null;
    super.flush();
  }

  sendMessage(message: string) {
    if (!this.running || !this.push || !this.flush) {
      throw new Error('Google TTS is not running');
    }
    const text = message.trim();
    if (!text) {
      return;
    }
    void this.synthesize(text);
  }

  private async synthesize(text: string) {
    log('synthesize: %s', text);
    this.abortController?.abort();
    const abortController = new AbortController();
    this.abortController = abortController;

    try {
      const stream = await this.client.models.generateContentStream({
        model: this.model,
        contents: [
          {
            role: 'user',
            parts: [{ text }],
          },
        ],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: this.voice },
            },
          },
          abortSignal: abortController.signal,
        },
      });

      let promptTokens = 0;
      let responseTokens = 0;

      for await (const chunk of stream) {
        if (abortController.signal.aborted) {
          break;
        }
        const data = chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (data) {
          this.push?.(atob(data));
        }
        const usage = chunk.usageMetadata;
        if (usage) {
          promptTokens = usage.promptTokenCount ?? promptTokens;
          responseTokens = usage.candidatesTokenCount ?? responseTokens;
        }
      }

      this.promptTokenCount += promptTokens;
      this.responseTokenCount += responseTokens;
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
