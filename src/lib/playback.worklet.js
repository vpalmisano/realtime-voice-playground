/**
 * Streams Int16 PCM into the audio graph, converting to float in process().
 * Messages: { type: 'pcm', binary: string } | { type: 'flush' }
 */
class Pcm16PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._capacity = 48000 * 10;
    this._buffer = new Int16Array(this._capacity);
    this._read = 0;
    this._write = 0;
    this._available = 0;

    this.port.onmessage = event => {
      const { type, binary } = event.data ?? {};
      if (type === 'flush') {
        this._read = 0;
        this._write = 0;
        this._available = 0;
        return;
      }
      if (type !== 'pcm' || typeof binary !== 'string') {
        return;
      }
      const byteLength = binary.length & ~1;
      if (!byteLength) {
        return;
      }
      const bytes = new Uint8Array(byteLength);
      for (let i = 0; i < byteLength; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      this._enqueue(new Int16Array(bytes.buffer));
    };
  }

  _grow(minCapacity) {
    let nextCapacity = this._capacity;
    while (nextCapacity < minCapacity) {
      nextCapacity *= 2;
    }
    const next = new Int16Array(nextCapacity);
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
    for (let i = 0; i < out.length; i++) {
      if (this._available > 0) {
        out[i] = this._buffer[this._read] / 0x8000;
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
