import { GoogleGenAI, Modality, Session } from '@google/genai';
import { DEFAULT_CONTEXT, BaseProvider, type VadOptions } from '../base.ts';
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
  readonly name = 'GoogleAIRealtime';
  private model: string;
  private voice: string;
  private apiKey: string;
  private context: string;
  private readonly chunkMs: number;
  private session: Session | null = null;
  private pendingUserText = '';
  private pendingAssistantText = '';

  constructor(options: GoogleRealtimeOptions, vadOptions?: VadOptions) {
    super();
    this.model = options.model ?? DEFAULT_MODEL;
    this.voice = options.voice ?? DEFAULT_VOICE;
    this.apiKey = options.apiKey;
    this.context = options.context ?? DEFAULT_CONTEXT;
    this.chunkMs = options.chunkMs ?? 80;
    this.vadOptions = vadOptions;
  }

  async start() {
    if (this.running) {
      return;
    }
    log('start');
    this.running = true;

    this.notify(`Connecting to Google AI with model ${this.model}, voice ${this.voice}...`);

    try {
      const { push, flush } = await this.setupOutputAudio(24000);

      const ai = new GoogleGenAI({ apiKey: this.apiKey, apiVersion: 'v1beta' });

      const config = {
        responseModalities: [Modality.AUDIO],
        systemInstruction: this.context,
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: this.voice },
          },
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
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
                    push(atob(audioData));
                  }
                }
              }
            }
            if (content?.inputTranscription?.text) {
              this.pendingUserText += content.inputTranscription.text;
              if (content.inputTranscription.finished) {
                this.flushUserText();
              }
            }
            if (content?.outputTranscription?.text) {
              // Model started responding — user turn is done.
              this.flushUserText();
              this.pendingAssistantText += content.outputTranscription.text;
              if (content.outputTranscription.finished) {
                this.flushAssistantText();
              }
            }
            if (content?.generationComplete) {
              log('generationComplete: %o', content.generationComplete);
            }
            if (content?.turnComplete) {
              log('turnComplete: %o', content.turnComplete);
              this.flushUserText();
              this.flushAssistantText();
            }
            if (content?.interrupted) {
              log('interrupted');
              flush();
              this.flushUserText();
              this.flushAssistantText();
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
        binary => {
          this.session?.sendRealtimeInput({
            audio: {
              data: btoa(binary as string),
              mimeType: 'audio/pcm;rate=16000',
            },
          });
        },
        this.chunkMs,
        16000,
        'i16',
        'string',
      );
    } catch (error) {
      log('error: %o', error);
      this.stop('Failed to start session');
      throw error;
    }
  }

  sendMessage(message: string) {
    const text = message.trim();
    if (!text) {
      return;
    }
    this.emit('user-text', text);
    this.session?.sendRealtimeInput({
      text,
    });
  }

  protected closeSession(reason?: string): void {
    log('closeSession %s', reason ?? '');
    this.pendingUserText = '';
    this.pendingAssistantText = '';
    this.session?.close();
    this.session = null;
  }

  private flushUserText() {
    const text = this.pendingUserText.trim();
    this.pendingUserText = '';
    if (text) {
      log('user-text: %s', text);
      this.emit('user-text', text);
    }
  }

  private flushAssistantText() {
    const text = this.pendingAssistantText.trim();
    this.pendingAssistantText = '';
    if (text) {
      log('assistant-text: %s', text);
      this.emit('assistant-text', text);
    }
  }
}
