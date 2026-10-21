import { GoogleGenAI, Modality, Session } from '@google/genai';
import { appendMessage } from '../MessagesLog.vue';
import { arrayBufferToBase64, processInputAudioTrack, processOutputAudioTrack } from './utils.ts';
import { DEFAULT_CONTEXT, ProviderSession } from './provider';
import debug from 'debug';

const log = debug('realtime:google');

export type GoogleSessionOptions = {
  model?: string;
  voice?: string;
  apiKey: string;
  context?: string;
};

export const DEFAULT_MODEL = 'gemini-3.8-live';
export const DEFAULT_VOICE = 'Puck';
export const MODELS = [
  'gemini-3.8-live',
  'gemini-3.8-live-extended-thinking',
  'gemini-3.1-flash-live-preview',
  'gemini-2.5-flash-native-audio-preview-12-2025',
] as const;
export const VOICES = [
  'Achernar',
  'Achird',
  'Algenib',
  'Algieba',
  'Alnilam',
  'Aoede',
  'Autonoe',
  'Callirrhoe',
  'Charon',
  'Despina',
  'Enceladus',
  'Erinome',
  'Fenrir',
  'Gacrux',
  'Iapetus',
  'Kore',
  'Laomedeia',
  'Leda',
  'Orus',
  'Puck',
  'Pulcherrima',
  'Rasalgethi',
  'Sadachbia',
  'Sadaltager',
  'Schedar',
  'Sulafat',
  'Umbriel',
  'Vindemiatrix',
  'Zephyr',
  'Zubenelgenubi',
] as const;

export class GoogleAISession extends ProviderSession {
  public readonly transportType = 'websocket';
  private model: string;
  private voice: string;
  private apiKey: string;
  private context: string;
  private session: Session | null = null;

  constructor(options: GoogleSessionOptions) {
    super();
    this.model = options.model ?? DEFAULT_MODEL;
    this.voice = options.voice ?? DEFAULT_VOICE;
    this.apiKey = options.apiKey;
    this.context = options.context ?? DEFAULT_CONTEXT;
  }

  async start() {
    if (this.running) {
      return;
    }
    log('start');
    this.running = true;

    await appendMessage(
      `Connecting to Google AI via ${this.transportType} with model ${this.model}, voice ${this.voice}...\n`,
    );

    try {
      const { push, flush, track, close } = await processOutputAudioTrack(24000);
      this.outputAudioTrack = track;
      this.closeAudioContext = close;

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
                    push(atob(audioData));
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

      const sourceAudioTrack = await this.getMediaStream();

      const { close: closeInput } = await processInputAudioTrack(sourceAudioTrack, 16000, pcm16 =>
        this.session?.sendRealtimeInput({
          audio: {
            data: arrayBufferToBase64(pcm16),
            mimeType: 'audio/pcm;rate=16000',
          },
        }),
      );
      this.closeInputAudio = closeInput;
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
