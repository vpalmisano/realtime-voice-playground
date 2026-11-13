import { VoiceActivityDetector } from '@vpalmisano/webrtcperf-js';
import debug from 'debug';
import { DEFAULT_CONTEXT, BaseProvider, type VadOptions } from '../base.ts';
import {
  buildTurnDetection,
  EAGERNESS_OPTIONS,
  TURN_DETECTION_TYPES,
  type TurnDetection,
} from '../openai/realtime.ts';
import {
  buildRealtimeWebSocketUrl,
  fetchIceServers,
  INWORLD_CALLS_URL,
  mintSessionToken,
  type InworldIceServer,
} from './utils.ts';

const log = debug('realtime:inworld');

export { EAGERNESS_OPTIONS, TURN_DETECTION_TYPES, buildTurnDetection };

export type TransportType = 'webrtc' | 'websocket';

export type InworldRealtimeOptions = {
  transportType?: TransportType;
  model?: string;
  voice?: string;
  ttsModel?: string;
  transcriptionModel?: string;
  apiKey: string;
  context?: string;
  turnDetection?: TurnDetection;
  chunkMs?: number;
};

export const TRANSPORTS = ['websocket', 'webrtc'] as const;
export const DEFAULT_MODEL = 'openai/gpt-4o-mini';
export const DEFAULT_VOICE = 'Clive';
export const DEFAULT_TTS_MODEL = 'inworld-tts-2';
export const DEFAULT_TRANSCRIPTION_MODEL = 'inworld/inworld-stt-1';
export const AUDIO_SAMPLE_RATE = 24000;

type RealtimeEvent = {
  type: string;
  delta?: string;
  error?: { message?: string; code?: string };
  response?: {
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      total_tokens?: number;
    };
  };
};

function waitForIceGathering(pc: RTCPeerConnection, timeoutMs = 3000): Promise<void> {
  return new Promise(resolve => {
    if (pc.iceGatheringState === 'complete') {
      resolve();
      return;
    }
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
      clearTimeout(settleTimer);
      pc.removeEventListener('icecandidate', onIceCandidate);
      pc.removeEventListener('icegatheringstatechange', onStateChange);
      resolve();
    };
    const onIceCandidate = (event: RTCPeerConnectionIceEvent) => {
      if (!event.candidate) return;
      clearTimeout(settleTimer);
      settleTimer = setTimeout(done, 500);
    };
    const onStateChange = () => {
      if (pc.iceGatheringState === 'complete') done();
    };
    pc.addEventListener('icecandidate', onIceCandidate);
    pc.addEventListener('icegatheringstatechange', onStateChange);
    setTimeout(done, timeoutMs);
  });
}

function toApiTurnDetection(turnDetection: TurnDetection) {
  const base = {
    type: turnDetection.type,
    create_response: true,
    interrupt_response: true,
  };
  if (turnDetection.type === 'server_vad') {
    return {
      ...base,
      threshold: turnDetection.threshold,
      prefix_padding_ms: turnDetection.prefixPaddingMs,
      silence_duration_ms: turnDetection.silenceDurationMs,
    };
  }
  const eagerness = turnDetection.eagerness === 'auto' ? 'medium' : turnDetection.eagerness;
  return { ...base, eagerness };
}

export class InworldRealtime extends BaseProvider {
  readonly name = 'InworldRealtime';
  private readonly transportType: TransportType;
  private readonly model: string;
  private readonly voice: string;
  private readonly ttsModel: string;
  private readonly transcriptionModel: string;
  private readonly apiKey: string;
  private readonly context: string;
  private readonly turnDetection: TurnDetection;
  private readonly chunkMs: number;

  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private websocket: WebSocket | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private callId: string | null = null;
  private remoteTrackReject: ((reason?: unknown) => void) | null = null;
  private pushOutputAudio: ((chunk: string | Uint8Array) => void) | null = null;
  private flushOutputAudioBuffer: (() => void) | null = null;

  constructor(options: InworldRealtimeOptions, vadOptions?: VadOptions) {
    super();
    this.transportType = options.transportType ?? 'webrtc';
    this.model = options.model ?? DEFAULT_MODEL;
    this.voice = options.voice ?? DEFAULT_VOICE;
    this.ttsModel = options.ttsModel ?? DEFAULT_TTS_MODEL;
    this.transcriptionModel = options.transcriptionModel ?? DEFAULT_TRANSCRIPTION_MODEL;
    this.apiKey = options.apiKey;
    this.context = options.context ?? DEFAULT_CONTEXT;
    this.turnDetection = options.turnDetection ?? {
      type: 'semantic_vad',
      eagerness: 'high',
    };
    this.chunkMs = options.chunkMs ?? 80;
    this.vadOptions = vadOptions;
  }

  async start() {
    if (this.running) {
      return;
    }
    log('start');
    this.running = true;

    this.notify(
      `Connecting to Inworld Realtime via ${this.transportType} with model ${this.model}, voice ${this.voice}, TTS ${this.ttsModel}...`,
    );

    try {
      if (this.transportType === 'websocket') {
        await this.startWebSocket();
      } else {
        await this.startWebRtc();
      }
    } catch (error) {
      log('error: %o', error);
      this.stop('Failed to start session');
      throw error;
    }
  }

  private async startWebRtc() {
    await this.getMediaStream();
    if (!this.sourceAudioTrack || !this.mediaStream) {
      throw new Error('Failed to get source audio track');
    }

    this.sourceAudioVad = new VoiceActivityDetector({
      track: this.sourceAudioTrack,
      ...this.vadOptions,
    });
    await this.sourceAudioVad.start();

    const [{ token }, iceServers] = await Promise.all([
      mintSessionToken(this.apiKey),
      fetchIceServers(this.apiKey).catch(error => {
        log('ICE servers fetch failed, continuing with defaults: %o', error);
        return [] as InworldIceServer[];
      }),
    ]);

    const remoteTrackPromise = this.createPeerConnection(iceServers);
    await this.negotiateCall(token);
    this.outputAudioTrack = await remoteTrackPromise;

    this.outputAudioVad = new VoiceActivityDetector({
      track: this.outputAudioTrack,
      ...this.vadOptions,
    });
    await this.outputAudioVad.start();

    await this.waitForDataChannelOpen();
    this.sendSessionUpdate();
  }

  private async startWebSocket() {
    const { token } = await mintSessionToken(this.apiKey);
    await this.connectWebSocket(token);

    const { push, flush } = await this.setupOutputAudio(AUDIO_SAMPLE_RATE);
    this.pushOutputAudio = push;
    this.flushOutputAudioBuffer = flush;

    await this.setupSourceAudio(
      binary => {
        this.sendEvent({
          type: 'input_audio_buffer.append',
          audio: btoa(binary as string),
        });
      },
      this.chunkMs,
      AUDIO_SAMPLE_RATE,
      'i16',
      'string',
    );

    if (!this.outputAudioTrack) {
      throw new Error('Failed to get output audio track');
    }
  }

  private connectWebSocket(token: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = buildRealtimeWebSocketUrl();
      // Browser WebSockets can't set Authorization headers; use bearer_ subprotocol.
      // https://docs.inworld.ai/portal/session-tokens
      this.websocket = new WebSocket(url, [`bearer_${token}`]);

      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('Timed out waiting for Inworld WebSocket session'));
      }, 15000);

      this.websocket.addEventListener('open', () => {
        log('websocket open');
      });

      this.websocket.addEventListener('message', event => {
        let msg: RealtimeEvent;
        try {
          msg = JSON.parse(String(event.data)) as RealtimeEvent;
        } catch {
          log('non-json websocket message: %o', event.data);
          return;
        }

        if (!settled && msg.type === 'session.created') {
          settled = true;
          clearTimeout(timeout);
          this.sendSessionUpdate();
          resolve();
          return;
        }

        if (!settled && msg.type === 'error') {
          settled = true;
          clearTimeout(timeout);
          reject(new Error(msg.error?.message ?? 'Inworld WebSocket session error'));
          return;
        }

        this.onRealtimeEvent(msg);
      });

      this.websocket.addEventListener('error', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(new Error('Inworld WebSocket connection error'));
      });

      this.websocket.addEventListener('close', event => {
        clearTimeout(timeout);
        log('websocket close code=%s reason=%s', event.code, event.reason);
        if (!settled) {
          settled = true;
          reject(new Error(event.reason || 'WebSocket closed before session.created'));
          return;
        }
        if (!this.running) return;
        this.stop(event.reason || 'WebSocket closed');
      });
    });
  }

  private createPeerConnection(iceServers: InworldIceServer[]): Promise<MediaStreamTrack> {
    this.peerConnection = new RTCPeerConnection({
      iceServers: iceServers.length ? iceServers : undefined,
    });

    this.dataChannel = this.peerConnection.createDataChannel('oai-events', { ordered: true });
    this.dataChannel.addEventListener('message', event => {
      let msg: RealtimeEvent;
      try {
        msg = JSON.parse(String(event.data)) as RealtimeEvent;
      } catch {
        log('non-json data channel message: %o', event.data);
        return;
      }
      this.onRealtimeEvent(msg);
    });
    this.dataChannel.addEventListener('close', () => {
      if (!this.running) return;
      this.stop('Data channel closed');
    });
    this.dataChannel.addEventListener('error', () => {
      this.notifyError('Inworld data channel error');
    });

    this.mediaStream!.getAudioTracks().forEach(track => {
      this.peerConnection!.addTrack(track, this.mediaStream!);
    });

    this.audioElement = document.createElement('audio');
    this.audioElement.autoplay = true;
    document.body.appendChild(this.audioElement);

    const remoteTrackPromise = new Promise<MediaStreamTrack>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.remoteTrackReject = null;
        reject(new Error('Timed out waiting for Inworld remote audio track'));
      }, 15000);

      this.remoteTrackReject = reason => {
        clearTimeout(timeout);
        this.remoteTrackReject = null;
        reject(reason);
      };

      this.peerConnection!.ontrack = event => {
        const track = event.track;
        if (track.kind !== 'audio') return;
        clearTimeout(timeout);
        this.remoteTrackReject = null;
        if (this.audioElement) {
          this.audioElement.srcObject = new MediaStream([track]);
        }
        resolve(track);
      };

      this.peerConnection!.onconnectionstatechange = () => {
        const state = this.peerConnection?.connectionState;
        log('connectionState=%s', state);
        if (state === 'failed') {
          this.remoteTrackReject?.(new Error('Inworld WebRTC connection failed'));
          if (this.running) this.stop('WebRTC connection failed');
        } else if (state === 'closed' || state === 'disconnected') {
          if (this.running) this.stop(`WebRTC ${state}`);
        }
      };
    });
    void remoteTrackPromise.catch(() => {});
    return remoteTrackPromise;
  }

  private async negotiateCall(token: string) {
    if (!this.peerConnection) {
      throw new Error('Peer connection not initialized');
    }

    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);
    await waitForIceGathering(this.peerConnection);

    const sdp = this.peerConnection.localDescription?.sdp;
    if (!sdp) {
      throw new Error('Failed to create local SDP offer');
    }

    const session = this.buildSessionConfig();
    const response = await fetch(INWORLD_CALLS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sdp, session }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Inworld call create failed (${response.status}): ${detail}`);
    }

    const location = response.headers.get('Location');
    const data = (await response.json()) as {
      id?: string;
      sdp?: string;
      ice_servers?: InworldIceServer[];
    };

    this.callId = data.id ?? location?.split('/').pop() ?? null;
    if (!data.sdp) {
      throw new Error('Inworld call response did not include an SDP answer');
    }

    if (data.ice_servers?.length) {
      this.peerConnection.setConfiguration({ iceServers: data.ice_servers });
    }

    await this.peerConnection.setRemoteDescription({ type: 'answer', sdp: data.sdp });
    log('call negotiated id=%s', this.callId);
  }

  private buildSessionConfig() {
    return {
      type: 'realtime',
      model: this.model,
      instructions: this.context,
      output_modalities: ['audio', 'text'],
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: AUDIO_SAMPLE_RATE },
          transcription: { model: this.transcriptionModel },
          turn_detection: toApiTurnDetection(this.turnDetection),
        },
        output: {
          format: { type: 'audio/pcm', rate: AUDIO_SAMPLE_RATE },
          model: this.ttsModel,
          voice: this.voice,
        },
      },
    };
  }

  private sendSessionUpdate() {
    this.sendEvent({
      type: 'session.update',
      session: this.buildSessionConfig(),
    });
  }

  private waitForDataChannelOpen(timeoutMs = 10000): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.dataChannel) {
        reject(new Error('Data channel not initialized'));
        return;
      }
      if (this.dataChannel.readyState === 'open') {
        resolve();
        return;
      }
      const timeout = setTimeout(() => {
        reject(new Error('Timed out waiting for Inworld data channel'));
      }, timeoutMs);
      this.dataChannel.addEventListener(
        'open',
        () => {
          clearTimeout(timeout);
          resolve();
        },
        { once: true },
      );
    });
  }

  private onRealtimeEvent(msg: RealtimeEvent) {
    log('event %s %o', msg.type, msg);

    if (msg.type === 'error') {
      const message = msg.error?.message ?? 'Unknown Inworld error';
      this.notifyError(message);
      return;
    }

    if (msg.type === 'response.output_audio.delta' && msg.delta) {
      this.pushOutputAudio?.(atob(msg.delta));
      return;
    }

    if (
      msg.type === 'input_audio_buffer.speech_started' ||
      msg.type === 'conversation.item.truncated'
    ) {
      this.flushOutputAudioBuffer?.();
      return;
    }

    if (msg.type === 'response.done') {
      const usage = msg.response?.usage;
      if (!usage) return;
      const { input_tokens: promptTokenCount, output_tokens: responseTokenCount } = usage;
      if (promptTokenCount) this.promptTokenCount += promptTokenCount;
      if (responseTokenCount) this.responseTokenCount += responseTokenCount;
    }
  }

  private sendEvent(payload: Record<string, unknown>) {
    const body = JSON.stringify(payload);
    if (this.websocket) {
      if (this.websocket.readyState !== WebSocket.OPEN) {
        throw new Error('Inworld WebSocket is not open');
      }
      this.websocket.send(body);
      return;
    }
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      throw new Error('Inworld data channel is not open');
    }
    this.dataChannel.send(body);
  }

  sendMessage(message: string): void {
    this.sendEvent({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: message }],
      },
    });
    this.sendEvent({ type: 'response.create' });
  }

  protected closeSession(reason?: string): void {
    log('closeSession %s', reason ?? '');

    this.remoteTrackReject?.(new Error(reason ?? 'Session closed'));
    this.remoteTrackReject = null;
    this.pushOutputAudio = null;
    this.flushOutputAudioBuffer = null;

    if (this.callId) {
      void fetch(`${INWORLD_CALLS_URL}/${this.callId}/hangup`, {
        method: 'POST',
        headers: { Authorization: `Basic ${this.apiKey}` },
      }).catch(error => log('hangup failed: %o', error));
      this.callId = null;
    }

    try {
      this.dataChannel?.close();
    } catch (error) {
      log('dataChannel close error: %o', error);
    }
    this.dataChannel = null;

    try {
      this.peerConnection?.close();
    } catch (error) {
      log('peerConnection close error: %o', error);
    }
    this.peerConnection = null;

    try {
      this.websocket?.close();
    } catch (error) {
      log('websocket close error: %o', error);
    }
    this.websocket = null;

    this.audioElement?.remove();
    this.audioElement = null;
  }
}
