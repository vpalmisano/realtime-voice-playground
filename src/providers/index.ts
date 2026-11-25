import {
  getLlmProvider as getLlmProviderName,
  getSttProvider as getSttProviderName,
  getTtsProvider as getTtsProviderName,
} from '../PipelineSettings.vue';
import { getOptions as getElevenLabsSTTOptions } from './elevenlabs/ElevenLabsSTT.vue';
import { getOptions as getAssemblyAISTTOptions } from './assemblyai/AssemblyAISTT.vue';
import { getOptions as getElevenLabsTTSOptions } from './elevenlabs/ElevenLabsTTS.vue';
import { getOptions as getGoogleSTTOptions } from './google/GoogleSTT.vue';
import { getOptions as getGoogleTTSOptions } from './google/GoogleTTS.vue';
import { getOptions as getGoogleLLMOptions } from './google/GoogleLLM.vue';
import { getOptions as getOpenaiSTTOptions } from './openai/OpenaiSTT.vue';
import { getOptions as getOpenaiTTSOptions } from './openai/OpenaiTTS.vue';
import { getOptions as getOpenaiLLMOptions } from './openai/OpenaiLLM.vue';
import { getOptions as getAnthropicLLMOptions } from './anthropic/AnthropicLLM.vue';
import { getOptions as getSpeechifyTTSOptions } from './speechify/SpeechifyTTS.vue';
import { getOptions as getCartesiaTTSOptions } from './cartesia/CartesiaTTS.vue';
import { getOptions as getAssemblyAITTSOptions } from './assemblyai/AssemblyAITTS.vue';
import { getOptions as getGradiumSTTOptions } from './gradium/GradiumSTT.vue';
import { getOptions as getGradiumTTSOptions } from './gradium/GradiumTTS.vue';
import { getOptions as getGradiumPhononTTSOptions } from './gradium/GradiumPhononTTS.vue';
import { getOptions as getCohereSTTOptions } from './cohere/CohereSTT.vue';
import { getOptions as getMistralVoxtralSTTOptions } from './mistral/MistralVoxtralSTT.vue';
import { getOptions as getNvidiaNemotronSTTOptions } from './nvidia/NvidiaNemotronSTT.vue';
import { getOptions as getReson8STTOptions } from './reson8/Reson8STT.vue';
import { getOptions as getNvidiaNemotronLLMOptions } from './nvidia/NvidiaNemotronLLM.vue';
import { ElevenLabsSTT } from '../lib/providers/elevenlabs/stt.ts';
import { AssemblyAISTT } from '../lib/providers/assemblyai/stt.ts';
import { ElevenLabsTTS } from '../lib/providers/elevenlabs/tts.ts';
import { GoogleSTT } from '../lib/providers/google/stt.ts';
import { GoogleTTS } from '../lib/providers/google/tts.ts';
import { GoogleLLM } from '../lib/providers/google/llm.ts';
import { OpenAISTT } from '../lib/providers/openai/stt.ts';
import { OpenAITTS } from '../lib/providers/openai/tts.ts';
import { OpenAILLM } from '../lib/providers/openai/llm.ts';
import { AnthropicLLM } from '../lib/providers/anthropic/llm.ts';
import { SpeechifyTTS } from '../lib/providers/speechify/tts.ts';
import { CartesiaTTS } from '../lib/providers/cartesia/tts.ts';
import { AssemblyAITTS } from '../lib/providers/assemblyai/tts.ts';
import type { BaseProvider } from '../lib/providers/base.ts';
import { getVadOptions } from '../PerfSettings.vue';
import { GradiumSTT } from '../lib/providers/gradium/stt.ts';
import { GradiumTTS } from '../lib/providers/gradium/tts.ts';
import { GradiumPhononTTS } from '../lib/providers/gradium/phonon-tts.ts';
import { CohereSTT } from '../lib/providers/cohere/stt.ts';
import { MistralVoxtralSTT } from '../lib/providers/mistral/stt.ts';
import { NvidiaNemotronSTT } from '../lib/providers/nvidia/stt.ts';
import { Reson8STT } from '../lib/providers/reson8/stt.ts';
import { NvidiaNemotronLLM } from '../lib/providers/nvidia/llm.ts';

export function getSttProvider(): BaseProvider {
  const vadOptions = getVadOptions();
  switch (getSttProviderName()) {
    case 'AssemblyAI':
      return new AssemblyAISTT(getAssemblyAISTTOptions(), vadOptions);
    case 'Cohere Transcribe':
      return new CohereSTT(getCohereSTTOptions(), vadOptions);
    case 'Google':
      return new GoogleSTT(getGoogleSTTOptions(), vadOptions);
    case 'OpenAI':
      return new OpenAISTT(getOpenaiSTTOptions(), vadOptions);
    case 'ElevenLabs':
      return new ElevenLabsSTT(getElevenLabsSTTOptions(), vadOptions);
    case 'Gradium':
      return new GradiumSTT(getGradiumSTTOptions(), vadOptions);
    case 'Mistral Voxtral Mini 4B Realtime 2602':
      return new MistralVoxtralSTT(getMistralVoxtralSTTOptions(), vadOptions);
    case 'NVIDIA Nemotron 3.5':
      return new NvidiaNemotronSTT(getNvidiaNemotronSTTOptions(), vadOptions);
    case 'Reson8 Rumble-2-Flash':
      return new Reson8STT(getReson8STTOptions(), vadOptions);
    default:
      throw new Error('Invalid STT provider');
  }
}

export function getLlmProvider(): BaseProvider {
  switch (getLlmProviderName()) {
    case 'Anthropic':
      return new AnthropicLLM(getAnthropicLLMOptions());
    case 'Google':
      return new GoogleLLM(getGoogleLLMOptions());
    case 'OpenAI':
      return new OpenAILLM(getOpenaiLLMOptions());
    case 'NVIDIA Nemotron 3 Nano 4B':
      return new NvidiaNemotronLLM(getNvidiaNemotronLLMOptions());
    default:
      throw new Error('Invalid LLM provider');
  }
}

export function getTtsProvider(): BaseProvider {
  const vadOptions = getVadOptions();
  switch (getTtsProviderName()) {
    case 'Google':
      return new GoogleTTS(getGoogleTTSOptions(), vadOptions);
    case 'OpenAI':
      return new OpenAITTS(getOpenaiTTSOptions(), vadOptions);
    case 'Speechify':
      return new SpeechifyTTS(getSpeechifyTTSOptions(), vadOptions);
    case 'Cartesia':
      return new CartesiaTTS(getCartesiaTTSOptions(), vadOptions);
    case 'AssemblyAI':
      return new AssemblyAITTS(getAssemblyAITTSOptions(), vadOptions);
    case 'ElevenLabs':
      return new ElevenLabsTTS(getElevenLabsTTSOptions(), vadOptions);
    case 'Gradium':
      return new GradiumTTS(getGradiumTTSOptions(), vadOptions);
    case 'Gradium Phonon':
      return new GradiumPhononTTS(getGradiumPhononTTSOptions(), vadOptions);
    default:
      throw new Error('Invalid TTS provider');
  }
}
