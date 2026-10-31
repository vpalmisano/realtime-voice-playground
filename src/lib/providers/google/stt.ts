import { AudioTranscriptionConfigMode, GoogleGenAI, Modality, Session } from '@google/genai';
import { BaseProvider } from '../base.ts';
import debug from 'debug';

const log = debug('realtime:google-stt');

export type GoogleSTTOptions = {
  apiKey: string;
  model?: string;
  mode?: 'VERBATIM' | 'SMART';
  chunkMs?: number;
};

export const DEFAULT_MODEL = 'gemini-3.5-transcribe-live';
export const TRANSCRIPTION_MODES = ['VERBATIM', 'SMART'] as const;

export class GoogleSTT extends BaseProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly mode: 'VERBATIM' | 'SMART';
  private readonly chunkMs: number;
  private session: Session | null = null;

  constructor(options: GoogleSTTOptions) {
    super();
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_MODEL;
    this.mode = options.mode ?? 'SMART';
    this.chunkMs = options.chunkMs ?? 80;
  }

  async start() {
    if (this.running) {
      return;
    }
    this.running = true;
    log('start model=%s mode=%s', this.model, this.mode);

    this.notify(`Connecting to Google STT with model ${this.model} (${this.mode})...\n`);

    try {
      const ai = new GoogleGenAI({ apiKey: this.apiKey });
      this.session = await ai.live.connect({
        model: this.model,
        config: {
          responseModalities: [Modality.TEXT],
          inputAudioTranscription: {
            languageCodes: [],
            mode:
              this.mode === 'SMART'
                ? AudioTranscriptionConfigMode.SMART
                : AudioTranscriptionConfigMode.VERBATIM,
          },
        },
        callbacks: {
          onopen: () => {
            log('opened');
          },
          onmessage: message => {
            const content = message.serverContent;
            if (!content) return;

            if (content.interimInputTranscription?.text) {
              log('interim: %s', content.interimInputTranscription.text);
            }

            const finalText = content.inputTranscription?.text?.trim();
            if (finalText) {
              log('final: %s', finalText);
              this.emit('text', finalText);
            }

            if (message.usageMetadata) {
              const { promptTokenCount, responseTokenCount } = message.usageMetadata;
              if (promptTokenCount) {
                this.promptTokenCount += promptTokenCount;
              }
              if (responseTokenCount) {
                this.responseTokenCount += responseTokenCount;
              }
            }
          },
          onerror: e => {
            log('error: %s', e.message);
          },
          onclose: e => {
            log('onclose: %s', e.reason);
            this.stop(e.reason);
          },
        },
      });

      await this.setupSourceAudio(
        this.chunkMs,
        binary => {
          this.session?.sendRealtimeInput({
            audio: {
              data: btoa(binary as string),
              mimeType: 'audio/pcm;rate=16000',
            },
          });
        },
        true,
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
    this.session?.close();
    this.session = null;
  }
}
