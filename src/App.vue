<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { open } from "@tauri-apps/api/dialog";
import { convertFileSrc, invoke } from "@tauri-apps/api/tauri";
import { listen } from "@tauri-apps/api/event";
import { appWindow } from "@tauri-apps/api/window";
import {
  audioExtensions,
  fileName,
  formatDb,
  formatDuration,
  gainAdjustment,
  streamingServices,
  type Analysis,
  type Recording,
} from "./lib/loudness";

type PreviewTrack = { name: string; path: string; durationSeconds?: number };
const selectedFile = ref<PreviewTrack | null>(null);
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
const playerA = ref<HTMLAudioElement>();
const playerB = ref<HTMLAudioElement>();
const isPreviewing = ref(false);
const previewTime = ref(0);
const waveform = ref<number[]>([]);
const waveformLoading = ref(false);
let unlistenFileDrop: (() => void) | undefined;
let audioContext: AudioContext | undefined;
let gainNodes: GainNode[] = [];
let activeDeck = 0;
const playbackPositions = new Map<string, number>();

const adjustment = (target: number, canBoost: boolean, loudness = integrated.value) => gainAdjustment(target, canBoost, loudness);
const selectedPenalty = computed(() => {
  const service = streamingServices.find(({ service }) => service === selectedService.value) ?? streamingServices[0];
  return adjustment(service.target, service.canBoost);
});
const durationText = computed(() => formatDuration(duration.value));
const previewTimeText = computed(() => formatDuration(previewTime.value));
const waveBars = computed(() => waveform.value.length ? waveform.value : Array.from({ length: 80 }, (_, index) => 18 + ((index * 19) % 55)));
const players = () => [playerA.value, playerB.value].filter((player): player is HTMLAudioElement => Boolean(player));
const currentPlayer = () => [playerA.value, playerB.value][activeDeck];

async function chooseFile() {
  const paths = await open({ multiple: true, filters: [{ name: "Audio", extensions: audioExtensions }] });
  if (typeof paths === "string") analyzeBatch([paths]);
  else if (Array.isArray(paths)) analyzeBatch(paths);
}
async function analyzeFile(path: string) {
  error.value = "";
  const name = fileName(path);
  selectedFile.value = { name, path }; integrated.value = peak.value = lra.value = null; progress.value = 0;
  const unlisten = await listen<number>("analysis-progress", ({ payload }) => { progress.value = payload; });
  // Some compressed files do not expose a total frame count. Keep their progress indicator alive
  // until the backend supplies the final result.
  const fallbackProgress = window.setInterval(() => { if (progress.value < 90) progress.value += 1; }, 700);
  try {
    const result = await invoke<Analysis>("analyze_audio", { path });
    duration.value = result.durationSeconds; integrated.value = result.integratedLufs; peak.value = result.truePeakDbtp; lra.value = result.loudnessRange; progress.value = 100;
    recordings.value.push({ name, path, ...result });
  } catch (reason) {
    error.value = typeof reason === "string" ? reason : "This file could not be decoded."; selectedFile.value = null;
  } finally { window.clearInterval(fallbackProgress); unlisten(); }
}
async function analyzeBatch(paths: string[]) {
  const uniquePaths = [...new Set(paths)];
  if (!uniquePaths.length) return;
  recordings.value = []; batchTotal.value = uniquePaths.length; batchIndex.value = 0; processing.value = true;
  try {
    for (const [index, path] of uniquePaths.entries()) { batchIndex.value = index + 1; await analyzeFile(path); }
  } finally { batchTotal.value = 0; processing.value = false; }
}
async function selectRecording(recording: Recording) {
  const shouldKeepPlaying = isPreviewing.value;
  const previous = selectedFile.value;
  if (previous?.path === recording.path) return;
  savePlaybackPosition();
  selectedFile.value = recording; duration.value = recording.durationSeconds; integrated.value = recording.integratedLufs; peak.value = recording.truePeakDbtp; lra.value = recording.loudnessRange;
  if (shouldKeepPlaying) await switchPreview(recording, true);
}

async function togglePreview() {
  const player = currentPlayer();
  if (isPreviewing.value && player) { player.pause(); return; }
  if (!selectedFile.value) return;
  setupPreviewGain();
  if (player?.dataset.path !== selectedFile.value.path) await switchPreview(selectedFile.value, false);
  audioContext?.resume();
  currentPlayer()?.play().catch(() => { error.value = "Playback could not start for this file."; });
}
function setupPreviewGain() {
  if (gainNodes.length) { applyPreviewGain(selectedPenalty.value); return; }
  const decks = players();
  if (decks.length !== 2) return;
  audioContext = new AudioContext();
  gainNodes = decks.map((deck) => {
    const gain = audioContext!.createGain();
    audioContext!.createMediaElementSource(deck).connect(gain).connect(audioContext!.destination);
    return gain;
  });
  applyPreviewGain(selectedPenalty.value);
}
function applyPreviewGain(gain: number) {
  const value = Math.pow(10, gain / 20);
  if (gainNodes.length && audioContext) gainNodes[activeDeck]?.gain.setValueAtTime(value, audioContext.currentTime);
  else {
    const player = currentPlayer();
    if (player) player.volume = Math.min(1, value);
  }
}
function savedPosition(recording: PreviewTrack) {
  const position = playbackPositions.get(recording.path) ?? 0;
  return position >= (recording.durationSeconds ?? duration.value) - 0.05 ? 0 : position;
}
function savePlaybackPosition() {
  const player = currentPlayer();
  if (player?.dataset.path && Number.isFinite(player.currentTime)) playbackPositions.set(player.dataset.path, player.currentTime);
}
function loadDeck(player: HTMLAudioElement, recording: PreviewTrack, position: number) {
  return new Promise<void>((resolve) => {
    const ready = () => { player.currentTime = Math.min(position, Math.max(0, player.duration || position)); resolve(); };
    player.dataset.path = recording.path;
    player.src = convertFileSrc(recording.path);
    player.addEventListener("loadedmetadata", ready, { once: true });
    player.load();
  });
}
async function switchPreview(recording: PreviewTrack, crossfade: boolean) {
  await nextTick();
  setupPreviewGain();
  const outgoing = currentPlayer();
  const nextDeck = activeDeck === 0 ? 1 : 0;
  const incoming = [playerA.value, playerB.value][nextDeck];
  if (!incoming) return;
  const resumeAt = savedPosition(recording);
  await loadDeck(incoming, recording, resumeAt);
  activeDeck = nextDeck;
  previewTime.value = resumeAt;
  if (!crossfade || !outgoing || !audioContext || !gainNodes.length) {
    if (gainNodes[nextDeck] && audioContext) gainNodes[nextDeck].gain.setValueAtTime(Math.pow(10, selectedPenalty.value / 20), audioContext.currentTime);
    return;
  }
  const now = audioContext.currentTime;
  const targetGain = Math.pow(10, selectedPenalty.value / 20);
  gainNodes[nextDeck].gain.setValueAtTime(0.0001, now);
  await audioContext.resume();
  await incoming.play();
  gainNodes[nextDeck].gain.exponentialRampToValueAtTime(targetGain, now + 0.18);
  gainNodes[activeDeck === 0 ? 1 : 0].gain.cancelScheduledValues(now);
  gainNodes[activeDeck === 0 ? 1 : 0].gain.setValueAtTime(gainNodes[activeDeck === 0 ? 1 : 0].gain.value, now);
  gainNodes[activeDeck === 0 ? 1 : 0].gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
  window.setTimeout(() => outgoing.pause(), 190);
}
function seekPreview(event: MouseEvent) {
  const player = currentPlayer();
  if (!player || !duration.value) return;
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const position = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)) * duration.value;
  player.currentTime = position; previewTime.value = position;
  if (selectedFile.value) playbackPositions.set(selectedFile.value.path, position);
}
function onTimeUpdate(deck: number) {
  if (deck !== activeDeck) return;
  const player = currentPlayer();
  if (!player) return;
  previewTime.value = player.currentTime;
  if (selectedFile.value) playbackPositions.set(selectedFile.value.path, player.currentTime);
}
function onPreviewEnd(deck: number) {
  if (deck !== activeDeck) return;
  isPreviewing.value = false;
  if (selectedFile.value) playbackPositions.set(selectedFile.value.path, duration.value);
}
async function buildWaveform(recording: PreviewTrack) {
  waveformLoading.value = true; waveform.value = [];
  try {
    const context = audioContext ?? new AudioContext();
    const data = await fetch(convertFileSrc(recording.path)).then((response) => response.arrayBuffer());
    const decoded = await context.decodeAudioData(data);
    const bars = 88, block = Math.max(1, Math.floor(decoded.length / bars));
    const values = Array.from({ length: bars }, (_, bar) => {
      let peakValue = 0;
      for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
        const samples = decoded.getChannelData(channel);
        for (let index = bar * block; index < Math.min(samples.length, (bar + 1) * block); index += 1) peakValue = Math.max(peakValue, Math.abs(samples[index]));
      }
      return peakValue;
    });
    const maximum = Math.max(...values, 0.0001);
    if (selectedFile.value?.path === recording.path) waveform.value = values.map((value) => Math.max(8, Math.round(100 * Math.sqrt(value / maximum))));
    if (!audioContext) await context.close();
  } catch { if (selectedFile.value?.path === recording.path) waveform.value = []; } finally { if (selectedFile.value?.path === recording.path) waveformLoading.value = false; }
}
function reset() { players().forEach((player) => player.pause()); isPreviewing.value = false; playbackPositions.clear(); selectedFile.value = null; recordings.value = []; integrated.value = peak.value = lra.value = null; duration.value = 0; previewTime.value = 0; error.value = ""; }

watch(selectedPenalty, applyPreviewGain);
watch(() => selectedFile.value?.path, () => {
  previewTime.value = selectedFile.value ? savedPosition(selectedFile.value) : 0;
  if (selectedFile.value) void buildWaveform(selectedFile.value);
});
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
onBeforeUnmount(() => { unlistenFileDrop?.(); players().forEach((player) => player.pause()); audioContext?.close(); });
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
      <div v-if="processing" class="processing" :class="{ 'processing-inline': recordings.length }"><div class="progress"><i :style="{ width: progress + '%' }"></i></div><span>Analyzing {{ batchTotal > 1 ? `recording ${batchIndex} of ${batchTotal}` : 'your master' }} locally… {{ progress }}%</span></div>
      <template v-if="!processing || recordings.length">
        <div class="metrics">
          <article><p>INTEGRATED LOUDNESS</p><strong>{{ formatDb(integrated, ' LUFS') }}</strong><span>Gated EBU R128 measurement</span></article>
          <article><p>TRUE PEAK</p><strong>{{ formatDb(peak, ' dBTP') }}</strong><span>4× oversampled peak scan</span></article>
          <article><p>LOUDNESS RANGE</p><strong>{{ lra?.toFixed(1) ?? '—' }} <b>LU</b></strong><span>EBU Tech 3342 range</span></article>
        </div>
        <div v-if="recordings.length > 1" class="comparison">
          <div class="comparison-head"><div><p class="eyebrow">BATCH COMPARISON</p><h2>{{ recordings.length }} recordings</h2></div><span>Click a recording to inspect and preview it.</span></div>
          <button v-for="recording in recordings" :key="recording.path" class="recording-row" :class="{ active: selectedFile?.path === recording.path }" @click="selectRecording(recording)">
            <strong>{{ recording.name }}</strong><span>{{ formatDb(recording.integratedLufs, ' LUFS') }}</span><span>{{ formatDb(recording.truePeakDbtp, ' dBTP') }}</span><span>{{ recording.loudnessRange.toFixed(1) }} LU</span>
          </button>
        </div>
        <div class="section-title"><div><p class="eyebrow">NORMALIZATION PREVIEW</p><h2>Streaming service impact</h2></div><p>Estimated gain adjustment relative to each<br />platform’s standard playback level.</p></div>
        <div class="service-grid">
          <button v-for="item in streamingServices" :key="item.service" class="service" :class="{ active: selectedService === item.service }" @click="selectedService = item.service">
            <span class="service-dot" :style="{ background: item.color }"></span><div><strong>{{ item.service }}</strong><small>{{ item.note }} · {{ item.target }} LUFS</small></div><b :class="{ neutral: adjustment(item.target, item.canBoost) === 0, boost: adjustment(item.target, item.canBoost) > 0 }">{{ formatDb(adjustment(item.target, item.canBoost), ' dB') }}</b>
          </button>
        </div>
        <div class="preview">
          <div><p class="eyebrow">NORMALIZATION REFERENCE</p><h3>{{ selectedService }} would apply {{ formatDb(selectedPenalty, ' dB') }}</h3><span>Results are calculated locally against the platform target.</span></div>
          <div class="preview-transport">
            <button class="wave" :class="{ loading: waveformLoading }" type="button" aria-label="Seek through preview" @click="seekPreview">
              <i v-for="(height, index) in waveBars" :key="index" :class="{ played: (index / waveBars.length) <= (previewTime / Math.max(duration, 1)) }" :style="{ height: height + '%' }"></i>
              <span class="playhead" :style="{ left: `${Math.min(100, (previewTime / Math.max(duration, 1)) * 100)}%` }"></span>
            </button>
            <span class="preview-time">{{ previewTimeText }} / {{ durationText }}</span>
          </div>
          <button class="play" :aria-label="isPreviewing ? 'Pause preview' : 'Play normalized preview'" @click="togglePreview">{{ isPreviewing ? 'Ⅱ' : '▶' }}</button>
          <audio ref="playerA" @play="activeDeck === 0 && (isPreviewing = true)" @pause="activeDeck === 0 && (isPreviewing = false)" @timeupdate="onTimeUpdate(0)" @ended="onPreviewEnd(0)"></audio>
          <audio ref="playerB" @play="activeDeck === 1 && (isPreviewing = true)" @pause="activeDeck === 1 && (isPreviewing = false)" @timeupdate="onTimeUpdate(1)" @ended="onPreviewEnd(1)"></audio>
        </div>
        <p class="disclaimer">EBU R128 / ITU-R BS.1770 analysis is performed locally in the Rust backend. No audio leaves your device.</p>
      </template>
    </section>
  </main>
</template>
