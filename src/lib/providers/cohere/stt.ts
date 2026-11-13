import {
  pipeline,
  TextStreamer,
  type AutomaticSpeechRecognitionPipeline,
  type AutomaticSpeechRecognitionOutput,
  type ProgressInfo,
} from '@huggingface/transformers';
import { BaseProvider, type VadOptions } from '../base.ts';
import debug from 'debug';

const log = debug('realtime:cohere-stt');

export const AUDIO_SAMPLE_RATE = 16000;
export const MODEL_ID = 'onnx-community/cohere-transcribe-03-2026-ONNX';
export const DEFAULT_LANGUAGE = 'en';
export const DEFAULT_MAX_NEW_TOKENS = 1024;

export const COHERE_DEVICES = ['webgpu', 'wasm'] as const;
export type CohereDevice = (typeof COHERE_DEVICES)[number];

export const COHERE_LANGUAGES = [
  'en',
  'fr',
  'de',
  'es',
  'it',
  'pt',
  'nl',
  'pl',
  'el',
  'ar',
  'ja',
  'zh',
  'vi',
  'ko',
] as const;
export type CohereLanguage = (typeof COHERE_LANGUAGES)[number];

export type CohereSTTOptions = {
  device?: CohereDevice;
  language?: CohereLanguage;
  maxNewTokens?: number;
  chunkMs?: number;
};

export class CohereSTT extends BaseProvider {
  private readonly device: CohereDevice;
  private readonly language: CohereLanguage;
  private readonly maxNewTokens: number;
  private readonly chunkMs: number;
  private transcriber: AutomaticSpeechRecognitionPipeline | null = null;
  private audioBuffer = new Float32Array(0);
  private talking = false;
  private stopRequested = false;
  private transcribing = false;

  constructor(options: CohereSTTOptions = {}, vadOptions?: VadOptions) {
    super();
    this.device = options.device ?? 'webgpu';
    this.language = options.language ?? DEFAULT_LANGUAGE;
    this.maxNewTokens = options.maxNewTokens ?? DEFAULT_MAX_NEW_TOKENS;
    this.chunkMs = options.chunkMs ?? 80;
    this.vadOptions = vadOptions;
  }

  async start() {
    if (this.running) {
      return;
    }
    if (
      this.device === 'webgpu' &&
      (typeof navigator === 'undefined' || !('gpu' in navigator) || !navigator.gpu)
    ) {
      throw new Error('WebGPU is required for Cohere Transcribe (or select wasm)');
    }

    this.running = true;
    this.stopRequested = false;
    this.audioBuffer = new Float32Array(0);
    this.talking = false;
    this.transcribing = false;
    log('start device=%s language=%s', this.device, this.language);
    this.notify(`Loading Cohere Transcribe (${MODEL_ID}, ${this.device})...`);

    try {
      const progress_callback = (info: ProgressInfo) => {
        if (info.status === 'progress') {
          this.notifyProgress('Loading', info.progress);
        }
      };

      this.transcriber = (await pipeline('automatic-speech-recognition', MODEL_ID, {
        dtype: 'q4',
        device: this.device,
        progress_callback,
      })) as AutomaticSpeechRecognitionPipeline;

      if (!this.running) {
        return;
      }

      this.notify(`Cohere Transcribe ready (${this.device}, language=${this.language}).`);

      await this.setupSourceAudio(
        binary => {
          if (!this.running || this.stopRequested || !this.talking) return;
          this.appendAudio(binary as Float32Array);
        },
        this.chunkMs,
        AUDIO_SAMPLE_RATE,
        'f32',
        'array',
      );

      this.sourceAudioVad?.on('start', () => {
        log('vad start');
        this.talking = true;
        this.audioBuffer = new Float32Array(0);
      });
      this.sourceAudioVad?.on('stop', () => {
        log('vad stop');
        this.talking = false;
        void this.transcribeTurn();
      });
    } catch (error) {
      log('start error: %o', error);
      this.notifyError(error instanceof Error ? error.message : 'Unknown error');
      this.stop('Failed to start Cohere STT');
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

  private async transcribeTurn() {
    const audio = this.audioBuffer;
    this.audioBuffer = new Float32Array(0);

    if (!audio.length || !this.transcriber || this.stopRequested || !this.running) {
      return;
    }
    if (this.transcribing) {
      log('skip turn: already transcribing');
      return;
    }

    this.transcribing = true;
    const durationSec = audio.length / AUDIO_SAMPLE_RATE;
    log('transcribe %fs audio', durationSec);

    try {
      const streamer = new TextStreamer(this.transcriber.tokenizer, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: (token: string) => {
          if (token) {
            log('token: %s', token);
          }
        },
      });

      const result = (await this.transcriber(audio, {
        max_new_tokens: this.maxNewTokens,
        language: this.language,
        streamer,
      })) as AutomaticSpeechRecognitionOutput;

      if (!this.running || this.stopRequested) {
        return;
      }

      const text = (typeof result === 'string' ? result : result.text)?.trim();
      if (text) {
        log('final: %s', text);
        this.emit('text', text);
      }
    } catch (error) {
      if (this.stopRequested || !this.running) {
        return;
      }
      log('transcribe error: %o', error);
      this.notifyError(error instanceof Error ? error.message : 'Transcription failed');
    } finally {
      this.transcribing = false;
    }
  }

  sendMessage() {
    throw new Error('Not implemented');
  }

  protected closeSession(reason?: string): void {
    log('closeSession %s', reason ?? '');
    this.stopRequested = true;
    this.talking = false;
    this.transcribing = false;
    this.audioBuffer = new Float32Array(0);
    this.transcriber = null;
  }
}
