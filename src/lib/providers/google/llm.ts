import { GoogleGenAI, type Content } from '@google/genai';
import { DEFAULT_CONTEXT, BaseProvider } from '../base.ts';
import debug from 'debug';

const log = debug('realtime:google-llm');

export type GoogleLLMOptions = {
  apiKey: string;
  model?: string;
  context?: string;
  maxUserMessages?: number;
};

export const DEFAULT_MODEL = 'gemini-3.8-flash';

export class GoogleLLM extends BaseProvider {
  private readonly client: GoogleGenAI;
  private readonly model: string;
  private readonly context: string;
  private readonly maxUserMessages: number;
  private readonly messages: Content[] = [];
  private abortController: AbortController | null = null;

  constructor(options: GoogleLLMOptions) {
    super();
    this.client = new GoogleGenAI({ apiKey: options.apiKey });
    this.model = options.model ?? DEFAULT_MODEL;
    this.context = options.context ?? DEFAULT_CONTEXT;
    this.maxUserMessages = options.maxUserMessages ?? 20;
  }

  async start() {
    if (this.running) {
      return;
    }
    log('start model=%s', this.model);
    this.running = true;
    this.notify(`Google LLM ready with model ${this.model}...\n`);
  }

  sendMessage(message: string): void {
    if (!this.running) {
      throw new Error('Google LLM is not running');
    }
    const text = message.trim();
    if (!text) {
      return;
    }
    void this.generate(text);
  }

  private async generate(userMessage: string) {
    log('generate user=%s', userMessage);
    this.abortController?.abort();
    const abortController = new AbortController();
    this.abortController = abortController;

    this.messages.push({ role: 'user', parts: [{ text: userMessage }] });
    while (this.messages.filter(m => m.role === 'user').length > this.maxUserMessages) {
      log('maxUserMessages reached, shifting oldest message');
      this.messages.shift();
    }

    try {
      const stream = await this.client.models.generateContentStream({
        model: this.model,
        contents: this.messages,
        config: {
          systemInstruction: this.context,
          abortSignal: abortController.signal,
        },
      });

      let assistantText = '';
      let promptTokens = 0;
      let responseTokens = 0;

      for await (const chunk of stream) {
        if (chunk.text) {
          assistantText += chunk.text;
        }
        const usage = chunk.usageMetadata;
        if (usage) {
          promptTokens = usage.promptTokenCount ?? promptTokens;
          responseTokens = usage.candidatesTokenCount ?? responseTokens;
        }
      }

      this.promptTokenCount += promptTokens;
      this.responseTokenCount += responseTokens;

      assistantText = assistantText.trim();
      log('generate complete: %s', assistantText);

      if (assistantText) {
        this.messages.push({ role: 'model', parts: [{ text: assistantText }] });
        this.emit('text', assistantText);
      }
    } catch (error) {
      if (abortController.signal.aborted) {
        log('generate aborted');
        return;
      }
      log('generate error: %o', error);
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
    this.messages.splice(0, this.messages.length);
  }
}
