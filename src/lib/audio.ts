import pcm16CaptureProcessorCode from './worklets/capture.worklet.js?raw';
import pcm16PlaybackProcessorCode from './worklets/playback.worklet.js?raw';
import debug from 'debug';

const log = debug('realtime:audio');

const workletModuleUrls = new Map<string, string>();

function workletModuleUrl(code: string) {
  let url = workletModuleUrls.get(code);
  if (!url) {
    url = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
    workletModuleUrls.set(code, url);
  }
  return url;
}

export async function processInputAudioTrack(
  track: MediaStreamTrack,
  targetSampleRate: number,
  callback: (pcm16: ArrayBuffer | string) => void,
  chunkMs = 80,
  stringFormat = false,
) {
  if (track.kind !== 'audio') {
    throw new Error('Track is not an audio track');
  }

  const audioCtx = new AudioContext({
    sampleRate: targetSampleRate,
    latencyHint: 'interactive',
  });
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }

  await audioCtx.audioWorklet.addModule(workletModuleUrl(pcm16CaptureProcessorCode));
  const worklet = new AudioWorkletNode(audioCtx, 'pcm16-capture-processor', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: { chunkMs },
  });
  worklet.port.onmessage = event => {
    const { type, buffer } = event.data ?? {};
    if (type !== 'pcm' || !buffer) {
      return;
    }
    if (!stringFormat) {
      callback(buffer);
      return;
    }
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    callback(binary);
  };

  const source = audioCtx.createMediaStreamSource(new MediaStream([track]));
  const mute = audioCtx.createGain();
  mute.gain.value = 0;
  source.connect(worklet);
  worklet.connect(mute);
  mute.connect(audioCtx.destination);

  const close = () => {
    worklet.port.onmessage = null;
    source.disconnect();
    worklet.disconnect();
    mute.disconnect();
    void audioCtx.close().catch(() => {});
  };
  track.addEventListener('ended', () => close());
  const trackStop = track.stop.bind(track);
  track.stop = () => {
    close();
    trackStop();
  };

  return { close: track.stop };
}

type OutputAudioTrack<TPush> = {
  push: (chunk: TPush) => void;
  flush: () => void;
  track: MediaStreamTrack;
  close: () => void;
};

export async function processOutputAudioTrackPcm(
  sampleRate?: number,
  format?: 'i16',
): Promise<OutputAudioTrack<string | Uint8Array>>;
export async function processOutputAudioTrackPcm(
  sampleRate: number,
  format: 'f32',
): Promise<OutputAudioTrack<Float32Array>>;
export async function processOutputAudioTrackPcm(
  sampleRate = 24000,
  format: 'f32' | 'i16' = 'i16',
): Promise<OutputAudioTrack<string | Float32Array | Uint8Array>> {
  if (!['f32', 'i16'].includes(format)) {
    throw new Error(`Invalid format: ${format}`);
  }

  const audioContext = new AudioContext({
    sampleRate,
    latencyHint: 'interactive',
  });
  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }

  await audioContext.audioWorklet.addModule(workletModuleUrl(pcm16PlaybackProcessorCode));
  const worklet = new AudioWorkletNode(audioContext, 'pcm16-playback-processor', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: { format },
  });

  const destination = audioContext.createMediaStreamDestination();
  const outputAudioTrack = destination.stream.getAudioTracks()[0];
  if (!outputAudioTrack) {
    throw new Error('Failed to create output audio track');
  }

  worklet.connect(audioContext.destination);
  worklet.connect(destination);

  return {
    push: (chunk: string | Float32Array | Uint8Array) => {
      if (!chunk.length) {
        return;
      }
      if (chunk instanceof Float32Array || chunk instanceof Uint8Array) {
        const samples = chunk.slice();
        worklet.port.postMessage({ audio: samples }, [samples.buffer]);
        return;
      }
      worklet.port.postMessage({ audio: chunk });
    },
    flush: () => worklet.port.postMessage({ type: 'flush' }),
    track: outputAudioTrack,
    close: () => {
      worklet.port.postMessage({ type: 'flush' });
      worklet.disconnect();
      void audioContext.close().catch(() => {});
      outputAudioTrack.stop();
    },
  };
}

export async function processOutputAudioTrackMp3(sampleRate = 24000) {
  if (!MediaSource.isTypeSupported('audio/mpeg')) {
    throw new Error('MediaSource does not support audio/mpeg');
  }

  const audio = document.createElement('audio');
  audio.autoplay = true;

  const mediaSource = new MediaSource();
  const objectUrl = URL.createObjectURL(mediaSource);
  audio.src = objectUrl;

  let sourceBuffer: SourceBuffer | null = null;
  const pending: Uint8Array<ArrayBuffer>[] = [];

  const appendNext = () => {
    if (!sourceBuffer || sourceBuffer.updating || pending.length === 0) {
      return;
    }
    sourceBuffer.appendBuffer(pending.shift()!);
  };

  await new Promise<void>((resolve, reject) => {
    mediaSource.addEventListener('sourceopen', () => resolve(), { once: true });
    mediaSource.addEventListener('error', () => reject(new Error('MediaSource error')), {
      once: true,
    });
  });

  const audioContext = new AudioContext({
    sampleRate,
    latencyHint: 'interactive',
  });
  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }
  const elementSource = audioContext.createMediaElementSource(audio);
  const destination = audioContext.createMediaStreamDestination();
  elementSource.connect(destination);
  elementSource.connect(audioContext.destination);

  const outputAudioTrack = destination.stream.getAudioTracks()[0];
  if (!outputAudioTrack) {
    throw new Error('Failed to create output audio track');
  }

  return {
    push: (chunk: Uint8Array<ArrayBuffer>) => {
      if (!chunk.length || mediaSource.readyState !== 'open') {
        return;
      }
      if (!sourceBuffer) {
        sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');
        sourceBuffer.addEventListener('updateend', appendNext);
      }
      pending.push(chunk);
      appendNext();
      void audio.play().catch(() => {});
    },
    flush: () => {
      log('flush');
      pending.length = 0;
      if (!sourceBuffer) {
        return;
      }
      try {
        if (sourceBuffer.updating) {
          sourceBuffer.abort();
        }
        if (sourceBuffer.buffered.length > 0) {
          audio.currentTime = sourceBuffer.buffered.end(sourceBuffer.buffered.length - 1);
        }
      } catch (error) {
        log('flush error: %o', error);
      }
    },
    track: outputAudioTrack,
    close: () => {
      log('close');
      pending.length = 0;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      if (mediaSource.readyState === 'open') {
        try {
          mediaSource.endOfStream();
        } catch {
          // ignore
        }
      }
      URL.revokeObjectURL(objectUrl);
      elementSource.disconnect();
      void audioContext.close().catch(() => {});
      outputAudioTrack.stop();
    },
  };
}
