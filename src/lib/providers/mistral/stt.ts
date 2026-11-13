import {
  BaseStreamer,
  VoxtralRealtimeForConditionalGeneration,
  VoxtralRealtimeProcessor,
  InterruptableStoppingCriteria,
  type ProgressInfo,
} from '@huggingface/transformers';
import { BaseProvider, type VadOptions } from '../base.ts';
import debug from 'debug';

const log = debug('realtime:mistral-voxtral-stt');

export const AUDIO_SAMPLE_RATE = 16000;
export const MODEL_ID = 'onnx-community/Voxtral-Mini-4B-Realtime-2602-ONNX';
export const DEFAULT_MAX_NEW_TOKENS = 4096;
export const DEFAULT_TURN_FLUSH_MS = 600;

export const VOXTRAL_DEVICES = ['webgpu', 'wasm'] as const;
export type VoxtralDevice = (typeof VOXTRAL_DEVICES)[number];

type VoxtralRealtimeModel = InstanceType<typeof VoxtralRealtimeForConditionalGeneration>;
type VoxtralRealtimeProc = InstanceType<typeof VoxtralRealtimeProcessor>;

export type MistralVoxtralSTTOptions = {
  device?: VoxtralDevice;
  maxNewTokens?: number;
  turnFlushMs?: number;
  chunkMs?: number;
};

function waitUntil(condition: () => boolean, intervalMs = 20): Promise<void> {
  return new Promise(resolve => {
    if (condition()) {
      resolve();
      return;
    }
    const id = setInterval(() => {
      if (condition()) {
        clearInterval(id);
        resolve();
      }
    }, intervalMs);
  });
}

export class MistralVoxtralSTT extends BaseProvider {
  private readonly device: VoxtralDevice;
  private readonly maxNewTokens: number;
  private readonly turnFlushMs: number;
  private readonly chunkMs: number;
  private processor: VoxtralRealtimeProc | null = null;
  private model: VoxtralRealtimeModel | null = null;
  private stoppingCriteria: InterruptableStoppingCriteria | null = null;
  private audioBuffer = new Float32Array(0);
  private turnText = '';
  private talking = false;
  private stopRequested = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: MistralVoxtralSTTOptions = {}, vadOptions?: VadOptions) {
    super();
    this.device = options.device ?? 'webgpu';
    this.maxNewTokens = options.maxNewTokens ?? DEFAULT_MAX_NEW_TOKENS;
    this.turnFlushMs = options.turnFlushMs ?? DEFAULT_TURN_FLUSH_MS;
    this.chunkMs = options.chunkMs ?? 80;
    this.vadOptions = vadOptions;
  }

  async start() {
    if (this.running) {
      return;
    }
    this.running = true;
    this.stopRequested = false;
    this.audioBuffer = new Float32Array(0);
    this.turnText = '';
    log('start device=%s', this.device);
    this.notify(`Loading Mistral Voxtral Realtime (${MODEL_ID}, ${this.device})...`);

    try {
      const progress_callback = (info: ProgressInfo) => {
        if (info.status === 'progress') {
          this.notifyProgress('Loading', info.progress);
        }
      };

      const useWebGpu = this.device === 'webgpu';
      this.model = (await VoxtralRealtimeForConditionalGeneration.from_pretrained(MODEL_ID, {
        progress_callback,
        dtype: useWebGpu
          ? {
              audio_encoder: 'q4f16',
              embed_tokens: 'q4f16',
              decoder_model_merged: 'q4f16',
            }
          : 'q4',
        device: useWebGpu ? 'webgpu' : 'wasm',
      })) as VoxtralRealtimeModel;
      if (!this.running) {
        return;
      }

      this.processor = (await VoxtralRealtimeProcessor.from_pretrained(MODEL_ID, {
        progress_callback,
      })) as VoxtralRealtimeProc;
      if (!this.running) {
        return;
      }

      this.notify(`Mistral Voxtral Realtime ready (${this.device}).`);

      await this.setupSourceAudio(
        binary => {
          if (!this.running || this.stopRequested) return;
          this.appendAudio(binary as Float32Array);
        },
        this.chunkMs,
        AUDIO_SAMPLE_RATE,
        'f32',
        'array',
      );

      this.sourceAudioVad?.on('start', () => {
        log('vad start');
        this.cancelTurnFlush();
        this.talking = true;
      });
      this.sourceAudioVad?.on('stop', () => {
        log('vad stop');
        this.talking = false;
        this.scheduleTurnFlush();
      });

      void this.runStreaming().catch(error => {
        if (this.stopRequested || !this.running) {
          return;
        }
        log('streaming error: %o', error);
        this.notifyError(error instanceof Error ? error.message : 'Unknown error');
        this.stop('Mistral Voxtral Realtime streaming failed');
      });
    } catch (error) {
      log('start error: %o', error);
      this.notifyError(error instanceof Error ? error.message : 'Unknown error');
      this.stop('Failed to start Mistral Voxtral STT');
      throw error;
    }
  }

  private appendAudio(samples: Float32Array) {
    if (!samples.length) {
      return;
    }
    const merged = new Float32Array(this.audioBuffer.length + samples.length);
    merged.set(this.audioBuffer);
    merged.set(samples, this.audioBuffer.length);
    this.audioBuffer = merged;
  }

  private scheduleTurnFlush() {
    this.cancelTurnFlush();
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushTurn();
    }, this.turnFlushMs);
  }

  private cancelTurnFlush() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private flushTurn() {
    const text = this.turnText.trim();
    this.turnText = '';
    if (!text) {
      return;
    }
    log('final: %s', text);
    this.emit('text', text);
  }

  private async *streamInputFeatures(
    processor: VoxtralRealtimeProc,
    firstFeatures: unknown,
    hopLength: number,
    winHalf: number,
    samplesPerTok: number,
  ) {
    yield firstFeatures;

    let melFrame = processor.num_mel_frames_first_audio_chunk;
    let start = melFrame * hopLength - winHalf;

    while (!this.stopRequested && this.running) {
      const endNeeded = start + processor.num_samples_per_audio_chunk;
      await waitUntil(
        () => this.audioBuffer.length >= endNeeded || this.stopRequested || !this.running,
      );
      if (this.stopRequested || !this.running) {
        break;
      }

      let batchEnd = endNeeded as number;
      while (batchEnd + samplesPerTok <= this.audioBuffer.length) {
        batchEnd += samplesPerTok;
      }

      const chunk = await processor(this.audioBuffer.slice(start, batchEnd), {
        is_streaming: true,
        is_first_audio_chunk: false,
      });
      yield chunk.input_features;

      melFrame += chunk.input_features.dims[2] as number;
      start = melFrame * hopLength - winHalf;
    }
  }

  private createTranscriptStreamer(tokenizer: {
    all_special_ids?: number[];
    decode: (tokens: bigint[], options: { skip_special_tokens: boolean }) => string;
  }) {
    const specialIds = new Set((tokenizer.all_special_ids ?? []).map(id => BigInt(id)));
    let tokenCache: bigint[] = [];
    let printLen = 0;
    let isPrompt = true;

    const flushDecoded = () => {
      if (!tokenCache.length) {
        return;
      }
      const text = tokenizer.decode(tokenCache, { skip_special_tokens: true });
      const printable = text.slice(printLen);
      printLen = text.length;
      if (printable) {
        this.turnText += printable;
      }
    };

    const streamer = new BaseStreamer();
    streamer.put = (value: bigint[][]) => {
      if (this.stopRequested || !this.running) {
        return;
      }
      if (isPrompt) {
        isPrompt = false;
        return;
      }
      const tokens = value[0];
      if (!tokens?.length) {
        return;
      }
      if (tokens.length === 1 && specialIds.has(tokens[0]!)) {
        return;
      }
      tokenCache = tokenCache.concat(tokens);
      flushDecoded();
    };
    streamer.end = () => {
      flushDecoded();
      tokenCache = [];
      printLen = 0;
      isPrompt = true;
    };
    return streamer;
  }

  private async runStreaming() {
    const model = this.model;
    const processor = this.processor;
    if (!model || !processor) {
      return;
    }

    const tokenizer = processor.tokenizer;
    if (!tokenizer) {
      throw new Error('Voxtral realtime processor tokenizer is missing');
    }

    const numSamplesFirst = processor.num_samples_first_audio_chunk;
    await waitUntil(
      () => this.audioBuffer.length >= numSamplesFirst || this.stopRequested || !this.running,
    );
    if (this.stopRequested || !this.running) {
      return;
    }

    const first = await processor(this.audioBuffer.subarray(0, numSamplesFirst), {
      is_streaming: true,
      is_first_audio_chunk: true,
    });

    const featureExtractor = processor.feature_extractor as {
      config: { hop_length: number; n_fft: number };
    };
    const { hop_length, n_fft } = featureExtractor.config;
    const winHalf = Math.floor(n_fft / 2);
    const samplesPerTok = processor.audio_length_per_tok * hop_length;

    const stoppingCriteria = new InterruptableStoppingCriteria();
    this.stoppingCriteria = stoppingCriteria;

    try {
      await model.generate({
        input_ids: first.input_ids,
        input_features: this.streamInputFeatures(
          processor,
          first.input_features,
          hop_length,
          winHalf,
          samplesPerTok,
        ),
        max_new_tokens: this.maxNewTokens,
        do_sample: false,
        // Custom BaseStreamer; generate typings expect TextStreamer.
        streamer: this.createTranscriptStreamer(tokenizer) as never,
        stopping_criteria: stoppingCriteria,
      });
    } finally {
      this.stoppingCriteria = null;
      if (!this.talking) {
        this.flushTurn();
      }
    }
  }

  sendMessage() {
    throw new Error('Not implemented');
  }

  protected closeSession(reason?: string): void {
    log('closeSession %s', reason ?? '');
    this.stopRequested = true;
    this.cancelTurnFlush();
    this.stoppingCriteria?.interrupt();
    this.stoppingCriteria = null;
    this.talking = false;
    this.turnText = '';
    this.audioBuffer = new Float32Array(0);
    this.processor = null;
    this.model = null;
  }
}
