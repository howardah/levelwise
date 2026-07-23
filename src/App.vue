<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { open } from "@tauri-apps/api/dialog";
import { convertFileSrc, invoke } from "@tauri-apps/api/tauri";
import { listen } from "@tauri-apps/api/event";
import { appWindow } from "@tauri-apps/api/window";

type Result = { service: string; target: number; note: string; color: string };

type Analysis = { integratedLufs: number; loudnessRange: number; truePeakDbtp: number; durationSeconds: number; sampleRate: number; channels: number };
const selectedFile = ref<{ name: string; path: string } | null>(null);
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

const services: Result[] = [
  { service: "Spotify", target: -14, note: "Normal", color: "#8de36a" },
  { service: "Apple Music", target: -16, note: "Sound Check", color: "#ff9d85" },
  { service: "YouTube", target: -14, note: "Music", color: "#fa6b7e" },
  { service: "TIDAL", target: -14, note: "Normal", color: "#c4b5fd" },
  { service: "Amazon Music", target: -14, note: "Normalization", color: "#65c8ff" },
  { service: "Deezer", target: -15, note: "Normalization", color: "#f6ba65" },
];

const penalty = (target: number) => integrated.value === null ? 0 : Math.min(0, target - integrated.value);
const displayDb = (value: number | null, suffix = "") => value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(1)}${suffix}`;
const selectedPenalty = computed(() => penalty(services.find(s => s.service === selectedService.value)?.target ?? -14));
const audioSource = computed(() => selectedFile.value ? convertFileSrc(selectedFile.value.path) : "");
const durationText = computed(() => {
  const minutes = Math.floor(duration.value / 60); const seconds = Math.round(duration.value % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
});

async function chooseFile() {
  const path = await open({ multiple: false, filters: [{ name: "Audio", extensions: ["wav", "aiff", "mp3", "m4a", "aac", "flac", "ogg"] }] });
  if (typeof path === "string") analyze(path);
}
async function analyze(path: string) {
  error.value = "";
  selectedFile.value = { name: path.split(/[\\/]/).pop() ?? path, path }; processing.value = true; progress.value = 0;
  const unlisten = await listen<number>("analysis-progress", ({ payload }) => { progress.value = payload; });
  // Some compressed files do not expose a total frame count. Keep their progress indicator alive
  // until the backend supplies the final result.
  const fallbackProgress = window.setInterval(() => { if (progress.value < 90) progress.value += 1; }, 700);
  try {
    const result = await invoke<Analysis>("analyze_audio", { path });
    duration.value = result.durationSeconds; integrated.value = result.integratedLufs; peak.value = result.truePeakDbtp; lra.value = result.loudnessRange; progress.value = 100;
  } catch (reason) {
    error.value = typeof reason === "string" ? reason : "This file could not be decoded."; selectedFile.value = null;
  } finally { window.clearInterval(fallbackProgress); unlisten(); setTimeout(() => { processing.value = false; }, 300); }
}

function togglePreview() {
  if (!player.value) return;
  if (isPreviewing.value) { player.value.pause(); return; }
  player.value.volume = Math.pow(10, selectedPenalty.value / 20);
  player.value.play().catch(() => { error.value = "Playback could not start for this file."; });
}
function reset() { player.value?.pause(); isPreviewing.value = false; selectedFile.value = null; integrated.value = peak.value = lra.value = null; duration.value = 0; error.value = ""; }

watch(selectedPenalty, (gain) => { if (player.value) player.value.volume = Math.pow(10, gain / 20); });
onMounted(async () => {
  unlistenFileDrop = await appWindow.onFileDropEvent(({ payload }) => {
    if (payload.type === "hover") isDragging.value = true;
    if (payload.type === "cancel") isDragging.value = false;
    if (payload.type === "drop") {
      isDragging.value = false;
      const path = payload.paths[0];
      if (path) analyze(path);
    }
  });
});
onBeforeUnmount(() => unlistenFileDrop?.());
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
      <p class="lede">Analyze loudness and preview how streaming services<br />will normalize your master — without uploading a thing.</p>
    </section>

    <section v-if="!selectedFile" class="upload-shell">
      <div class="upload-card" :class="{ dragging: isDragging }">
        <div class="upload-icon"><span>↑</span></div>
        <h2>Drop your master here</h2>
        <p>WAV, AIFF, MP3, AAC, FLAC, or OGG</p>
        <button class="primary" @click="chooseFile">Choose audio file <span>→</span></button>
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
      <div v-if="processing" class="processing"><div class="progress"><i :style="{ width: progress + '%' }"></i></div><span>Reading your master locally… {{ progress }}%</span></div>
      <template v-else>
        <div class="metrics">
          <article><p>INTEGRATED LOUDNESS</p><strong>{{ displayDb(integrated, ' LUFS') }}</strong><span>Gated EBU R128 measurement</span></article>
          <article><p>TRUE PEAK</p><strong>{{ displayDb(peak, ' dBTP') }}</strong><span>4× oversampled peak scan</span></article>
          <article><p>LOUDNESS RANGE</p><strong>{{ lra?.toFixed(1) ?? '—' }} <b>LU</b></strong><span>EBU Tech 3342 range</span></article>
        </div>
        <div class="section-title"><div><p class="eyebrow">NORMALIZATION PREVIEW</p><h2>Streaming service impact</h2></div><p>Estimated gain adjustment relative to each<br />platform’s standard playback level.</p></div>
        <div class="service-grid">
          <button v-for="item in services" :key="item.service" class="service" :class="{ active: selectedService === item.service }" @click="selectedService = item.service">
            <span class="service-dot" :style="{ background: item.color }"></span><div><strong>{{ item.service }}</strong><small>{{ item.note }} · {{ item.target }} LUFS</small></div><b :class="{ neutral: penalty(item.target) === 0 }">{{ displayDb(penalty(item.target), ' dB') }}</b>
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
