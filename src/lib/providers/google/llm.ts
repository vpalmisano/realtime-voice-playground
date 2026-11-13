import { GoogleGenAI, type Content } from '@google/genai';
import { DEFAULT_CONTEXT, BaseProvider } from '../base.ts';
import debug from 'debug';
import { TextAggregator, type LLMTextAggregation } from '../../text.ts';

const log = debug('realtime:google-llm');

export type GoogleLLMOptions = {
  apiKey: string;
  model?: string;
  context?: string;
  maxUserMessages?: number;
  usePromptCache?: boolean;
  textAggregation?: LLMTextAggregation;
};

export const DEFAULT_MODEL = 'gemini-3.8-flash';
export const DEFAULT_USE_PROMPT_CACHE = true;

export class GoogleLLM extends BaseProvider {
  private readonly client: GoogleGenAI;
  private readonly model: string;
  private readonly context: string;
  private readonly maxUserMessages: number;
  private readonly usePromptCache: boolean;
  private readonly textAggregator: TextAggregator;
  private readonly messages: Content[] = [];
  private cachedContentName: string | null = null;
  private abortController: AbortController | null = null;

  constructor(options: GoogleLLMOptions) {
    super();
    this.client = new GoogleGenAI({ apiKey: options.apiKey });
    this.model = options.model ?? DEFAULT_MODEL;
    this.context = options.context ?? DEFAULT_CONTEXT;
    this.maxUserMessages = options.maxUserMessages ?? 20;
    this.usePromptCache = options.usePromptCache ?? DEFAULT_USE_PROMPT_CACHE;
    this.textAggregator = new TextAggregator(options.textAggregation);
    this.textAggregator.on('text', text => this.emit('text', text));
  }

  private async ensurePromptCache(): Promise<void> {
    if (!this.usePromptCache || this.cachedContentName || !this.context.trim()) {
      return;
    }
    try {
      const cache = await this.client.caches.create({
        model: this.model,
        config: {
          systemInstruction: this.context,
          ttl: '3600s',
          displayName: `realtime-google-llm-${crypto.randomUUID().slice(0, 8)}`,
        },
      });
      if (cache.name) {
        this.cachedContentName = cache.name;
        log('prompt cache created name=%s', cache.name);
      }
    } catch (error) {
      log('prompt cache create skipped: %o', error);
      this.cachedContentName = null;
    }
  }

  private async clearPromptCache(): Promise<void> {
    const name = this.cachedContentName;
    this.cachedContentName = null;
    if (!name) {
      return;
    }
    try {
      await this.client.caches.delete({ name });
      log('prompt cache deleted name=%s', name);
    } catch (error) {
      log('prompt cache delete error: %o', error);
    }
  }

  async start() {
    if (this.running) {
      return;
    }
    log('start model=%s promptCache=%s', this.model, this.usePromptCache);
    this.running = true;
    await this.ensurePromptCache();
    this.notify(`Google LLM ready with model ${this.model}`);
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
          ...(this.cachedContentName
            ? { cachedContent: this.cachedContentName }
            : { systemInstruction: this.context }),
          abortSignal: abortController.signal,
        },
      });

      let assistantText = '';
      let promptTokens = 0;
      let responseTokens = 0;
      let cachedTokens = 0;

      for await (const chunk of stream) {
        if (chunk.text) {
          assistantText += chunk.text;

          this.textAggregator.append(chunk.text);
        }
        const usage = chunk.usageMetadata;
        if (usage) {
          promptTokens = usage.promptTokenCount ?? promptTokens;
          responseTokens = usage.candidatesTokenCount ?? responseTokens;
          cachedTokens = usage.cachedContentTokenCount ?? cachedTokens;
        }
      }

      this.promptTokenCount += promptTokens;
      this.responseTokenCount += responseTokens;
      if (this.usePromptCache) {
        log('prompt cache cached_tokens=%d input=%d', cachedTokens, promptTokens);
      }

      assistantText = assistantText.trim();

      if (assistantText) {
        this.messages.push({ role: 'model', parts: [{ text: assistantText }] });
      }

      this.textAggregator.flush();
    } catch (error) {
      if (abortController.signal.aborted) {
        log('generate aborted');
        return;
      }
      log('generate error: %o', error);
      this.notify(`> Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      if (this.abortController === abortController) {
        this.abortController = null;
      }
    }
  }

  protected closeSession(reason?: string): void {
    log('closeSession %s', reason ?? '');
    this.textAggregator.removeAllListeners();
    this.textAggregator.clear();
    this.abortController?.abort();
    this.abortController = null;
    this.messages.length = 0;
    void this.clearPromptCache();
  }
}
