import { AutoTokenizer, WhisperFeatureExtractor } from '@huggingface/transformers';
import * as ort from 'onnxruntime-web/webgpu';
import type { PreTrainedTokenizer } from '@huggingface/transformers';

const MODEL_ID = 'Reson8/Rumble-2-Flash';
const WEB_MODEL_ID = 'kaptionai/rumble-2-flash-web';
const MODEL_URL = `https://huggingface.co/${WEB_MODEL_ID}/resolve/main/`;
const SAMPLE_RATE = 16000;
const WINDOW_SAMPLES = SAMPLE_RATE * 8;
const AUDIO_TOKENS_PER_WINDOW = 104;
const HIDDEN_SIZE = 1024;
const KV_HEADS = 8;
const KV_DIM = 128;
const LAYERS = 14;
const MAX_NEW_TOKENS = 512;
const floatBuffer = new ArrayBuffer(4);
const floatView = new Float32Array(floatBuffer);
const bitsView = new Uint32Array(floatBuffer);

type PromptConfig = {
  prefix: number[];
  suffix: number[];
  audio_pad: number[];
  asr_text: number[];
  eos: number[];
  language: Record<string, number[]>;
};

type WorkerRequest =
  | { type: 'load'; language?: string }
  | { type: 'transcribe'; samples: Float32Array }
  | { type: 'dispose' };

type WorkerResponse =
  | { type: 'progress'; message: string; value: number }
  | { type: 'ready' }
  | { type: 'text'; text: string }
  | { type: 'error'; error: string };

const post = (message: WorkerResponse) => self.postMessage(message);

let encoder: ort.InferenceSession | null = null;
let decoder: ort.InferenceSession | null = null;
let tokenizer: PreTrainedTokenizer | null = null;
let extractor: WhisperFeatureExtractor | null = null;
let promptConfig: PromptConfig | null = null;
let language: string | undefined;
let embeddingTable: Int8Array | null = null;
let embeddingScales: Float32Array | null = null;
let isDecoding = false;
const pendingAudio: Float32Array[] = [];

async function fetchArrayBuffer(path: string): Promise<ArrayBuffer> {
  const response = await fetch(new URL(path, MODEL_URL), { cache: 'force-cache' });
  if (!response.ok) {
    throw new Error(`Failed to load ${path} (${response.status})`);
  }
  return response.arrayBuffer();
}

function convOut(frames: number): number {
  return Math.floor((frames + 1) / 2);
}

function audioTokenCount(frames: number): number {
  const remainder = frames % 100;
  return convOut(convOut(convOut(remainder))) + Math.floor(frames / 100) * 13;
}

function floatToHalf(value: number): number {
  floatView[0] = value;
  const raw = bitsView[0] ?? 0;
  const sign = (raw >>> 16) & 0x8000;
  let exponent = ((raw >>> 23) & 0xff) - 127 + 15;
  let mantissa = raw & 0x7fffff;

  if (exponent <= 0) {
    if (exponent < -10) return sign;
    mantissa = (mantissa | 0x800000) >>> (1 - exponent);
    return sign | ((mantissa + 0x1000) >>> 13);
  }
  if (exponent >= 31) {
    return sign | 0x7c00 | (mantissa ? 0x0200 : 0);
  }
  mantissa += 0x1000;
  if (mantissa & 0x800000) {
    mantissa = 0;
    exponent += 1;
    if (exponent >= 31) return sign | 0x7c00;
  }
  return sign | (exponent << 10) | (mantissa >>> 13);
}

function getTokenEmbedding(tokenId: number, target: Uint16Array, offset: number) {
  if (!embeddingTable || !embeddingScales) {
    throw new Error('Reson8 embedding table is not loaded');
  }
  const scale = embeddingScales[tokenId] ?? 0;
  const sourceOffset = tokenId * HIDDEN_SIZE;
  for (let i = 0; i < HIDDEN_SIZE; i += 1) {
    target[offset + i] = floatToHalf((embeddingTable[sourceOffset + i] ?? 0) * scale);
  }
}

function makePastCache(): Record<string, ort.Tensor> {
  const past: Record<string, ort.Tensor> = {};
  for (let layer = 0; layer < LAYERS; layer += 1) {
    for (const kind of ['key', 'value']) {
      past[`past_key_values.${layer}.${kind}`] = new ort.Tensor('float16', new Uint16Array(0), [
        1,
        KV_HEADS,
        0,
        KV_DIM,
      ]);
    }
  }
  return past;
}

async function loadModel() {
  const gpu = (
    navigator as Navigator & {
      gpu?: {
        requestAdapter: () => Promise<{ features: { has: (feature: string) => boolean } } | null>;
      };
    }
  ).gpu;
  if (!gpu) {
    throw new Error('WebGPU is required for Reson8 Rumble-2-Flash');
  }
  const adapter = await gpu.requestAdapter();
  if (!adapter?.features.has('shader-f16')) {
    throw new Error('This model requires a WebGPU adapter with shader-f16 support');
  }

  const [configBuffer, filtersBuffer] = await Promise.all([
    fetchArrayBuffer('prompt_config.json'),
    fetchArrayBuffer('mel_filters.json'),
  ]);
  promptConfig = JSON.parse(new TextDecoder().decode(configBuffer)) as PromptConfig;
  const melFilters = JSON.parse(new TextDecoder().decode(filtersBuffer)) as { data: number[][] };
  extractor = new WhisperFeatureExtractor({
    feature_size: 128,
    sampling_rate: SAMPLE_RATE,
    n_fft: 400,
    hop_length: 160,
    nb_max_frames: WINDOW_SAMPLES / 160,
    n_samples: WINDOW_SAMPLES,
    mel_filters: melFilters.data,
  });

  tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
  const [embedBuffer, scalesBuffer] = await Promise.all([
    fetchArrayBuffer('embed_tokens.int8.bin'),
    fetchArrayBuffer('embed_scales.f32.bin'),
  ]);
  embeddingTable = new Int8Array(embedBuffer);
  embeddingScales = new Float32Array(scalesBuffer);

  const encoderBytes = await fetchArrayBuffer('encoder.int8f16.onnx');
  encoder = await ort.InferenceSession.create(new Uint8Array(encoderBytes), {
    executionProviders: ['webgpu'],
    preferredOutputLocation: 'cpu',
  });

  const decoderBytes = await fetchArrayBuffer('decoder.gqa-q4f16.onnx');
  const decoderWeights = await fetchArrayBuffer('decoder_weights.q4f16.data');
  const cacheOutputs: Record<string, 'gpu-buffer'> = {};
  for (let layer = 0; layer < LAYERS; layer += 1) {
    cacheOutputs[`present.${layer}.key`] = 'gpu-buffer';
    cacheOutputs[`present.${layer}.value`] = 'gpu-buffer';
  }
  decoder = await ort.InferenceSession.create(new Uint8Array(decoderBytes), {
    executionProviders: ['webgpu'],
    externalData: [{ path: 'decoder_weights.q4f16.data', data: new Uint8Array(decoderWeights) }],
    preferredOutputLocation: { next_token: 'cpu', ...cacheOutputs },
  });
  post({ type: 'progress', message: 'Rumble-2-Flash ready', value: 100 });
}

async function encodeAudio(
  samples: Float32Array,
): Promise<{ embeddings: Float32Array; tokens: number }> {
  if (!encoder || !extractor) throw new Error('Reson8 encoder is not ready');
  const chunks: Float32Array[] = [];
  const tokenCounts: number[] = [];

  for (let start = 0; start < samples.length; start += WINDOW_SAMPLES) {
    const length = Math.min(WINDOW_SAMPLES, samples.length - start);
    const window = new Float32Array(WINDOW_SAMPLES);
    window.set(samples.subarray(start, start + length));
    const features = await extractor._extract_fbank_features(window);
    const mel = new ort.Tensor('float32', features.data as Float32Array, [1, 128, 800]);
    const validTokens = audioTokenCount(Math.max(1, Math.floor(length / 160)));
    const valid = new Float32Array(AUDIO_TOKENS_PER_WINDOW);
    valid.fill(1, 0, validTokens);
    const encoded = await encoder.run({
      mel,
      valid: new ort.Tensor('float32', valid, [1, AUDIO_TOKENS_PER_WINDOW]),
    });
    const data = encoded.emb?.data;
    if (!(data instanceof Float32Array)) {
      throw new Error('Reson8 encoder returned an unsupported embedding tensor');
    }
    chunks.push(data.subarray(0, validTokens * HIDDEN_SIZE));
    tokenCounts.push(validTokens);
  }

  const tokens = tokenCounts.reduce((sum, count) => sum + count, 0);
  const embeddings = new Float32Array(tokens * HIDDEN_SIZE);
  let offset = 0;
  for (const chunk of chunks) {
    embeddings.set(chunk, offset);
    offset += chunk.length;
  }
  return { embeddings, tokens };
}

async function transcribe(samples: Float32Array) {
  if (!decoder || !tokenizer || !promptConfig) throw new Error('Reson8 model is not ready');
  if (!samples.length) return;

  const { embeddings: audioEmbeddings, tokens: audioTokens } = await encodeAudio(samples);
  const padId = promptConfig.audio_pad[0];
  const asrTextId = promptConfig.asr_text[0];
  if (padId === undefined || asrTextId === undefined) {
    throw new Error('Reson8 prompt config is missing required token IDs');
  }

  const requestedLanguage = language;
  const languageKey = requestedLanguage
    ? Object.keys(promptConfig.language).find(
        key => key.toLowerCase() === requestedLanguage.toLowerCase(),
      )
    : undefined;
  if (requestedLanguage && !languageKey) {
    throw new Error(
      `Unsupported language "${requestedLanguage}"; use an English language name from the model's supported languages`,
    );
  }
  const forcedLanguage = languageKey ? promptConfig.language[languageKey] : undefined;
  const promptIds = [
    ...promptConfig.prefix,
    ...Array.from({ length: audioTokens }, () => padId),
    ...promptConfig.suffix,
    ...(forcedLanguage ? [...forcedLanguage, asrTextId] : []),
  ];
  const prompt = new Uint16Array(promptIds.length * HIDDEN_SIZE);
  let audioOffset = 0;
  for (let i = 0; i < promptIds.length; i += 1) {
    const id = promptIds[i];
    if (id === padId) {
      const start = audioOffset * HIDDEN_SIZE;
      for (let j = 0; j < HIDDEN_SIZE; j += 1) {
        prompt[i * HIDDEN_SIZE + j] = floatToHalf(audioEmbeddings[start + j] ?? 0);
      }
      audioOffset += 1;
    } else {
      getTokenEmbedding(id ?? 0, prompt, i * HIDDEN_SIZE);
    }
  }

  let sequenceLength = promptIds.length;
  let past = makePastCache();
  let inputs = prompt;
  const generated: number[] = [];
  const eos = new Set(promptConfig.eos);

  for (let step = 0; step < MAX_NEW_TOKENS; step += 1) {
    const attentionMask = new BigInt64Array(sequenceLength);
    attentionMask.fill(1n);
    const output = await decoder.run({
      attention_mask: new ort.Tensor('int64', attentionMask, [1, sequenceLength]),
      inputs_embeds: new ort.Tensor('float16', inputs, [
        1,
        inputs.length / HIDDEN_SIZE,
        HIDDEN_SIZE,
      ]),
      ...past,
    });
    const next = output.next_token?.data;
    if (!(next instanceof BigInt64Array)) {
      throw new Error('Reson8 decoder returned an unsupported token tensor');
    }
    const tokenId = Number(next[0]);
    if (!Number.isFinite(tokenId) || eos.has(tokenId)) break;
    generated.push(tokenId);

    const updatedPast: Record<string, ort.Tensor> = {};
    for (let layer = 0; layer < LAYERS; layer += 1) {
      updatedPast[`past_key_values.${layer}.key`] = output[`present.${layer}.key`] as ort.Tensor;
      updatedPast[`past_key_values.${layer}.value`] = output[
        `present.${layer}.value`
      ] as ort.Tensor;
    }
    past = updatedPast;
    sequenceLength += 1;
    inputs = new Uint16Array(HIDDEN_SIZE);
    getTokenEmbedding(tokenId, inputs, 0);
  }

  const asrIndex = generated.indexOf(asrTextId);
  const textIds = asrIndex >= 0 ? generated.slice(asrIndex + 1) : generated;
  const text = tokenizer.decode(textIds, { skip_special_tokens: true }).trim();
  if (text) post({ type: 'text', text });
}

async function processPending() {
  if (isDecoding) return;
  isDecoding = true;
  try {
    while (pendingAudio.length) {
      const samples = pendingAudio.shift();
      if (!samples) continue;
      try {
        await transcribe(samples);
      } catch (error) {
        post({
          type: 'error',
          error: error instanceof Error ? error.message : 'Transcription failed',
        });
      }
    }
  } finally {
    isDecoding = false;
  }
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    if (request.type === 'load') {
      language = request.language?.trim() || undefined;
      await loadModel();
      post({ type: 'ready' });
    } else if (request.type === 'transcribe') {
      pendingAudio.push(request.samples);
      void processPending();
    } else if (request.type === 'dispose') {
      pendingAudio.length = 0;
      await encoder?.release();
      await decoder?.release();
      encoder = null;
      decoder = null;
      self.close();
    }
  } catch (error) {
    post({
      type: 'error',
      error: error instanceof Error ? error.message : 'Failed to load Reson8 model',
    });
  }
};
