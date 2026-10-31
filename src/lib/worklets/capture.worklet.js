/**
 * Captures float input, converts to Int16 PCM, emits fixed-size chunks.
 * Options: { chunkMs?: number, keepAliveMs?: number } (default 80, 10000)
 * Out: { type: 'pcm', buffer: ArrayBuffer }
 */
class Pcm16CaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const chunkMs = options?.processorOptions?.chunkMs ?? 80;
    this._keepAliveMs = options?.processorOptions?.keepAliveMs ?? 10000;
    this._chunkSamples = Math.max(1, Math.round(sampleRate * (chunkMs / 1000)));
    this._pending = new Int16Array(this._chunkSamples);
    this._pendingCount = 0;
    this._chunkPeak = 0;
    this._silenceStart = 0;
    this._lastSentTimeMs = 0;
  }

  _emit() {
    const now = currentTime * 1000;
    if (this._chunkPeak < 0.01) {
      if (!this._silenceStart) {
        this._silenceStart = now;
      }
    } else {
      this._silenceStart = 0;
    }

    if (
      !this._silenceStart ||
      now - this._silenceStart < 5000 ||
      now - this._lastSentTimeMs > this._keepAliveMs
    ) {
      const pcm = this._pending.slice(0, this._pendingCount);
      this.port.postMessage({ type: 'pcm', buffer: pcm.buffer }, [pcm.buffer]);
      this._lastSentTimeMs = now;
    }

    this._pendingCount = 0;
    this._chunkPeak = 0;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) {
      return true;
    }

    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      const abs = s < 0 ? -s : s;
      if (abs > this._chunkPeak) {
        this._chunkPeak = abs;
      }
      this._pending[this._pendingCount++] = s < 0 ? s * 0x8000 : s * 0x7fff;

      if (this._pendingCount >= this._chunkSamples) {
        this._emit();
      }
    }
    return true;
  }
}

registerProcessor('pcm16-capture-processor', Pcm16CaptureProcessor);
