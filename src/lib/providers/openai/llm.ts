import OpenAI from 'openai';
import type { ResponseInputItem } from 'openai/resources/responses/responses';
import { DEFAULT_CONTEXT, BaseProvider } from '../base.ts';
import debug from 'debug';

const log = debug('realtime:openai-llm');

export type OpenAILLMOptions = {
  apiKey: string;
  model?: string;
  context?: string;
  maxUserMessages?: number;
};

export const DEFAULT_MODEL = 'gpt-5.4';

export class OpenAILLM extends BaseProvider {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly context: string;
  private readonly maxUserMessages: number;
  private readonly messages: ResponseInputItem[] = [];
  private abortController: AbortController | null = null;

  constructor(options: OpenAILLMOptions) {
    super();
    this.client = new OpenAI({
      apiKey: options.apiKey,
      dangerouslyAllowBrowser: true,
    });
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
    this.notify(`OpenAI LLM ready with model ${this.model}...\n`);
  }

  sendMessage(message: string): void {
    if (!this.running) {
      throw new Error('OpenAI LLM is not running');
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

    this.messages.push({ role: 'user', content: userMessage });
    if (this.messages.length > this.maxUserMessages) {
      log('maxUserMessages reached, shifting oldest message');
      this.messages.shift();
    }

    try {
      const stream = await this.client.responses.create(
        {
          model: this.model,
          input: [{ role: 'system', content: this.context }, ...this.messages],
          stream: true,
        },
        { signal: abortController.signal },
      );

      let assistantText = '';

      for await (const event of stream) {
        if (event.type === 'response.output_text.delta') {
          assistantText += event.delta;
        } else if (event.type === 'response.completed') {
          log('response.completed', assistantText);
          const usage = event.response.usage;
          if (usage) {
            this.promptTokenCount += usage.input_tokens;
            this.responseTokenCount += usage.output_tokens;
          }
          assistantText = assistantText.trim();
        } else if (event.type === 'error') {
          throw new Error(event.message || 'OpenAI LLM stream error');
        }
      }

      if (assistantText) {
        this.messages.push({ role: 'assistant', content: assistantText });
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
