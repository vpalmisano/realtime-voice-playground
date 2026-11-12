import {
  InterruptableStoppingCriteria,
  TextStreamer,
  pipeline,
  type Message,
  type ProgressInfo,
  type TextGenerationPipeline,
} from '@huggingface/transformers';
import { DEFAULT_CONTEXT, BaseProvider } from '../base.ts';
import { TextAggregator, type LLMTextAggregation } from '../../text.ts';
import debug from 'debug';

const log = debug('realtime:nvidia-nemotron-llm');

export const MODEL_ID = 'onnx-community/NVIDIA-Nemotron-3-Nano-4B-BF16-ONNX';
export const DEFAULT_MAX_NEW_TOKENS = 512;
export const DEFAULT_ENABLE_THINKING = false;

export const NEMOTRON_LLM_DEVICES = ['webgpu', 'wasm'] as const;
export type NemotronLlmDevice = (typeof NEMOTRON_LLM_DEVICES)[number];

export type NvidiaNemotronLLMOptions = {
  device?: NemotronLlmDevice;
  context?: string;
  maxUserMessages?: number;
  maxNewTokens?: number;
  enableThinking?: boolean;
  textAggregation?: LLMTextAggregation;
};

const THINK_OPEN = '<think>';
const THINK_CLOSE = '</think>';

/** Streams only non-reasoning content past optional <think>…</think> blocks. */
class ThinkContentParser {
  content = '';
  private inThink = false;
  private buffer = '';

  push(text: string): string {
    this.buffer += text;
    let emitted = '';

    while (this.buffer.length > 0) {
      if (this.inThink) {
        const closeIndex = this.buffer.indexOf(THINK_CLOSE);
        if (closeIndex !== -1) {
          this.buffer = this.buffer.slice(closeIndex + THINK_CLOSE.length);
          this.inThink = false;
          continue;
        }
        const safe = this.safeFlushLength(this.buffer, THINK_CLOSE);
        this.buffer = this.buffer.slice(safe);
        break;
      }

      const openIndex = this.buffer.indexOf(THINK_OPEN);
      if (openIndex !== -1) {
        const chunk = this.buffer.slice(0, openIndex);
        if (chunk) {
          this.content += chunk;
          emitted += chunk;
        }
        this.buffer = this.buffer.slice(openIndex + THINK_OPEN.length);
        this.inThink = true;
        continue;
      }

      const safe = this.safeFlushLength(this.buffer, THINK_OPEN);
      if (safe > 0) {
        const chunk = this.buffer.slice(0, safe);
        this.content += chunk;
        emitted += chunk;
        this.buffer = this.buffer.slice(safe);
      }
      break;
    }

    return emitted;
  }

  flush(): string {
    if (!this.buffer || this.inThink) {
      this.buffer = '';
      return '';
    }
    const chunk = this.buffer;
    this.buffer = '';
    this.content += chunk;
    return chunk;
  }

  private safeFlushLength(buffer: string, tag: string): number {
    for (let overlap = Math.min(buffer.length, tag.length - 1); overlap > 0; overlap--) {
      if (buffer.endsWith(tag.slice(0, overlap))) {
        return buffer.length - overlap;
      }
    }
    return buffer.length;
  }
}

export class NvidiaNemotronLLM extends BaseProvider {
  private readonly device: NemotronLlmDevice;
  private readonly context: string;
  private readonly maxUserMessages: number;
  private readonly maxNewTokens: number;
  private readonly enableThinking: boolean;
  private readonly textAggregator: TextAggregator;
  private readonly messages: Message[] = [];
  private generator: TextGenerationPipeline | null = null;
  private stoppingCriteria: InterruptableStoppingCriteria | null = null;
  private generating = false;

  constructor(options: NvidiaNemotronLLMOptions = {}) {
    super();
    this.device = options.device ?? 'webgpu';
    this.context = options.context ?? DEFAULT_CONTEXT;
    this.maxUserMessages = options.maxUserMessages ?? 20;
    this.maxNewTokens = options.maxNewTokens ?? DEFAULT_MAX_NEW_TOKENS;
    this.enableThinking = options.enableThinking ?? DEFAULT_ENABLE_THINKING;
    this.textAggregator = new TextAggregator(options.textAggregation);
    this.textAggregator.on('text', text => this.emit('text', text));
  }

  async start() {
    if (this.running) {
      return;
    }
    if (
      this.device === 'webgpu' &&
      (typeof navigator === 'undefined' || !('gpu' in navigator) || !navigator.gpu)
    ) {
      throw new Error('WebGPU is required for NVIDIA Nemotron 3 Nano 4B (or select wasm)');
    }

    this.running = true;
    log('start device=%s thinking=%s', this.device, this.enableThinking);
    this.notify(`Loading NVIDIA Nemotron 3 Nano 4B (${MODEL_ID}, ${this.device})...`);

    try {
      const progress_callback = (info: ProgressInfo) => {
        if (info.status === 'progress') {
          log('progress: %d', info.progress);
        }
      };

      this.generator = await pipeline('text-generation', MODEL_ID, {
        progress_callback,
        dtype: 'q4',
        device: this.device,
      });
      if (!this.running) {
        return;
      }

      this.notify(`NVIDIA Nemotron 3 Nano 4B ready (${this.device}).`);
    } catch (error) {
      log('start error: %o', error);
      this.notify(`> Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      this.stop('Failed to start NVIDIA Nemotron LLM');
      throw error;
    }
  }

  sendMessage(message: string): void {
    if (!this.running) {
      throw new Error('NVIDIA Nemotron LLM is not running');
    }
    const text = message.trim();
    if (!text) {
      return;
    }
    void this.generate(text);
  }

  private async generate(userMessage: string) {
    const generator = this.generator;
    if (!generator) {
      throw new Error('NVIDIA Nemotron LLM is not ready');
    }

    log('generate user=%s', userMessage);
    this.stoppingCriteria?.interrupt();
    this.textAggregator.clear();
    const stoppingCriteria = new InterruptableStoppingCriteria();
    this.stoppingCriteria = stoppingCriteria;
    this.generating = true;

    this.messages.push({ role: 'user', content: userMessage });
    while (this.messages.filter(m => m.role === 'user').length > this.maxUserMessages) {
      log('maxUserMessages reached, shifting oldest message');
      this.messages.shift();
    }

    const chat: Message[] = [{ role: 'system', content: this.context }, ...this.messages];

    const parser = new ThinkContentParser();
    let firstChunk = true;

    const streamer = new TextStreamer(generator.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: false,
      callback_function: (output: string) => {
        if (!this.running || stoppingCriteria.interrupted) {
          return;
        }
        if (!output || output === '<|im_end|>') {
          return;
        }

        let textToPush = output;
        // Nemotron often omits the opening <think> tag when thinking is on.
        if (firstChunk && this.enableThinking) {
          textToPush = THINK_OPEN + output;
        }
        firstChunk = false;

        const content = parser.push(textToPush);
        if (content) {
          this.textAggregator.append(content);
        }
      },
    });

    try {
      await generator(chat, {
        max_new_tokens: this.maxNewTokens,
        do_sample: false,
        streamer,
        stopping_criteria: stoppingCriteria,
        tokenizer_encode_kwargs: {
          enable_thinking: this.enableThinking,
        },
      });

      if (!this.running || stoppingCriteria.interrupted) {
        return;
      }

      const remaining = parser.flush();
      if (remaining) {
        this.textAggregator.append(remaining);
      }

      const assistantText = parser.content.trim();
      if (assistantText) {
        this.messages.push({ role: 'assistant', content: assistantText });
      }
      this.textAggregator.flush();
    } catch (error) {
      if (stoppingCriteria.interrupted || !this.running) {
        log('generate interrupted');
        return;
      }
      log('generate error: %o', error);
      this.notify(`> Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      if (this.stoppingCriteria === stoppingCriteria) {
        this.stoppingCriteria = null;
      }
      this.generating = false;
    }
  }

  protected closeSession(reason?: string): void {
    log('closeSession %s generating=%s', reason ?? '', this.generating);
    this.stoppingCriteria?.interrupt();
    this.stoppingCriteria = null;
    this.textAggregator.removeAllListeners();
    this.textAggregator.clear();
    this.messages.length = 0;
    if (this.generator && 'dispose' in this.generator) {
      void (this.generator as { dispose?: () => Promise<void> }).dispose?.();
    }
    this.generator = null;
    this.generating = false;
  }
}
