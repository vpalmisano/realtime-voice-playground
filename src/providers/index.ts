import {
  getLlmProvider as getLlmProviderName,
  getSttProvider as getSttProviderName,
  getTtsProvider as getTtsProviderName,
} from '../PipelineSettings.vue';
import { getOptions as getElevenLabsSTTOptions } from './elevenlabs/ElevenLabsSTT.vue';
import { getOptions as getElevenLabsTTSOptions } from './elevenlabs/ElevenLabsTTS.vue';
import { getOptions as getGoogleSTTOptions } from './google/GoogleSTT.vue';
import { getOptions as getGoogleTTSOptions } from './google/GoogleTTS.vue';
import { getOptions as getGoogleLLMOptions } from './google/GoogleLLM.vue';
import { getOptions as getOpenaiSTTOptions } from './openai/OpenaiSTT.vue';
import { getOptions as getOpenaiTTSOptions } from './openai/OpenaiTTS.vue';
import { getOptions as getOpenaiLLMOptions } from './openai/OpenaiLLM.vue';
import { getOptions as getSpeechifyTTSOptions } from './speechify/SpeechifyTTS.vue';
import { getOptions as getCartesiaTTSOptions } from './cartesia/CartesiaTTS.vue';
import { getOptions as getGradiumSTTOptions } from './gradium/GradiumSTT.vue';
import { getOptions as getGradiumTTSOptions } from './gradium/GradiumTTS.vue';
import { ElevenLabsSTT } from '../lib/providers/elevenlabs/stt.ts';
import { ElevenLabsTTS } from '../lib/providers/elevenlabs/tts.ts';
import { GoogleSTT } from '../lib/providers/google/stt.ts';
import { GoogleTTS } from '../lib/providers/google/tts.ts';
import { GoogleLLM } from '../lib/providers/google/llm.ts';
import { OpenAISTT } from '../lib/providers/openai/stt.ts';
import { OpenAITTS } from '../lib/providers/openai/tts.ts';
import { OpenAILLM } from '../lib/providers/openai/llm.ts';
import { SpeechifyTTS } from '../lib/providers/speechify/tts.ts';
import { CartesiaTTS } from '../lib/providers/cartesia/tts.ts';
import type { BaseProvider } from '../lib/providers/base.ts';
import { getVadOptions } from '../PerfSettings.vue';
import { GradiumSTT } from '../lib/providers/gradium/stt.ts';
import { GradiumTTS } from '../lib/providers/gradium/tts.ts';

export function getSttProvider(): BaseProvider {
  const vadOptions = getVadOptions();
  switch (getSttProviderName()) {
    case 'Google':
      return new GoogleSTT(getGoogleSTTOptions(), vadOptions);
    case 'OpenAI':
      return new OpenAISTT(getOpenaiSTTOptions(), vadOptions);
    case 'ElevenLabs':
      return new ElevenLabsSTT(getElevenLabsSTTOptions(), vadOptions);
    case 'Gradium':
      return new GradiumSTT(getGradiumSTTOptions(), vadOptions);
    default:
      throw new Error('Invalid STT provider');
  }
}

export function getLlmProvider(): BaseProvider {
  switch (getLlmProviderName()) {
    case 'Google':
      return new GoogleLLM(getGoogleLLMOptions());
    case 'OpenAI':
      return new OpenAILLM(getOpenaiLLMOptions());
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
    case 'ElevenLabs':
      return new ElevenLabsTTS(getElevenLabsTTSOptions(), vadOptions);
    case 'Gradium':
      return new GradiumTTS(getGradiumTTSOptions(), vadOptions);
    default:
      throw new Error('Invalid TTS provider');
  }
}
