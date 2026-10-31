import EventEmitter from 'events';
import debug from 'debug';
import { processInputAudioTrack, processOutputAudioTrack } from '../audio';

const log = debug('realtime:provider');

export const DEFAULT_CONTEXT =
  'You help users answering questions. Be concise and limit the answer to a few sentences.';

export abstract class BaseProvider extends EventEmitter {
  public sourceAudioTrack: MediaStreamTrack | null = null;
  public outputAudioTrack: MediaStreamTrack | null = null;
  public promptTokenCount = 0;
  public responseTokenCount = 0;

  protected running = false;
  protected mediaStream: MediaStream | null = null;
  private closeSourceAudio: () => void = () => {};
  private closeOutputAudio: () => void = () => {};
  private flushOutputAudio: () => void = () => {};

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
    chunkMs: number,
    callback: (pcm16: ArrayBuffer | string) => void,
    stringFormat = false,
    sampleRate = 16000,
  ) {
    if (!this.sourceAudioTrack) {
      await this.getMediaStream();
    }
    if (!this.sourceAudioTrack) {
      throw new Error('No source audio track available');
    }
    const { close: closeSourceAudio } = await processInputAudioTrack(
      this.sourceAudioTrack!,
      sampleRate,
      callback,
      chunkMs,
      stringFormat,
    );
    this.closeSourceAudio = closeSourceAudio;
  }

  protected async setupOutputAudio(sampleRate: number, format: 'pcm' | 'mp3' = 'pcm') {
    const { push, flush, track, close } = await processOutputAudioTrack(sampleRate, format);
    this.outputAudioTrack = track;
    this.closeOutputAudio = close;
    this.flushOutputAudio = flush;
    return { push, flush };
  }

  flush(): void {
    this.flushOutputAudio?.();
  }

  stop(reason?: string): void {
    if (!this.running) {
      return;
    }
    this.running = false;
    log('stop', reason ?? '');
    try {
      this.closeSession(reason);
    } catch (error) {
      log('closeSession error: %o', error);
    }
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

  protected marker(timeMs: number, color: string, message: string): void {
    this.emit('marker', timeMs, color, message);
  }
}
