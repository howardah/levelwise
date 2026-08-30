import { onBeforeUnmount, onMounted, ref } from "vue";
import { analyzeAudio, chooseAudioFiles, listenToAudioFileDrops } from "../lib/audioBackend";
import { fileName, type PreviewTrack, type Recording } from "../lib/loudness";

export function useAudioAnalysis() {
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
  let unlistenFileDrop: (() => void) | undefined;

  function setError(message: string) {
    error.value = message;
  }

  async function analyzeFile(path: string) {
    error.value = "";
    const name = fileName(path);
    selectedFile.value = { name, path };
    integrated.value = peak.value = lra.value = null;
    progress.value = 0;
    const fallbackProgress = window.setInterval(() => {
      if (progress.value < 90) progress.value += 1;
    }, 700);
    try {
      const result = await analyzeAudio(path, (percentage) => (progress.value = percentage));
      duration.value = result.durationSeconds;
      integrated.value = result.integratedLufs;
      peak.value = result.truePeakDbtp;
      lra.value = result.loudnessRange;
      progress.value = 100;
      recordings.value.push({ name, path, ...result });
    } catch (reason) {
      error.value = typeof reason === "string" ? reason : "This file could not be decoded.";
      selectedFile.value = null;
    } finally {
      window.clearInterval(fallbackProgress);
    }
  }

  async function analyzeBatch(paths: string[]) {
    const uniquePaths = [...new Set(paths)];
    if (!uniquePaths.length) return;
    recordings.value = [];
    batchTotal.value = uniquePaths.length;
    batchIndex.value = 0;
    processing.value = true;
    try {
      for (const [index, path] of uniquePaths.entries()) {
        batchIndex.value = index + 1;
        await analyzeFile(path);
      }
    } finally {
      batchTotal.value = 0;
      processing.value = false;
    }
  }

  async function chooseFiles() {
    await analyzeBatch(await chooseAudioFiles());
  }

  function selectRecording(recording: Recording) {
    if (selectedFile.value?.path === recording.path) return;
    selectedFile.value = recording;
    duration.value = recording.durationSeconds;
    integrated.value = recording.integratedLufs;
    peak.value = recording.truePeakDbtp;
    lra.value = recording.loudnessRange;
  }

  function reset() {
    selectedFile.value = null;
    recordings.value = [];
    integrated.value = peak.value = lra.value = null;
    duration.value = 0;
    error.value = "";
  }

  onMounted(async () => {
    unlistenFileDrop = await listenToAudioFileDrops(analyzeBatch, (value) => {
      isDragging.value = value;
    });
  });
  onBeforeUnmount(() => unlistenFileDrop?.());

  return {
    selectedFile,
    recordings,
    batchIndex,
    batchTotal,
    isDragging,
    processing,
    progress,
    error,
    duration,
    integrated,
    peak,
    lra,
    chooseFiles,
    analyzeBatch,
    selectRecording,
    setError,
    reset,
  };
}
