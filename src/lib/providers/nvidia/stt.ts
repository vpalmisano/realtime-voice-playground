import { LANG_TO_ID } from '@jeffpeng3/nemotron-asr-core';
import { BaseProvider, type VadOptions } from '../base.ts';
import debug from 'debug';
import type { NemotronAsrWorkerInMessage, NemotronAsrWorkerOutMessage } from './stt.worker.ts';

const log = debug('realtime:nvidia-nemotron-stt');

export const AUDIO_SAMPLE_RATE = 16000;
export const MODEL_ID = 'jeffpeng3/nemotron-3.5-asr-streaming-0.6b-onnx-int4-dynamic';
export const DEFAULT_LANGUAGE = 'auto';
export const DEFAULT_PROFILE = 'NORMAL';
export const DEFAULT_BEAM_WIDTH = 1;

export const NEMOTRON_PROFILES = ['TURBO', 'FAST', 'BALANCED', 'NORMAL', 'HIGH'] as const;
export type NemotronProfile = (typeof NEMOTRON_PROFILES)[number];

export const NEMOTRON_LANGUAGES = Object.keys(LANG_TO_ID) as (keyof typeof LANG_TO_ID)[];

export type NvidiaNemotronSTTOptions = {
  language?: string;
  profile?: NemotronProfile;
  beamWidth?: number;
  chunkMs?: number;
};

function resolveLangId(language: string): number {
  const entry = LANG_TO_ID[language as keyof typeof LANG_TO_ID];
  if (entry) {
    return entry[0];
  }
  return LANG_TO_ID.auto[0];
}

export class NvidiaNemotronSTT extends BaseProvider {
  private readonly language: string;
  private readonly langId: number;
  private readonly profile: NemotronProfile;
  private readonly beamWidth: number;
  private readonly chunkMs: number;
  private worker: Worker | null = null;
  private ready = false;
  private stopRequested = false;
  private flushing = false;
  private hasSession = false;

  constructor(options: NvidiaNemotronSTTOptions = {}, vadOptions?: VadOptions) {
    super();
    this.language = options.language ?? DEFAULT_LANGUAGE;
    this.langId = resolveLangId(this.language);
    this.profile = options.profile ?? DEFAULT_PROFILE;
    this.beamWidth = Math.max(1, options.beamWidth ?? DEFAULT_BEAM_WIDTH);
    this.chunkMs = options.chunkMs ?? 80;
    this.vadOptions = vadOptions;
  }

  private post(message: NemotronAsrWorkerInMessage, transfer?: Transferable[]) {
    if (!this.worker) {
      return;
    }
    if (transfer?.length) {
      this.worker.postMessage(message, transfer);
    } else {
      this.worker.postMessage(message);
    }
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
    this.hasSession = false;
  }

  async start() {
    if (this.running) {
      return;
    }
    if (typeof navigator === 'undefined' || !('gpu' in navigator) || !navigator.gpu) {
      throw new Error('WebGPU is required for NVIDIA Nemotron 3.5 STT');
    }

    this.running = true;
    this.stopRequested = false;
    this.flushing = false;
    this.hasSession = false;
    this.ready = false;
    log('start profile=%s language=%s langId=%d', this.profile, this.language, this.langId);
    this.notify(`Loading NVIDIA Nemotron 3.5 ASR (${MODEL_ID}, profile=${this.profile})...`);

    try {
      await new Promise<void>((resolve, reject) => {
        const worker = new Worker(new URL('./stt.worker.ts', import.meta.url), {
          type: 'module',
        });
        this.worker = worker;

        worker.onerror = event => {
          reject(new Error(event.message || 'NVIDIA Nemotron ASR worker failed'));
        };

        worker.onmessage = (event: MessageEvent<NemotronAsrWorkerOutMessage>) => {
          const data = event.data;
          switch (data.type) {
            case 'progress':
              log('downloading %s: %d', data.label, data.progress);
              break;
            case 'status':
              log('status: %s', data.detail);
              break;
            case 'ready':
              this.ready = true;
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

        this.post({
          type: 'load',
          profile: this.profile,
          beamWidth: this.beamWidth,
        });
      });

      if (!this.running) {
        this.terminateWorker();
        return;
      }

      this.notify(
        `NVIDIA Nemotron 3.5 ready (profile=${this.profile}, language=${this.language}).`,
      );

      await this.setupSourceAudio(
        binary => {
          if (!this.running || this.stopRequested) return;
          this.enqueueAudio(binary as Float32Array);
        },
        this.chunkMs,
        AUDIO_SAMPLE_RATE,
        'f32',
        'array',
      );

      this.sourceAudioVad?.on('start', () => {
        log('vad start');
        this.createSession();
      });
      this.sourceAudioVad?.on('stop', () => {
        log('vad stop');
        this.flushTurn();
      });
    } catch (error) {
      log('start error: %o', error);
      this.notifyError(error instanceof Error ? error.message : 'Unknown error');
      this.stop('Failed to start NVIDIA Nemotron STT');
      throw error;
    }
  }

  private handleWorkerMessage(data: NemotronAsrWorkerOutMessage) {
    switch (data.type) {
      case 'progress':
        log('downloading %s: %d', data.label, data.progress);
        break;
      case 'status':
        log('status: %s', data.detail);
        break;
      case 'partial':
        if (this.running) {
          log('partial: %s', data.text);
        }
        break;
      case 'final':
        this.onSessionComplete(data.text);
        break;
      case 'session-ended':
        this.onSessionComplete('');
        break;
      case 'error':
        if (!this.running || this.stopRequested) {
          return;
        }
        log('worker error: %s', data.error);
        this.notifyError(data.error);
        this.stop('NVIDIA Nemotron STT worker failed');
        break;
      default:
        break;
    }
  }

  private onSessionComplete(text: string) {
    this.hasSession = false;
    this.flushing = false;
    if (!this.running || this.stopRequested) {
      return;
    }
    if (text) {
      log('final: %s', text);
      this.emit('text', text);
    }
  }

  private createSession() {
    if (
      !this.worker ||
      !this.ready ||
      this.hasSession ||
      this.flushing ||
      this.stopRequested ||
      !this.running
    ) {
      return;
    }
    this.hasSession = true;
    this.post({ type: 'startSession', langId: this.langId });
    log('session created langId=%d', this.langId);
  }

  private enqueueAudio(samples: Float32Array) {
    if (!samples.length || !this.hasSession || this.flushing || !this.ready) {
      return;
    }
    const chunk = samples.slice();
    this.post({ type: 'feed', samples: chunk }, [chunk.buffer]);
  }

  private flushTurn() {
    if (this.flushing || this.stopRequested || !this.running || !this.hasSession) {
      return;
    }

    this.flushing = true;
    this.post({ type: 'endSession' });
  }

  sendMessage() {
    throw new Error('Not implemented');
  }

  protected closeSession(reason?: string): void {
    log('closeSession %s', reason ?? '');
    this.stopRequested = true;
    this.flushing = true;
    this.hasSession = false;
    this.post({ type: 'dispose' });
    this.terminateWorker();
  }
}
