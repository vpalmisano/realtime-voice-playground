<script lang="ts">
export const INPUT_COLOR = '#1976D2';
export const OUTPUT_COLOR = '#388E3C';
</script>

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
  type Plugin,
} from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import 'hammerjs';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  Filler,
  Legend,
  Tooltip,
  zoomPlugin,
);

type Marker = { x: number; color: string; label?: string };

const markers: Marker[] = [];
const MARKER_HIT_PX = 8;

const markerTooltip = ref<{
  show: boolean;
  left: number;
  top: number;
  label: string;
  color: string;
}>({
  show: false,
  left: 0,
  top: 0,
  label: '',
  color: '#FFC107',
});

function findNearestMarker(chart: Chart<'line'>, pixelX: number): Marker | null {
  const xScale = chart.scales.x;
  if (!xScale) return null;
  const windowStart = Number(xScale.min);
  const windowEnd = Number(xScale.max);

  let best: Marker | null = null;
  let bestDist = MARKER_HIT_PX;
  for (const marker of markers) {
    if (marker.x < windowStart || marker.x > windowEnd) continue;
    const dist = Math.abs(xScale.getPixelForValue(marker.x) - pixelX);
    if (dist <= bestDist) {
      bestDist = dist;
      best = marker;
    }
  }
  return best;
}

function hideMarkerTooltip() {
  markerTooltip.value.show = false;
}

function onChartHover(event: MouseEvent | null, chart: Chart<'line'>) {
  if (!event || !canvasEl.value) {
    hideMarkerTooltip();
    return;
  }
  const rect = canvasEl.value.getBoundingClientRect();
  const pixelX = event.clientX - rect.left;
  const marker = findNearestMarker(chart, pixelX);
  if (!marker) {
    hideMarkerTooltip();
    return;
  }

  const xScale = chart.scales.x;
  const chartArea = chart.chartArea;
  const x = Math.min(
    Math.max(xScale.getPixelForValue(marker.x), chartArea.left + 12),
    chartArea.right - 12,
  );
  const text = marker.label?.trim();
  markerTooltip.value = {
    show: true,
    left: x,
    top: chartArea.top + 8,
    label: text ? `${text}\n${formatTime(marker.x, true)}` : formatTime(marker.x, true),
    color: marker.color,
  };
}

const markersPlugin: Plugin<'line'> = {
  id: 'turnMarkers',
  afterDatasetsDraw(chart) {
    const { ctx, chartArea, scales } = chart;
    const xScale = scales.x;
    if (!xScale || !chartArea) return;

    const windowStart = Number(xScale.min);
    const windowEnd = Number(xScale.max);

    ctx.save();
    for (const marker of markers) {
      if (marker.x < windowStart || marker.x > windowEnd) continue;
      const x = xScale.getPixelForValue(marker.x);
      ctx.beginPath();
      ctx.strokeStyle = marker.color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
    }
    ctx.restore();
  },
};

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
    inputColor: INPUT_COLOR,
    outputColor: OUTPUT_COLOR,
    windowSeconds: 60,
    height: 120,
  },
);

const canvasEl = ref<HTMLCanvasElement | null>(null);
const running = ref(false);
const paused = ref(false);

const ZOOM_STEP = 2;
const LIVE_EDGE_MS = 40;

const canZoomIn = ref(true);
const canZoomOut = ref(false);
const isZoomed = ref(false);
const followLive = ref(true);

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

function formatTime(ms: number, withMillis = false) {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  if (!withMillis) return `${hh}:${mm}:${ss}`;
  const mss = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${mss}`;
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

function retentionMs() {
  return props.windowSeconds * 1000;
}

function minRangeMs() {
  return Math.min(retentionMs(), 1000);
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

function syncZoomUi(now = Date.now()) {
  if (!chart) {
    canZoomIn.value = true;
    canZoomOut.value = false;
    isZoomed.value = false;
    return;
  }
  const xScale = chart.scales.x;
  const range = Number(xScale.max) - Number(xScale.min);
  const full = retentionMs();
  canZoomIn.value = range > minRangeMs() * 1.05;
  canZoomOut.value = range < full * 0.95;
  isZoomed.value = range < full * 0.95;
  followLive.value = Number(xScale.max) >= now - LIVE_EDGE_MS;
}

function updateZoomLimits(now: number) {
  if (!chart?.options.plugins) return;
  const zoom = chart.options.plugins.zoom;
  if (!zoom) return;
  zoom.limits = {
    x: {
      min: now - retentionMs(),
      max: now,
      minRange: minRangeMs(),
    },
    y: { min: -1, max: 1, minRange: 2 },
  };
}

function applyVisibleWindow(now = Date.now()) {
  if (!chart) return;
  const x = chart.options.scales?.x;
  if (!x || x.type !== 'linear') return;

  updateZoomLimits(now);

  // Don't fight the plugin while a gesture is in progress.
  if (chart.isZoomingOrPanning()) {
    syncZoomUi(now);
    return;
  }

  const xScale = chart.scales.x;
  const currentRange =
    xScale && Number.isFinite(xScale.min) && Number.isFinite(xScale.max)
      ? Number(xScale.max) - Number(xScale.min)
      : retentionMs();
  const range = Math.min(Math.max(currentRange, minRangeMs()), retentionMs());
  const dataStart = now - retentionMs();

  if (followLive.value) {
    x.max = now;
    x.min = now - range;
  } else {
    let max = Number(xScale?.max ?? x.max ?? now);
    let min = Number(xScale?.min ?? x.min ?? now - range);
    const span = Math.min(Math.max(max - min, minRangeMs()), retentionMs());

    if (min < dataStart) {
      min = dataStart;
      max = min + span;
    }
    if (max > now) {
      max = now;
      min = max - span;
    }
    if (max >= now - LIVE_EDGE_MS) {
      followLive.value = true;
      x.max = now;
      x.min = now - span;
    } else {
      x.max = max;
      x.min = min;
    }
  }

  chart.update('none');
  syncZoomUi(now);
}

function setXRange(min: number, max: number, now = Date.now()) {
  if (!chart) return;
  const span = Math.min(Math.max(max - min, minRangeMs()), retentionMs());
  const dataStart = now - retentionMs();
  let nextMax = Math.min(now, Math.max(dataStart + span, max));
  let nextMin = nextMax - span;
  if (nextMin < dataStart) {
    nextMin = dataStart;
    nextMax = nextMin + span;
  }
  updateZoomLimits(now);
  chart.zoomScale('x', { min: nextMin, max: nextMax }, 'none');
  followLive.value = nextMax >= now - LIVE_EDGE_MS;
  syncZoomUi(now);
}

function zoomIn() {
  if (!chart || !canZoomIn.value) return;
  const now = Date.now();
  const xScale = chart.scales.x;
  const min = Number(xScale.min);
  const max = Number(xScale.max);
  const nextRange = Math.max((max - min) / ZOOM_STEP, minRangeMs());
  if (followLive.value) {
    setXRange(now - nextRange, now, now);
  } else {
    const center = (min + max) / 2;
    setXRange(center - nextRange / 2, center + nextRange / 2, now);
  }
}

function zoomOut() {
  if (!chart || !canZoomOut.value) return;
  const now = Date.now();
  const xScale = chart.scales.x;
  const min = Number(xScale.min);
  const max = Number(xScale.max);
  const nextRange = Math.min((max - min) * ZOOM_STEP, retentionMs());
  if (followLive.value || nextRange >= retentionMs() * 0.95) {
    setXRange(now - nextRange, now, now);
  } else {
    const center = (min + max) / 2;
    setXRange(center - nextRange / 2, center + nextRange / 2, now);
  }
}

function onPanOrZoom() {
  syncZoomUi();
}

function createChart() {
  const canvas = canvasEl.value;
  if (!canvas) return;

  chart?.destroy();
  clearMarkers();
  followLive.value = true;

  const now = Date.now();
  const inputUpper: Point[] = [];
  const inputLower: Point[] = [];
  const outputUpper: Point[] = [];
  const outputLower: Point[] = [];

  const config: ChartConfiguration<'line'> = {
    type: 'line',
    data: {
      datasets: [
        ...envelopePair('Answer', props.outputColor, outputUpper, outputLower),
        ...envelopePair('Question', props.inputColor, inputUpper, inputLower),
      ],
    },
    plugins: [markersPlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'nearest', intersect: false },
      onHover: (event, _elements, chartInstance) => {
        onChartHover(event.native as MouseEvent | null, chartInstance as Chart<'line'>);
      },
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
              return x == null ? '' : formatTime(x, true);
            },
            label: item => {
              const name = item.dataset.label?.replace(' (−)', '') ?? '';
              const y = item.parsed.y ?? 0;
              return `${name}: ${Math.abs(y).toFixed(3)}`;
            },
          },
        },
        zoom: {
          limits: {
            x: {
              min: now - retentionMs(),
              max: now,
              minRange: minRangeMs(),
            },
            y: { min: -1, max: 1, minRange: 2 },
          },
          pan: {
            enabled: true,
            mode: 'x',
            threshold: 4,
            onPan: onPanOrZoom,
            onPanComplete: onPanOrZoom,
          },
          zoom: {
            mode: 'x',
            wheel: { enabled: true, speed: 0.1 },
            pinch: { enabled: true },
            onZoom: onPanOrZoom,
            onZoomComplete: onPanOrZoom,
          },
        },
      },
      scales: {
        x: {
          type: 'linear',
          min: now - retentionMs(),
          max: now,
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
  syncZoomUi(now);

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

  const windowStart = wallNow - retentionMs();
  while (track.upper.length && track.upper[0].x < windowStart) {
    track.upper.shift();
    track.lower.shift();
  }
}

function togglePaused() {
  paused.value = !paused.value;
}

function stop() {
  if (!running.value) return;
  running.value = false;
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
  followLive.value = true;
}

function clearMarkers() {
  markers.length = 0;
  hideMarkerTooltip();
}

function addMarker(x: number, color = '#FFC107', label?: string) {
  markers.push({ x, color, label });
  const windowStart = Date.now() - retentionMs();
  while (markers.length && markers[0].x < windowStart) {
    markers.shift();
  }
  chart?.update('none');
}

function clear() {
  clearMarkers();
  if (chart) {
    for (const ds of chart.data.datasets) {
      ds.data = [];
    }
    chart.update('none');
  }
}

defineExpose({ addMarker, clearMarkers });

function start() {
  if (running.value) return;

  if (!props.inputMedia && !props.outputMedia) return;
  running.value = true;
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
    if (!running.value || !chart) return;

    if (!paused.value) {
      const wallNow = Date.now();

      if (!lastSampleAt || rafNow - lastSampleAt >= SAMPLE_INTERVAL_MS) {
        if (inputTrack) sampleTrack(inputTrack, wallNow);
        if (outputTrack) sampleTrack(outputTrack, wallNow);
        lastSampleAt = rafNow;
      }

      const windowStart = wallNow - retentionMs();
      while (markers.length && markers[0].x < windowStart) {
        markers.shift();
      }

      applyVisibleWindow(wallNow);
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
    followLive.value = true;
    if (props.inputMedia || props.outputMedia) {
      if (running.value) stop();
      start();
    } else {
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
  clear();
  chart?.destroy();
  chart = null;
});
</script>

<template>
  <div class="live-waveform-wrap">
    <div
      class="live-waveform"
      :class="{ 'is-zoomed': isZoomed }"
      :style="{ height: `${height}px`, background: BG }"
    >
      <canvas ref="canvasEl" @mouseleave="hideMarkerTooltip" />
      <div
        v-if="markerTooltip.show"
        class="marker-tooltip"
        :style="{
          left: `${markerTooltip.left}px`,
          top: `${markerTooltip.top}px`,
          borderColor: markerTooltip.color,
        }"
      >
        {{ markerTooltip.label }}
      </div>
      <div class="live-waveform-controls">
        <v-btn
          icon="mdi-minus"
          size="x-small"
          variant="text"
          :color="FG"
          :disabled="!canZoomOut"
          title="Zoom out"
          @click="zoomOut"
        />
        <v-btn
          icon="mdi-plus"
          size="x-small"
          variant="text"
          :color="FG"
          :disabled="!canZoomIn"
          title="Zoom in"
          @click="zoomIn"
        />
        <v-btn
          v-if="running"
          :icon="paused ? 'mdi-play' : 'mdi-pause'"
          size="x-small"
          variant="text"
          :color="FG"
          :title="paused ? 'Resume' : 'Pause'"
          @click="togglePaused"
        />
      </div>
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

.live-waveform.is-zoomed {
  cursor: grab;
}

.live-waveform.is-zoomed:active {
  cursor: grabbing;
}

.live-waveform-controls {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 1;
  display: flex;
  gap: 0;
  opacity: 0.75;
}

.live-waveform-controls:hover {
  opacity: 1;
}

.marker-tooltip {
  position: absolute;
  z-index: 2;
  transform: translate(-50%, 0);
  pointer-events: none;
  max-width: 220px;
  padding: 4px 8px;
  border-radius: 4px;
  border: 1px solid;
  background: rgba(20, 20, 20, 0.92);
  color: #eee;
  font-size: 11px;
  line-height: 1.35;
  white-space: pre-line;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
}
</style>
