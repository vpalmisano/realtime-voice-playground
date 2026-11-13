import type { Message } from '@huggingface/transformers';
import { DEFAULT_CONTEXT, BaseProvider } from '../base.ts';
import { TextAggregator, type LLMTextAggregation } from '../../text.ts';
import debug from 'debug';
import type { NemotronWorkerInMessage, NemotronWorkerOutMessage } from './llm.worker.ts';

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

export class NvidiaNemotronLLM extends BaseProvider {
  private readonly device: NemotronLlmDevice;
  private readonly context: string;
  private readonly maxUserMessages: number;
  private readonly maxNewTokens: number;
  private readonly enableThinking: boolean;
  private readonly textAggregator: TextAggregator;
  private readonly messages: Message[] = [];
  private worker: Worker | null = null;
  private ready = false;
  private nextRequestId = 1;
  private activeRequestId: number | null = null;
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

  private post(message: NemotronWorkerInMessage) {
    this.worker?.postMessage(message);
  }

  private terminateWorker() {
    if (!this.worker) {
      return;
    }
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.terminate();
    this.worker = null;
    this.ready = false;
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
    this.ready = false;
    log('start device=%s thinking=%s', this.device, this.enableThinking);
    this.notify(`Loading NVIDIA Nemotron 3 Nano 4B (${MODEL_ID}, ${this.device})...`);

    try {
      await new Promise<void>((resolve, reject) => {
        const worker = new Worker(new URL('./llm.worker.ts', import.meta.url), {
          type: 'module',
        });
        this.worker = worker;

        worker.onerror = event => {
          reject(new Error(event.message || 'NVIDIA Nemotron worker failed'));
        };

        worker.onmessage = (event: MessageEvent<NemotronWorkerOutMessage>) => {
          const data = event.data;
          switch (data.type) {
            case 'progress':
              this.notifyProgress('Loading', data.progress);
              break;
            case 'ready':
              this.ready = true;
              this.notifyProgress('Loading', 100);
              worker.onmessage = event2 => this.handleWorkerMessage(event2.data);
              resolve();
              break;
            case 'error':
              reject(new Error(data.error));
              break;
            default:
              break;
          }
        };

        this.post({ type: 'load', modelId: MODEL_ID, device: this.device });
      });

      if (!this.running) {
        this.terminateWorker();
        return;
      }

      this.notify(`NVIDIA Nemotron 3 Nano 4B ready (${this.device}).`);
    } catch (error) {
      log('start error: %o', error);
      this.notifyError(error instanceof Error ? error.message : 'Unknown error');
      this.stop('Failed to start NVIDIA Nemotron LLM');
      throw error;
    }
  }

  private handleWorkerMessage(data: NemotronWorkerOutMessage) {
    switch (data.type) {
      case 'progress':
        log('progress: %d', data.progress);
        break;
      case 'token':
        if (this.running && data.requestId === this.activeRequestId) {
          this.textAggregator.append(data.text);
        }
        break;
      case 'complete':
        this.onWorkerComplete(data.requestId, data.interrupted, data.content);
        break;
      case 'generate-error':
        this.onWorkerGenerateError(data.requestId, data.error);
        break;
      case 'error':
        log('worker error: %s', data.error);
        this.notifyError(data.error);
        break;
      default:
        break;
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
    this.generate(text);
  }

  private generate(userMessage: string) {
    if (!this.worker || !this.ready) {
      throw new Error('NVIDIA Nemotron LLM is not ready');
    }

    log('generate user=%s', userMessage);
    this.post({ type: 'interrupt' });
    this.textAggregator.clear();
    this.generating = true;

    this.messages.push({ role: 'user', content: userMessage });
    while (this.messages.filter(m => m.role === 'user').length > this.maxUserMessages) {
      log('maxUserMessages reached, shifting oldest message');
      this.messages.shift();
    }

    const chat: Message[] = [{ role: 'system', content: this.context }, ...this.messages];
    const requestId = this.nextRequestId++;
    this.activeRequestId = requestId;

    this.post({
      type: 'generate',
      requestId,
      chat,
      maxNewTokens: this.maxNewTokens,
      enableThinking: this.enableThinking,
    });
  }

  private onWorkerComplete(requestId: number, interrupted: boolean, content: string) {
    const isActive = this.activeRequestId === requestId;
    if (isActive) {
      this.activeRequestId = null;
      this.generating = false;
    }

    if (!this.running || !isActive || interrupted) {
      return;
    }

    if (content) {
      this.messages.push({ role: 'assistant', content });
    }
    this.textAggregator.flush();
  }

  private onWorkerGenerateError(requestId: number, error: string) {
    if (this.activeRequestId === requestId) {
      this.activeRequestId = null;
      this.generating = false;
    }
    if (!this.running) {
      return;
    }
    log('generate error: %s', error);
    this.notifyError(error);
  }

  protected closeSession(reason?: string): void {
    log('closeSession %s generating=%s', reason ?? '', this.generating);
    this.post({ type: 'interrupt' });
    this.post({ type: 'dispose' });
    this.terminateWorker();
    this.textAggregator.removeAllListeners();
    this.textAggregator.clear();
    this.messages.length = 0;
    this.activeRequestId = null;
    this.generating = false;
    this.ready = false;
  }
}
