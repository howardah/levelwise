<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { open } from "@tauri-apps/api/dialog";
import { convertFileSrc, invoke } from "@tauri-apps/api/tauri";
import { listen } from "@tauri-apps/api/event";
import { appWindow } from "@tauri-apps/api/window";

type Result = { service: string; target: number; note: string; color: string; canBoost: boolean };

type Analysis = { integratedLufs: number; loudnessRange: number; truePeakDbtp: number; durationSeconds: number; sampleRate: number; channels: number };
type Recording = Analysis & { name: string; path: string };
const selectedFile = ref<{ name: string; path: string } | null>(null);
const recordings = ref<Recording[]>([]);
const batchIndex = ref(0);
const batchTotal = ref(0);
const isDragging = ref(false);
const processing = ref(false);
const progress = ref(0);
const error = ref("");
const duration = ref(0);
const integrated = ref<number | null>(null);
const peak = ref<number | null>(null);
const lra = ref<number | null>(null);
const selectedService = ref("Spotify");
const player = ref<HTMLAudioElement>();
const isPreviewing = ref(false);
let unlistenFileDrop: (() => void) | undefined;
let audioContext: AudioContext | undefined;
let gainNode: GainNode | undefined;

const services: Result[] = [
  { service: "Spotify", target: -14, note: "Normal", color: "#8de36a", canBoost: true },
  { service: "Apple Music", target: -16, note: "Sound Check", color: "#ff9d85", canBoost: true },
  { service: "YouTube", target: -14, note: "Music", color: "#fa6b7e", canBoost: false },
  { service: "TIDAL", target: -14, note: "Normal", color: "#c4b5fd", canBoost: false },
  { service: "Amazon Music", target: -14, note: "Normalization", color: "#65c8ff", canBoost: false },
  { service: "Deezer", target: -15, note: "Normalization", color: "#f6ba65", canBoost: true },
];

const adjustment = (target: number, canBoost: boolean, loudness = integrated.value) => loudness === null ? 0 : canBoost ? target - loudness : Math.min(0, target - loudness);
const displayDb = (value: number | null, suffix = "") => value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(1)}${suffix}`;
const selectedPenalty = computed(() => { const service = services.find(s => s.service === selectedService.value) ?? services[0]; return adjustment(service.target, service.canBoost); });
const audioSource = computed(() => selectedFile.value ? convertFileSrc(selectedFile.value.path) : "");
const durationText = computed(() => {
  const minutes = Math.floor(duration.value / 60); const seconds = Math.round(duration.value % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
});

async function chooseFile() {
  const paths = await open({ multiple: true, filters: [{ name: "Audio", extensions: ["wav", "aiff", "mp3", "m4a", "aac", "flac", "ogg"] }] });
  if (typeof paths === "string") analyzeBatch([paths]);
  else if (Array.isArray(paths)) analyzeBatch(paths);
}
async function analyzeFile(path: string) {
  error.value = "";
  selectedFile.value = { name: path.split(/[\\/]/).pop() ?? path, path }; processing.value = true; progress.value = 0;
  const unlisten = await listen<number>("analysis-progress", ({ payload }) => { progress.value = payload; });
  // Some compressed files do not expose a total frame count. Keep their progress indicator alive
  // until the backend supplies the final result.
  const fallbackProgress = window.setInterval(() => { if (progress.value < 90) progress.value += 1; }, 700);
  try {
    const result = await invoke<Analysis>("analyze_audio", { path });
    duration.value = result.durationSeconds; integrated.value = result.integratedLufs; peak.value = result.truePeakDbtp; lra.value = result.loudnessRange; progress.value = 100;
    recordings.value.push({ name: selectedFile.value?.name ?? path, path, ...result });
  } catch (reason) {
    error.value = typeof reason === "string" ? reason : "This file could not be decoded."; selectedFile.value = null;
  } finally { window.clearInterval(fallbackProgress); unlisten(); setTimeout(() => { processing.value = false; }, 300); }
}
async function analyzeBatch(paths: string[]) {
  const uniquePaths = [...new Set(paths)];
  if (!uniquePaths.length) return;
  recordings.value = []; batchTotal.value = uniquePaths.length; batchIndex.value = 0;
  for (const [index, path] of uniquePaths.entries()) { batchIndex.value = index + 1; await analyzeFile(path); }
  batchTotal.value = 0;
}
function selectRecording(recording: Recording) {
  selectedFile.value = recording; duration.value = recording.durationSeconds; integrated.value = recording.integratedLufs; peak.value = recording.truePeakDbtp; lra.value = recording.loudnessRange;
}

function togglePreview() {
  if (!player.value) return;
  if (isPreviewing.value) { player.value.pause(); return; }
  setupPreviewGain();
  audioContext?.resume().then(() => player.value?.play()).catch(() => { error.value = "Playback could not start for this file."; });
}
function setupPreviewGain() {
  if (!player.value || gainNode) { applyPreviewGain(selectedPenalty.value); return; }
  audioContext = new AudioContext();
  gainNode = audioContext.createGain();
  audioContext.createMediaElementSource(player.value).connect(gainNode).connect(audioContext.destination);
  applyPreviewGain(selectedPenalty.value);
}
function applyPreviewGain(gain: number) {
  if (gainNode && audioContext) gainNode.gain.setValueAtTime(Math.pow(10, gain / 20), audioContext.currentTime);
  else if (player.value) player.value.volume = Math.min(1, Math.pow(10, gain / 20));
}
function reset() { player.value?.pause(); isPreviewing.value = false; selectedFile.value = null; recordings.value = []; integrated.value = peak.value = lra.value = null; duration.value = 0; error.value = ""; }

watch(selectedPenalty, applyPreviewGain);
onMounted(async () => {
  unlistenFileDrop = await appWindow.onFileDropEvent(({ payload }) => {
    if (payload.type === "hover") isDragging.value = true;
    if (payload.type === "cancel") isDragging.value = false;
    if (payload.type === "drop") {
      isDragging.value = false;
      const path = payload.paths[0];
      if (path) analyzeBatch(payload.paths);
    }
  });
});
onBeforeUnmount(() => { unlistenFileDrop?.(); audioContext?.close(); });
</script>

<template>
  <main>
    <header class="topbar">
      <a class="brand" href="#"><span class="brand-mark"><i></i><i></i><i></i></span>LOUD<span>VIEW</span></a>
      <div class="local-badge"><span></span> 100% local analysis</div>
      <button class="help" aria-label="About loudness">?</button>
    </header>

    <section class="hero">
      <p class="eyebrow">STREAMING LOUDNESS ANALYZER</p>
      <h1>Know how your music<br /><em>will translate.</em></h1>
      <p class="lede">Analyze one master or compare a batch — then preview how streaming services<br />will normalize each recording without uploading a thing.</p>
    </section>

    <section v-if="!selectedFile" class="upload-shell">
      <div class="upload-card" :class="{ dragging: isDragging }">
        <div class="upload-icon"><span>↑</span></div>
        <h2>Drop your masters here</h2>
        <p>Choose one file or a batch · WAV, AIFF, MP3, AAC, FLAC, or OGG</p>
        <button class="primary" @click="chooseFile">Choose audio files <span>→</span></button>
        <small>Your file stays on this device. Always.</small>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
      <div class="supported"><span>LOCAL · PRIVATE · NO ACCOUNT</span><div></div><span>BUILT FOR MASTERING</span></div>
    </section>

    <section v-else class="results-wrap">
      <div class="filebar">
        <div class="file-icon">♫</div><div><strong>{{ selectedFile.name }}</strong><span>{{ durationText }} · analyzed in Rust</span></div>
        <button class="text-button" @click="reset">Analyze another <span>↗</span></button>
      </div>
      <div v-if="processing" class="processing"><div class="progress"><i :style="{ width: progress + '%' }"></i></div><span>Analyzing {{ batchTotal > 1 ? `recording ${batchIndex} of ${batchTotal}` : 'your master' }} locally… {{ progress }}%</span></div>
      <template v-else>
        <div class="metrics">
          <article><p>INTEGRATED LOUDNESS</p><strong>{{ displayDb(integrated, ' LUFS') }}</strong><span>Gated EBU R128 measurement</span></article>
          <article><p>TRUE PEAK</p><strong>{{ displayDb(peak, ' dBTP') }}</strong><span>4× oversampled peak scan</span></article>
          <article><p>LOUDNESS RANGE</p><strong>{{ lra?.toFixed(1) ?? '—' }} <b>LU</b></strong><span>EBU Tech 3342 range</span></article>
        </div>
        <div v-if="recordings.length > 1" class="comparison">
          <div class="comparison-head"><div><p class="eyebrow">BATCH COMPARISON</p><h2>{{ recordings.length }} recordings</h2></div><span>Click a recording to inspect and preview it.</span></div>
          <button v-for="recording in recordings" :key="recording.path" class="recording-row" :class="{ active: selectedFile?.path === recording.path }" @click="selectRecording(recording)">
            <strong>{{ recording.name }}</strong><span>{{ displayDb(recording.integratedLufs, ' LUFS') }}</span><span>{{ displayDb(recording.truePeakDbtp, ' dBTP') }}</span><span>{{ recording.loudnessRange.toFixed(1) }} LU</span>
          </button>
        </div>
        <div class="section-title"><div><p class="eyebrow">NORMALIZATION PREVIEW</p><h2>Streaming service impact</h2></div><p>Estimated gain adjustment relative to each<br />platform’s standard playback level.</p></div>
        <div class="service-grid">
          <button v-for="item in services" :key="item.service" class="service" :class="{ active: selectedService === item.service }" @click="selectedService = item.service">
            <span class="service-dot" :style="{ background: item.color }"></span><div><strong>{{ item.service }}</strong><small>{{ item.note }} · {{ item.target }} LUFS</small></div><b :class="{ neutral: adjustment(item.target, item.canBoost) === 0, boost: adjustment(item.target, item.canBoost) > 0 }">{{ displayDb(adjustment(item.target, item.canBoost), ' dB') }}</b>
          </button>
        </div>
        <div class="preview">
          <div><p class="eyebrow">NORMALIZATION REFERENCE</p><h3>{{ selectedService }} would apply {{ displayDb(selectedPenalty, ' dB') }}</h3><span>Results are calculated locally against the platform target.</span></div>
          <div class="wave"><i v-for="n in 32" :key="n" :style="{ height: (20 + ((n * 31) % 58)) + '%' }"></i></div>
          <button class="play" :aria-label="isPreviewing ? 'Pause preview' : 'Play normalized preview'" @click="togglePreview">{{ isPreviewing ? 'Ⅱ' : '▶' }}</button>
          <audio ref="player" :src="audioSource" @play="isPreviewing = true" @pause="isPreviewing = false" @ended="isPreviewing = false"></audio>
        </div>
        <p class="disclaimer">EBU R128 / ITU-R BS.1770 analysis is performed locally in the Rust backend. No audio leaves your device.</p>
      </template>
    </section>
  </main>
</template>
