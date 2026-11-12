import {
  AsrEngine,
  LANG_TO_ID,
  type AsrEngineOptions,
  type Session,
} from '@jeffpeng3/nemotron-asr-core';
import { AwaitQueue, AwaitQueueRemovedTaskError, AwaitQueueStoppedError } from 'awaitqueue';
import { BaseProvider, type VadOptions } from '../base.ts';
import debug from 'debug';

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
  private engine: AsrEngine | null = null;
  private session: Session | null = null;
  private readonly asyncQueue = new AwaitQueue();
  private stopRequested = false;
  private flushing = false;

  constructor(options: NvidiaNemotronSTTOptions = {}, vadOptions?: VadOptions) {
    super();
    this.language = options.language ?? DEFAULT_LANGUAGE;
    this.langId = resolveLangId(this.language);
    this.profile = options.profile ?? DEFAULT_PROFILE;
    this.beamWidth = Math.max(1, options.beamWidth ?? DEFAULT_BEAM_WIDTH);
    this.chunkMs = options.chunkMs ?? 80;
    this.vadOptions = vadOptions;
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
    this.session = null;
    log('start profile=%s language=%s langId=%d', this.profile, this.language, this.langId);
    this.notify(`Loading NVIDIA Nemotron 3.5 ASR (${MODEL_ID}, profile=${this.profile})...`);

    try {
      const engineOptions: AsrEngineOptions = {
        profile: this.profile,
        beamWidth: this.beamWidth,
      };

      this.engine = new AsrEngine(
        {
          progress: (label, loaded, total, cached) => {
            if (cached) {
              return;
            }
            const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
            log(`downloading ${label}: ${pct}`);
          },
          status: detail => {
            log('status: %s', detail);
          },
        },
        engineOptions,
      );

      await this.engine.init();
      if (!this.running) {
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
        void this.flushTurn();
      });
    } catch (error) {
      log('start error: %o', error);
      this.notify(`> Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      this.stop('Failed to start NVIDIA Nemotron STT');
      throw error;
    }
  }

  private createSession() {
    if (!this.engine || this.session || this.flushing || this.stopRequested || !this.running) {
      return;
    }
    this.session = this.engine.session(this.langId, false);
    log('session created langId=%d', this.langId);
  }

  private enqueueAudio(samples: Float32Array) {
    if (!samples.length || !this.session || this.flushing) {
      return;
    }
    const chunk = samples.slice();
    void this.asyncQueue
      .push(async () => {
        if (!this.session || this.stopRequested || !this.running) {
          return;
        }
        const partials = await this.session.feed(chunk);
        if (!partials?.length) {
          return;
        }
        for (const partial of partials) {
          const text = partial.text.trim();
          if (text) {
            log('partial: %s', text);
          }
        }
      }, 'nemotron-feed')
      .catch(error => {
        if (
          error instanceof AwaitQueueStoppedError ||
          error instanceof AwaitQueueRemovedTaskError ||
          this.stopRequested ||
          !this.running
        ) {
          return;
        }
        log('feed error: %o', error);
        this.notify(`> Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        this.stop('NVIDIA Nemotron STT feed failed');
      });
  }

  private async flushTurn() {
    if (this.flushing || this.stopRequested || !this.running) {
      return;
    }

    this.flushing = true;
    try {
      await this.asyncQueue.push(async () => {
        const session = this.session;
        if (!session || this.stopRequested || !this.running) {
          return;
        }
        this.session = null;
        const result = await session.end();
        if (this.stopRequested || !this.running) {
          return;
        }
        const text = result?.text.trim() ?? '';
        if (text) {
          log('final: %s', text);
          this.emit('text', text);
        }
      }, 'nemotron-flush');
    } catch (error) {
      if (
        error instanceof AwaitQueueStoppedError ||
        error instanceof AwaitQueueRemovedTaskError ||
        this.stopRequested ||
        !this.running
      ) {
        return;
      }
      log('flush error: %o', error);
      this.notify(`> Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      this.stop('NVIDIA Nemotron STT flush failed');
    } finally {
      this.session = null;
      this.flushing = false;
    }
  }

  sendMessage() {
    throw new Error('Not implemented');
  }

  protected closeSession(reason?: string): void {
    log('closeSession %s', reason ?? '');
    this.stopRequested = true;
    this.flushing = true;
    const session = this.session;
    this.session = null;
    this.asyncQueue.stop();
    if (session) {
      void session.end().catch(() => {});
    }
    this.engine = null;
  }
}
