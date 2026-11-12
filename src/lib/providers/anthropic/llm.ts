import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { DEFAULT_CONTEXT, BaseProvider } from '../base.ts';
import debug from 'debug';
import { TextAggregator, type LLMTextAggregation } from '../../text.ts';

const log = debug('realtime:anthropic-llm');

export type AnthropicLLMOptions = {
  apiKey: string;
  model?: string;
  context?: string;
  maxUserMessages?: number;
  maxTokens?: number;
  textAggregation?: LLMTextAggregation;
};

export const DEFAULT_MODEL = 'claude-sonnet-5-5';
export const DEFAULT_MAX_TOKENS = 1024;

export class AnthropicLLM extends BaseProvider {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly context: string;
  private readonly maxUserMessages: number;
  private readonly maxTokens: number;
  private readonly textAggregator: TextAggregator;
  private readonly messages: MessageParam[] = [];
  private abortController: AbortController | null = null;

  constructor(options: AnthropicLLMOptions) {
    super();
    this.client = new Anthropic({
      apiKey: options.apiKey,
      dangerouslyAllowBrowser: true,
    });
    this.model = options.model ?? DEFAULT_MODEL;
    this.context = options.context ?? DEFAULT_CONTEXT;
    this.maxUserMessages = options.maxUserMessages ?? 20;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.textAggregator = new TextAggregator(options.textAggregation);
    this.textAggregator.on('text', text => this.emit('text', text));
  }

  async start() {
    if (this.running) {
      return;
    }
    log('start model=%s', this.model);
    this.running = true;
    this.notify(`Anthropic LLM ready with model ${this.model}`);
  }

  sendMessage(message: string): void {
    if (!this.running) {
      throw new Error('Anthropic LLM is not running');
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
    while (this.messages.filter(m => m.role === 'user').length > this.maxUserMessages) {
      log('maxUserMessages reached, shifting oldest message');
      this.messages.shift();
    }

    try {
      const stream = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: this.maxTokens,
          system: this.context,
          messages: this.messages,
          stream: true,
        },
        { signal: abortController.signal },
      );

      let assistantText = '';
      let promptTokens = 0;
      let responseTokens = 0;

      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta' &&
          event.delta.text
        ) {
          assistantText += event.delta.text;
          this.textAggregator.append(event.delta.text);
        } else if (event.type === 'message_start') {
          promptTokens = event.message.usage.input_tokens ?? promptTokens;
        } else if (event.type === 'message_delta') {
          responseTokens = event.usage.output_tokens ?? responseTokens;
          if (event.usage.input_tokens != null) {
            promptTokens = event.usage.input_tokens;
          }
        }
      }

      this.promptTokenCount += promptTokens;
      this.responseTokenCount += responseTokens;

      assistantText = assistantText.trim();
      if (assistantText) {
        this.messages.push({ role: 'assistant', content: assistantText });
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
  }
}
