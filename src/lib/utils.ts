import { ref, watch } from 'vue';
import pcm16CaptureProcessorUrl from './capture.worklet.js?url';
import pcm16PlaybackProcessorUrl from './playback.worklet.js?url';

function loadString(key: string, fallback: string) {
  return (localStorage.getItem(key) ?? fallback).trim();
}

function loadBool(key: string, fallback: boolean) {
  const saved = localStorage.getItem(key);
  return saved === null ? fallback : saved === 'true';
}

function loadNumber(key: string, fallback: number) {
  const saved = localStorage.getItem(key);
  if (saved === null) return fallback;
  const n = Number(saved);
  return Number.isFinite(n) ? n : fallback;
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export async function processInputAudioTrack(
  track: MediaStreamTrack,
  targetSampleRate: number,
  callback: (pcm16: ArrayBuffer) => void,
  chunkMs = 80,
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

  await audioCtx.audioWorklet.addModule(pcm16CaptureProcessorUrl);
  const worklet = new AudioWorkletNode(audioCtx, 'pcm16-capture-processor', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: { chunkMs },
  });
  worklet.port.onmessage = event => {
    const { type, buffer } = event.data ?? {};
    if (type === 'pcm' && buffer) {
      callback(buffer);
    }
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

export async function processOutputAudioTrack(sampleRate = 24000) {
  const audioContext = new AudioContext({
    sampleRate,
    latencyHint: 'interactive',
  });
  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }

  await audioContext.audioWorklet.addModule(pcm16PlaybackProcessorUrl);
  const worklet = new AudioWorkletNode(audioContext, 'pcm16-playback-processor', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  });

  const destination = audioContext.createMediaStreamDestination();
  const outputAudioTrack = destination.stream.getAudioTracks()[0];
  worklet.connect(audioContext.destination);
  worklet.connect(destination);

  return {
    push: (binaryString: string) => {
      if (!binaryString.length) {
        return;
      }
      worklet.port.postMessage({ type: 'pcm', binary: binaryString });
    },
    flush: () => worklet.port.postMessage({ type: 'flush' }),
    track: outputAudioTrack,
    close: () => {
      worklet.port.postMessage({ type: 'flush' });
      worklet.disconnect();
      void audioContext.close().catch(() => {});
    },
  };
}

export function defineReference<T extends string | number | boolean>(
  name: string,
  fallback: T,
  options: readonly T[] = [],
  onChange?: (value: T) => void,
) {
  const initialValue =
    typeof fallback === 'string'
      ? loadString(name, fallback)
      : typeof fallback === 'number'
        ? loadNumber(name, fallback)
        : loadBool(name, fallback);
  const reference = ref<T>(initialValue as T);
  watch(reference, value => {
    localStorage.setItem(name, String(value));
    onChange?.(value as T);
  });
  if (options.length && !options.includes(reference.value as T)) {
    reference.value = fallback;
  }
  return reference;
}
