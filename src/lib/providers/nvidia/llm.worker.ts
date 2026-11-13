import {
  InterruptableStoppingCriteria,
  TextStreamer,
  pipeline,
  type Message,
  type TextGenerationPipeline,
} from '@huggingface/transformers';

export type NemotronWorkerDevice = 'webgpu' | 'wasm';

export type NemotronWorkerInMessage =
  | { type: 'load'; modelId: string; device: NemotronWorkerDevice }
  | {
      type: 'generate';
      requestId: number;
      chat: Message[];
      maxNewTokens: number;
      enableThinking: boolean;
    }
  | { type: 'interrupt' }
  | { type: 'dispose' };

export type NemotronWorkerOutMessage =
  | { type: 'progress'; progress: number }
  | { type: 'ready' }
  | { type: 'token'; requestId: number; text: string }
  | { type: 'complete'; requestId: number; interrupted: boolean; content: string }
  | { type: 'generate-error'; requestId: number; error: string }
  | { type: 'error'; error: string }
  | { type: 'disposed' };

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

let generator: TextGenerationPipeline | null = null;
let stoppingCriteria: InterruptableStoppingCriteria | null = null;

function post(message: NemotronWorkerOutMessage) {
  self.postMessage(message);
}

async function disposeGenerator() {
  stoppingCriteria?.interrupt();
  stoppingCriteria = null;
  if (generator && 'dispose' in generator) {
    await (generator as { dispose?: () => Promise<void> }).dispose?.();
  }
  generator = null;
}

self.onmessage = async (event: MessageEvent<NemotronWorkerInMessage>) => {
  const data = event.data;

  try {
    switch (data.type) {
      case 'load': {
        await disposeGenerator();
        generator = await pipeline('text-generation', data.modelId, {
          progress_callback: info => {
            if (info.status === 'progress') {
              post({ type: 'progress', progress: info.progress });
            }
          },
          dtype: 'q4',
          device: data.device,
        });
        post({ type: 'ready' });
        break;
      }

      case 'generate': {
        if (!generator) {
          post({
            type: 'generate-error',
            requestId: data.requestId,
            error: 'NVIDIA Nemotron LLM is not ready',
          });
          return;
        }

        stoppingCriteria?.interrupt();
        const criteria = new InterruptableStoppingCriteria();
        stoppingCriteria = criteria;

        const parser = new ThinkContentParser();
        let firstChunk = true;

        const streamer = new TextStreamer(generator.tokenizer, {
          skip_prompt: true,
          skip_special_tokens: false,
          callback_function: (output: string) => {
            if (criteria.interrupted) {
              return;
            }
            if (!output || output === '<|im_end|>') {
              return;
            }

            let textToPush = output;
            // Nemotron often omits the opening <think> tag when thinking is on.
            if (firstChunk && data.enableThinking) {
              textToPush = THINK_OPEN + output;
            }
            firstChunk = false;

            const content = parser.push(textToPush);
            if (content) {
              post({ type: 'token', requestId: data.requestId, text: content });
            }
          },
        });

        try {
          await generator(data.chat, {
            max_new_tokens: data.maxNewTokens,
            do_sample: false,
            streamer,
            stopping_criteria: criteria,
            tokenizer_encode_kwargs: {
              enable_thinking: data.enableThinking,
            },
          });

          if (!criteria.interrupted) {
            const remaining = parser.flush();
            if (remaining) {
              post({ type: 'token', requestId: data.requestId, text: remaining });
            }
          }

          post({
            type: 'complete',
            requestId: data.requestId,
            interrupted: !!criteria.interrupted,
            content: criteria.interrupted ? '' : parser.content.trim(),
          });
        } catch (error) {
          if (criteria.interrupted) {
            post({
              type: 'complete',
              requestId: data.requestId,
              interrupted: true,
              content: '',
            });
            return;
          }
          post({
            type: 'generate-error',
            requestId: data.requestId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        } finally {
          if (stoppingCriteria === criteria) {
            stoppingCriteria = null;
          }
        }
        break;
      }

      case 'interrupt': {
        stoppingCriteria?.interrupt();
        break;
      }

      case 'dispose': {
        await disposeGenerator();
        post({ type: 'disposed' });
        break;
      }
    }
  } catch (error) {
    post({
      type: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};
