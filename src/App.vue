<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";

type Result = { service: string; target: number; note: string; color: string };

const fileInput = ref<HTMLInputElement>();
const selectedFile = ref<File | null>(null);
const isDragging = ref(false);
const processing = ref(false);
const progress = ref(0);
const error = ref("");
const duration = ref(0);
const integrated = ref<number | null>(null);
const peak = ref<number | null>(null);
const crest = ref<number | null>(null);
const audioUrl = ref("");
const selectedService = ref("Spotify");
const player = ref<HTMLAudioElement>();
const isPreviewing = ref(false);

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
const fileSize = computed(() => selectedFile.value ? `${(selectedFile.value.size / 1048576).toFixed(1)} MB` : "");
const durationText = computed(() => {
  const minutes = Math.floor(duration.value / 60); const seconds = Math.round(duration.value % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
});

function chooseFile() { fileInput.value?.click(); }
function onFileInput(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]; if (file) analyze(file);
}
function dropFile(event: DragEvent) {
  isDragging.value = false; const file = event.dataTransfer?.files[0]; if (file) analyze(file);
}

async function analyze(file: File) {
  error.value = "";
  if (!file.type.startsWith("audio/") && !/\.(wav|mp3|m4a|aac|flac|ogg)$/i.test(file.name)) {
    error.value = "Choose an audio file (WAV, MP3, AAC, FLAC, or OGG)."; return;
  }
  if (audioUrl.value) URL.revokeObjectURL(audioUrl.value);
  selectedFile.value = file; audioUrl.value = URL.createObjectURL(file); processing.value = true; progress.value = 12;
  try {
    const buffer = await file.arrayBuffer(); progress.value = 35;
    const context = new AudioContext();
    const decoded = await context.decodeAudioData(buffer); progress.value = 63;
    duration.value = decoded.duration;
    let sumSquares = 0, max = 0, count = 0;
    // Sample up to 4.8m points; enough for a responsive local estimate.
    const stride = Math.max(1, Math.floor(decoded.length / 4800000));
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      const data = decoded.getChannelData(channel);
      for (let i = 0; i < data.length; i += stride) { const sample = data[i]; sumSquares += sample * sample; max = Math.max(max, Math.abs(sample)); count++; }
    }
    const rms = Math.sqrt(sumSquares / count);
    // RMS offset is a practical browser-only approximation of program loudness, not a replacement for EBU R128 metering.
    integrated.value = Math.max(-70, 20 * Math.log10(Math.max(rms, 1e-9)) - 0.7);
    peak.value = 20 * Math.log10(Math.max(max, 1e-9));
    crest.value = peak.value - integrated.value;
    await context.close(); progress.value = 100;
  } catch {
    error.value = "This file could not be decoded. Try WAV, MP3, AAC, FLAC, or OGG."; selectedFile.value = null;
  } finally { setTimeout(() => { processing.value = false; }, 300); }
}

function togglePreview() {
  if (!player.value) return;
  if (isPreviewing.value) { player.value.pause(); isPreviewing.value = false; }
  else { player.value.volume = Math.pow(10, selectedPenalty.value / 20); player.value.play(); isPreviewing.value = true; }
}
function reset() { if (audioUrl.value) URL.revokeObjectURL(audioUrl.value); selectedFile.value = null; integrated.value = peak.value = crest.value = null; audioUrl.value = ""; duration.value = 0; error.value = ""; }
onBeforeUnmount(() => { if (audioUrl.value) URL.revokeObjectURL(audioUrl.value); });
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
      <div class="upload-card" :class="{ dragging: isDragging }" @dragover.prevent="isDragging = true" @dragleave.prevent="isDragging = false" @drop.prevent="dropFile">
        <div class="upload-icon"><span>↑</span></div>
        <h2>Drop your master here</h2>
        <p>WAV, AIFF, MP3, AAC, FLAC, or OGG</p>
        <button class="primary" @click="chooseFile">Choose audio file <span>→</span></button>
        <input ref="fileInput" type="file" accept="audio/*,.wav,.aiff,.mp3,.m4a,.aac,.flac,.ogg" @change="onFileInput" />
        <small>Your file stays on this device. Always.</small>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
      <div class="supported"><span>LOCAL · PRIVATE · NO ACCOUNT</span><div></div><span>BUILT FOR MASTERING</span></div>
    </section>

    <section v-else class="results-wrap">
      <div class="filebar">
        <div class="file-icon">♫</div><div><strong>{{ selectedFile.name }}</strong><span>{{ fileSize }} · {{ durationText }}</span></div>
        <button class="text-button" @click="reset">Analyze another <span>↗</span></button>
      </div>
      <div v-if="processing" class="processing"><div class="progress"><i :style="{ width: progress + '%' }"></i></div><span>Reading your master locally… {{ progress }}%</span></div>
      <template v-else>
        <div class="metrics">
          <article><p>INTEGRATED LOUDNESS</p><strong>{{ displayDb(integrated, ' LUFS') }}</strong><span>Approx. program loudness</span></article>
          <article><p>TRUE PEAK</p><strong>{{ displayDb(peak, ' dBTP') }}</strong><span>Sample peak estimate</span></article>
          <article><p>CREST FACTOR</p><strong>{{ crest?.toFixed(1) ?? '—' }} <b>dB</b></strong><span>Peak-to-loudness range</span></article>
        </div>
        <div class="section-title"><div><p class="eyebrow">NORMALIZATION PREVIEW</p><h2>Streaming service impact</h2></div><p>Estimated gain adjustment relative to each<br />platform’s standard playback level.</p></div>
        <div class="service-grid">
          <button v-for="item in services" :key="item.service" class="service" :class="{ active: selectedService === item.service }" @click="selectedService = item.service">
            <span class="service-dot" :style="{ background: item.color }"></span><div><strong>{{ item.service }}</strong><small>{{ item.note }} · {{ item.target }} LUFS</small></div><b :class="{ neutral: penalty(item.target) === 0 }">{{ displayDb(penalty(item.target), ' dB') }}</b>
          </button>
        </div>
        <div class="preview">
          <div><p class="eyebrow">A/B PLAYBACK</p><h3>Hear the {{ selectedService }} version</h3><span>Preview applies {{ displayDb(selectedPenalty, ' dB') }} gain locally.</span></div>
          <div class="wave"><i v-for="n in 32" :key="n" :style="{ height: (20 + ((n * 31) % 58)) + '%' }"></i></div>
          <button class="play" @click="togglePreview">{{ isPreviewing ? 'Ⅱ' : '▶' }}</button>
          <audio ref="player" :src="audioUrl" @ended="isPreviewing = false"></audio>
        </div>
        <p class="disclaimer">Results use a fast browser-based loudness estimate. Use a certified EBU R128 meter for delivery-critical specifications.</p>
      </template>
    </section>
  </main>
</template>
