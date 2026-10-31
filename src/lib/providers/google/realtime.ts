import { GoogleGenAI, Modality, Session } from '@google/genai';
import { DEFAULT_CONTEXT, BaseProvider } from '../base.ts';
import debug from 'debug';

const log = debug('realtime:google');

export type GoogleRealtimeOptions = {
  model?: string;
  voice?: string;
  apiKey: string;
  context?: string;
  chunkMs?: number;
};

export const DEFAULT_MODEL = 'gemini-3.8-live';
export const DEFAULT_VOICE = 'Puck';

export class GoogleAIRealtime extends BaseProvider {
  private model: string;
  private voice: string;
  private apiKey: string;
  private context: string;
  private readonly chunkMs: number;
  private session: Session | null = null;

  constructor(options: GoogleRealtimeOptions) {
    super();
    this.model = options.model ?? DEFAULT_MODEL;
    this.voice = options.voice ?? DEFAULT_VOICE;
    this.apiKey = options.apiKey;
    this.context = options.context ?? DEFAULT_CONTEXT;
    this.chunkMs = options.chunkMs ?? 80;
  }

  async start() {
    if (this.running) {
      return;
    }
    log('start');
    this.running = true;

    this.notify(`Connecting to Google AI with model ${this.model}, voice ${this.voice}...\n`);

    try {
      const { push, flush } = await this.setupOutputAudio(24000);
      const pushAudio = push as (chunk: string) => void;

      const ai = new GoogleGenAI({ apiKey: this.apiKey });

      const config = {
        responseModalities: [Modality.AUDIO],
        systemInstruction: this.context,
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: this.voice },
          },
        },
      };
      this.session = await ai.live.connect({
        model: this.model,
        callbacks: {
          onopen: () => {
            log('opened');
          },
          onmessage: message => {
            const content = message.serverContent;
            if (content?.modelTurn?.parts) {
              for (const part of content.modelTurn.parts) {
                if (part.inlineData) {
                  const audioData = part.inlineData.data;
                  if (audioData) {
                    pushAudio(atob(audioData));
                  }
                }
              }
            }
            if (content?.generationComplete) {
              log('generationComplete: %o', content.generationComplete);
            }
            if (content?.turnComplete) {
              log('turnComplete: %o', content.turnComplete);
            }
            if (content?.interrupted) {
              log('interrupted');
              flush();
            }
            if (message.usageMetadata) {
              const { promptTokenCount, responseTokenCount, totalTokenCount } =
                message.usageMetadata;
              log('usageMetadata: %o', {
                promptTokenCount,
                responseTokenCount,
                totalTokenCount,
              });
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
        config,
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

  sendMessage(message: string) {
    this.session?.sendRealtimeInput({
      text: message,
    });
  }

  protected closeSession(reason?: string): void {
    log('closeSession %s', reason ?? '');
    this.session?.close();
    this.session = null;
  }
}
