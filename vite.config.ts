import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import vuetify from 'vite-plugin-vuetify';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const { title, description, url } = JSON.parse(
  readFileSync(resolve(__dirname, 'package.json'), 'utf-8'),
) as {
  title: string;
  description: string;
  url: string;
};
const audioDir = resolve(__dirname, 'public/audio');
const questions = readdirSync(audioDir)
  .filter(f => f.endsWith('.mp3'))
  .sort();

export default defineConfig({
  plugins: [
    vue(),
    vuetify({ autoImport: true }),
    {
      name: 'html-description',
      transformIndexHtml(html) {
        return html
          .replaceAll('%DESCRIPTION%', description)
          .replaceAll('%TITLE%', title)
          .replaceAll('%URL%', url);
      },
    },
  ],
  define: {
    __QUESTIONS__: JSON.stringify(questions),
  },
  base: './',
  worker: { format: 'es' },
  optimizeDeps: {
    include: [
      '@ricky0123/vad-web',
      'onnxruntime-web',
      'onnxruntime-web/wasm',
      'onnxruntime-web/webgpu',
      '@jeffpeng3/nemotron-asr-core',
    ],
    exclude: ['phonon-tts', '@huggingface/transformers'],
  },
});
