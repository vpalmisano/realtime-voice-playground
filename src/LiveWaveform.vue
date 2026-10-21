<script setup lang="ts">
import {
  Chart,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  type ChartConfiguration,
  type ChartDataset,
} from 'chart.js';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

Chart.register(LineController, LineElement, PointElement, LinearScale, Filler, Legend, Tooltip);

const props = withDefaults(
  defineProps<{
    inputMedia: MediaStream | null;
    outputMedia: MediaStream | null;
    inputColor?: string;
    outputColor?: string;
    windowSeconds?: number;
    height?: number;
  }>(),
  {
    inputColor: '#1976D2',
    outputColor: '#388E3C',
    windowSeconds: 60,
    height: 120,
  },
);

const canvasEl = ref<HTMLCanvasElement | null>(null);
const paused = ref(false);

type Point = { x: number; y: number | null };

type TrackState = {
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  timeDomain: Float32Array<ArrayBuffer>;
  upper: Point[];
  lower: Point[];
};

let audioCtx: AudioContext | null = null;
let inputTrack: TrackState | null = null;
let outputTrack: TrackState | null = null;
let chart: Chart<'line'> | null = null;
let rafId: ReturnType<typeof setTimeout> | null = null;
let lastSampleAt = 0;

const SAMPLE_INTERVAL_MS = 50;
const BG = '#222';
const GRID = '#444';
const FG = '#ddd';

function formatTime(ms: number) {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function withAlpha(hex: string, alpha: number) {
  const raw = hex.replace('#', '');
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map(c => c + c)
          .join('')
      : raw;
  const n = Number.parseInt(full, 16);
  if (Number.isNaN(n) || full.length !== 6) return hex;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function envelopePair(
  label: string,
  color: string,
  upper: Point[],
  lower: Point[],
): ChartDataset<'line', Point[]>[] {
  const common = {
    borderWidth: 1.5,
    pointRadius: 0,
    pointHoverRadius: 0,
    tension: 0.15,
    spanGaps: false,
  };
  return [
    {
      ...common,
      label,
      data: upper,
      borderColor: color,
      backgroundColor: withAlpha(color, 0.7),
      fill: '+1',
    },
    {
      ...common,
      label: `${label} (−)`,
      data: lower,
      borderColor: color,
      backgroundColor: withAlpha(color, 0.7),
      fill: false,
    },
  ];
}

function createChart() {
  const canvas = canvasEl.value;
  if (!canvas) return;

  chart?.destroy();

  const inputUpper: Point[] = [];
  const inputLower: Point[] = [];
  const outputUpper: Point[] = [];
  const outputLower: Point[] = [];

  const config: ChartConfiguration<'line'> = {
    type: 'line',
    data: {
      datasets: [
        ...envelopePair('Output', props.outputColor, outputUpper, outputLower),
        ...envelopePair('Input', props.inputColor, inputUpper, inputLower),
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'nearest', intersect: false },
      plugins: {
        legend: {
          display: true,
          labels: {
            color: FG,
            boxWidth: 10,
            boxHeight: 10,
            font: { size: 11 },
            filter: item => !String(item.text).endsWith('(−)'),
          },
        },
        tooltip: {
          enabled: true,
          titleColor: FG,
          bodyColor: FG,
          callbacks: {
            title: items => {
              const x = items[0]?.parsed.x;
              return x == null ? '' : formatTime(x);
            },
            label: item => {
              const name = item.dataset.label?.replace(' (−)', '') ?? '';
              const y = item.parsed.y ?? 0;
              return `${name}: ${Math.abs(y).toFixed(3)}`;
            },
          },
        },
      },
      scales: {
        x: {
          type: 'linear',
          min: Date.now() - props.windowSeconds * 1000,
          max: Date.now(),
          grid: { color: GRID },
          border: { color: GRID },
          ticks: {
            color: FG,
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 12,
            callback: value => formatTime(Number(value)),
          },
        },
        y: {
          min: -1,
          max: 1,
          grid: {
            color: ctx => (ctx.tick.value === 0 ? FG : GRID),
          },
          border: { display: false },
          ticks: { display: false },
        },
      },
    },
  };

  chart = new Chart(canvas, config);

  // Keep dataset array refs on tracks via chart.data
  return { inputUpper, inputLower, outputUpper, outputLower };
}

function createTrack(media: MediaStream, upper: Point[], lower: Point[]): TrackState {
  const source = audioCtx!.createMediaStreamSource(media);
  const analyser = audioCtx!.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.2;
  source.connect(analyser);
  return {
    source,
    analyser,
    timeDomain: new Float32Array(analyser.fftSize),
    upper,
    lower,
  };
}

function disposeTrack(track: TrackState | null) {
  track?.source.disconnect();
  track?.analyser.disconnect();
}

function sampleTrack(track: TrackState, wallNow: number, skipZero = true) {
  track.analyser.getFloatTimeDomainData(track.timeDomain);
  let peak = 0;
  for (let i = 0; i < track.timeDomain.length; i++) {
    const v = Math.abs(track.timeDomain[i]);
    if (v > peak) peak = v;
  }
  peak = Math.min(1, peak);

  if (skipZero && peak === 0) {
    // Break the line once when entering silence; skip further zero samples.
    const last = track.upper[track.upper.length - 1];
    if (last && last.y != null) {
      track.upper.push({ x: wallNow, y: null });
      track.lower.push({ x: wallNow, y: null });
    }
  } else {
    track.upper.push({ x: wallNow, y: peak });
    track.lower.push({ x: wallNow, y: -peak });
  }

  const windowStart = wallNow - props.windowSeconds * 1000;
  while (track.upper.length && track.upper[0].x < windowStart) {
    track.upper.shift();
    track.lower.shift();
  }
}

function togglePaused() {
  paused.value = !paused.value;
}

function stop() {
  if (rafId) {
    clearTimeout(rafId);
    rafId = null;
  }
  disposeTrack(inputTrack);
  disposeTrack(outputTrack);
  inputTrack = null;
  outputTrack = null;
  void audioCtx?.close();
  audioCtx = null;
  lastSampleAt = 0;
  paused.value = false;

  if (chart) {
    for (const ds of chart.data.datasets) {
      ds.data = [];
    }
    chart.update('none');
  }
}

function start() {
  stop();
  if (!props.inputMedia && !props.outputMedia) return;

  const buffers = createChart();
  if (!buffers || !chart) return;

  audioCtx = new AudioContext();
  if (props.inputMedia) {
    inputTrack = createTrack(props.inputMedia, buffers.inputUpper, buffers.inputLower);
  }
  if (props.outputMedia) {
    outputTrack = createTrack(props.outputMedia, buffers.outputUpper, buffers.outputLower);
  }
  void audioCtx.resume();

  const tick = (rafNow: number) => {
    if (!chart) return;

    if (!paused.value) {
      const wallNow = Date.now();

      if (!lastSampleAt || rafNow - lastSampleAt >= SAMPLE_INTERVAL_MS) {
        if (inputTrack) sampleTrack(inputTrack, wallNow);
        if (outputTrack) sampleTrack(outputTrack, wallNow);
        lastSampleAt = rafNow;
      }

      const x = chart.options.scales?.x;
      if (x && x.type === 'linear') {
        x.min = wallNow - props.windowSeconds * 1000;
        x.max = wallNow;
      }
      chart.update('none');
    }

    rafId = setTimeout(() => requestAnimationFrame(tick), 1000 / 25);
  };

  rafId = setTimeout(() => requestAnimationFrame(tick), 1000 / 25);
}

watch(
  () => [props.inputMedia, props.outputMedia] as const,
  () => {
    if (props.inputMedia || props.outputMedia) start();
    else stop();
  },
);

watch(
  () => [props.inputColor, props.outputColor, props.height, props.windowSeconds] as const,
  () => {
    if (props.inputMedia || props.outputMedia) start();
    else {
      createChart();
    }
  },
);

onMounted(() => {
  createChart();
  if (props.inputMedia || props.outputMedia) start();
});

onBeforeUnmount(() => {
  stop();
  chart?.destroy();
  chart = null;
});
</script>

<template>
  <div class="live-waveform-wrap">
    <div class="live-waveform" :style="{ height: `${height}px`, background: BG }">
      <canvas ref="canvasEl" />
      <v-btn
        class="live-waveform-pause"
        :icon="paused ? 'mdi-play' : 'mdi-pause'"
        size="x-small"
        variant="text"
        :color="FG"
        :title="paused ? 'Resume' : 'Pause'"
        @click="togglePaused"
      />
    </div>
  </div>
</template>

<style scoped>
.live-waveform-wrap {
  width: 100%;
}

.live-waveform {
  width: 100%;
  position: relative;
  border-radius: 4px;
  overflow: hidden;
}

.live-waveform-pause {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 1;
  opacity: 0.75;
}

.live-waveform-pause:hover {
  opacity: 1;
}
</style>
