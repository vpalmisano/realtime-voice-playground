import EventEmitter from 'events';
import debug from 'debug';

const log = debug('realtime:provider');

export const DEFAULT_CONTEXT = 'You help users answering questions.';

export abstract class ProviderSession extends EventEmitter {
  public abstract readonly transportType: string;

  public sourceAudioTrack: MediaStreamTrack | null = null;
  public outputAudioTrack: MediaStreamTrack | null = null;
  public promptTokenCount = 0;
  public responseTokenCount = 0;

  protected running = false;
  protected mediaStream: MediaStream | null = null;
  protected audioElement: HTMLAudioElement | null = null;
  protected closeInputAudio: () => void = () => {};
  protected closeAudioContext: () => void = () => {};

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
    this.outputAudioTrack?.stop();
    this.closeInputAudio();
    this.closeAudioContext();
    this.audioElement?.remove();
    this.audioElement = null;
    this.outputAudioTrack = null;
    this.sourceAudioTrack = null;
    this.mediaStream = null;
    this.emit('close', reason);
  }
}
