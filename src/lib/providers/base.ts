import EventEmitter from 'events';
import debug from 'debug';
import { throttle } from 'throttle-debounce';
import {
  processInputAudioTrack,
  processOutputAudioTrackPcm,
  processOutputAudioTrackMp3,
} from '../audio';
import {
  VoiceActivityDetector,
  type VoiceActivityDetectorOptions,
} from '@vpalmisano/webrtcperf-js';

const log = debug('realtime:provider');

export const DEFAULT_CONTEXT =
  'You help users answering questions. Be concise and limit the answer to a few sentences.';

export type VadOptions = Omit<VoiceActivityDetectorOptions, 'track'>;

export abstract class BaseProvider extends EventEmitter {
  abstract readonly name: string;
  public sourceAudioTrack: MediaStreamTrack | null = null;
  public outputAudioTrack: MediaStreamTrack | null = null;
  public sourceAudioVad: VoiceActivityDetector | null = null;
  public outputAudioVad: VoiceActivityDetector | null = null;
  public promptTokenCount = 0;
  public responseTokenCount = 0;

  protected running = false;
  protected mediaStream: MediaStream | null = null;
  protected vadOptions?: VadOptions;
  private closeSourceAudio: () => void = () => {};
  private closeOutputAudio: () => void = () => {};
  private flushOutputAudio: () => void = () => {};

  private emitProgress = throttle(250, (message: string, value: number) => {
    this.emit('progress', message, value);
  });

  abstract start(): Promise<void>;
  abstract sendMessage(message: string): void;

  protected abstract closeSession(reason?: string): void;

  protected async getMediaStream(): Promise<MediaStreamTrack> {
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    const track = this.mediaStream.getAudioTracks()[0];
    if (!track) {
      throw new Error('No audio track available from getUserMedia');
    }
    this.sourceAudioTrack = track;
    return track;
  }

  protected async setupSourceAudio(
    callback: (pcm16: Int16Array | Float32Array | string) => void,
    chunkMs: number,
    sampleRate = 16000,
    format = 'i16',
    outputType: 'array' | 'string' = 'array',
  ) {
    log(
      `setupSourceAudio chunkMs=${chunkMs}, format=${format}, outputType=${outputType}, sampleRate=${sampleRate}`,
    );
    if (!this.sourceAudioTrack) {
      await this.getMediaStream();
    }
    if (!this.sourceAudioTrack) {
      throw new Error('No source audio track available');
    }
    const { close: closeSourceAudio } = await processInputAudioTrack(
      this.sourceAudioTrack!,
      callback,
      chunkMs,
      sampleRate,
      format,
      outputType,
    );
    this.closeSourceAudio = closeSourceAudio;

    if (this.vadOptions) {
      this.sourceAudioVad = new VoiceActivityDetector({
        track: this.sourceAudioTrack,
        ...this.vadOptions,
      });
      await this.sourceAudioVad.start();
    }
  }

  protected async setupOutputAudio(
    sampleRate: number,
    format?: 'i16',
  ): Promise<{ push: (chunk: string | Uint8Array) => void; flush: () => void }>;
  protected async setupOutputAudio(
    sampleRate: number,
    format: 'f32',
  ): Promise<{ push: (chunk: Float32Array) => void; flush: () => void }>;
  protected async setupOutputAudio(
    sampleRate: number,
    format: 'mp3',
  ): Promise<{ push: (chunk: Uint8Array) => void; flush: () => void }>;
  protected async setupOutputAudio(
    sampleRate: number,
    format: 'i16' | 'f32' | 'mp3' = 'i16',
  ): Promise<{
    push: (chunk: string | Float32Array | Uint8Array) => void;
    flush: () => void;
  }> {
    log(`setupOutputAudio sampleRate=${sampleRate}, format=${format}`);
    const { push, flush, track, close } =
      format === 'mp3'
        ? await processOutputAudioTrackMp3(sampleRate)
        : format === 'f32'
          ? await processOutputAudioTrackPcm(sampleRate, 'f32')
          : await processOutputAudioTrackPcm(sampleRate, 'i16');

    this.outputAudioTrack = track;
    this.closeOutputAudio = close;
    this.flushOutputAudio = flush;

    if (this.vadOptions) {
      this.outputAudioVad = new VoiceActivityDetector({
        track: this.outputAudioTrack,
        ...this.vadOptions,
      });
      await this.outputAudioVad.start();
    }
    return { push, flush } as {
      push: (chunk: string | Float32Array | Uint8Array) => void;
      flush: () => void;
    };
  }

  flush(): void {
    this.flushOutputAudio?.();
  }

  stop(reason?: string): void {
    if (!this.running) {
      return;
    }
    this.running = false;
    this.emitProgress.cancel({ upcomingOnly: true });
    log('stop', reason ?? '');
    try {
      this.closeSession(reason);
    } catch (error) {
      log('closeSession error: %o', error);
    }
    this.sourceAudioVad?.stop(reason);
    this.sourceAudioVad = null;
    this.outputAudioVad?.stop(reason);
    this.outputAudioVad = null;
    this.mediaStream?.getTracks().forEach(track => track.stop());
    this.closeSourceAudio();
    this.closeOutputAudio();
    this.outputAudioTrack = null;
    this.sourceAudioTrack = null;
    this.mediaStream = null;
    this.emit('close', reason);
  }

  protected notify(message: string): void {
    this.emit('notify', message);
  }

  protected notifyError(message: string): void {
    this.emit('error', message);
  }

  protected notifyProgress(message: string, value: number): void {
    this.emitProgress(message, value);
  }

  protected marker(timeMs: number, color: string, message: string): void {
    this.emit('marker', timeMs, color, message);
  }
}
