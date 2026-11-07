/**
 * Streams PCM into the audio graph.
 * Messages:
 *   { audio: string }       — Int16 LE binary string (format 'i16')
 *   { audio: Uint8Array }   — Int16 LE bytes (format 'i16')
 *   { audio: Float32Array } — float samples (format 'f32')
 *   { type: 'flush' }
 * processorOptions.format: 'f32' | 'i16'
 */
class Pcm16PlaybackProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this._format = options?.processorOptions?.format === 'f32' ? 'f32' : 'i16';
    this._capacity = 48000 * 10;
    this._buffer =
      this._format === 'f32' ? new Float32Array(this._capacity) : new Int16Array(this._capacity);
    this._read = 0;
    this._write = 0;
    this._available = 0;

    this.port.onmessage = event => {
      const { type, audio } = event.data ?? {};
      if (type === 'flush') {
        this._read = 0;
        this._write = 0;
        this._available = 0;
        return;
      }
      if (this._format === 'f32') {
        if (audio instanceof Float32Array && audio.length) {
          this._enqueue(audio);
        }
        return;
      }
      if (audio instanceof Uint8Array) {
        this._enqueueI16Bytes(audio);
        return;
      }
      if (typeof audio !== 'string') {
        return;
      }
      const byteLength = audio.length & ~1;
      if (!byteLength) {
        return;
      }
      const bytes = new Uint8Array(byteLength);
      for (let i = 0; i < byteLength; i++) {
        bytes[i] = audio.charCodeAt(i);
      }
      this._enqueueI16Bytes(bytes);
    };
  }

  _enqueueI16Bytes(bytes) {
    const byteLength = bytes.byteLength & ~1;
    if (!byteLength) {
      return;
    }
    this._enqueue(new Int16Array(bytes.buffer, bytes.byteOffset, byteLength / 2));
  }

  _grow(minCapacity) {
    let nextCapacity = this._capacity;
    while (nextCapacity < minCapacity) {
      nextCapacity *= 2;
    }
    const next =
      this._format === 'f32' ? new Float32Array(nextCapacity) : new Int16Array(nextCapacity);
    if (this._available > 0) {
      const first = Math.min(this._available, this._capacity - this._read);
      next.set(this._buffer.subarray(this._read, this._read + first), 0);
      if (first < this._available) {
        next.set(this._buffer.subarray(0, this._available - first), first);
      }
    }
    this._buffer = next;
    this._capacity = nextCapacity;
    this._read = 0;
    this._write = this._available;
  }

  _enqueue(pcm) {
    const needed = this._available + pcm.length;
    if (needed > this._capacity) {
      this._grow(needed);
    }
    for (let i = 0; i < pcm.length; i++) {
      this._buffer[this._write] = pcm[i];
      this._write = (this._write + 1) % this._capacity;
    }
    this._available += pcm.length;
  }

  process(_inputs, outputs) {
    const out = outputs[0]?.[0];
    if (!out) {
      return true;
    }
    const scale = this._format === 'i16' ? 1 / 0x8000 : 1;
    for (let i = 0; i < out.length; i++) {
      if (this._available > 0) {
        out[i] = this._buffer[this._read] * scale;
        this._read = (this._read + 1) % this._capacity;
        this._available--;
      } else {
        out[i] = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm16-playback-processor', Pcm16PlaybackProcessor);
