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

export function getSttProvider(): BaseProvider {
  switch (getSttProviderName()) {
    case 'Google':
      return new GoogleSTT(getGoogleSTTOptions());
    case 'OpenAI':
      return new OpenAISTT(getOpenaiSTTOptions());
    case 'ElevenLabs':
      return new ElevenLabsSTT(getElevenLabsSTTOptions());
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
  switch (getTtsProviderName()) {
    case 'Google':
      return new GoogleTTS(getGoogleTTSOptions());
    case 'OpenAI':
      return new OpenAITTS(getOpenaiTTSOptions());
    case 'Speechify':
      return new SpeechifyTTS(getSpeechifyTTSOptions());
    case 'Cartesia':
      return new CartesiaTTS(getCartesiaTTSOptions());
    case 'ElevenLabs':
      return new ElevenLabsTTS(getElevenLabsTTSOptions());
    default:
      throw new Error('Invalid TTS provider');
  }
}
