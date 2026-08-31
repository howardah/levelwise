<script setup lang="ts">
import { formatDuration, type PreviewTrack, type Recording } from "../lib/loudness";
import AnalysisMetrics from "./AnalysisMetrics.vue";
import RecordingComparison from "./RecordingComparison.vue";
import StreamingPreview from "./StreamingPreview.vue";

defineProps<{
  selectedFile: PreviewTrack;
  recordings: Recording[];
  batchIndex: number;
  batchTotal: number;
  processing: boolean;
  progress: number;
  duration: number;
  integrated: number | null;
  peak: number | null;
  lra: number | null;
  error: string;
}>();
defineEmits<{
  reset: [];
  select: [recording: Recording];
  error: [message: string];
}>();
</script>

<template>
  <section class="results-wrap">
    <div class="filebar">
      <div class="file-icon">♫</div>
      <div>
        <strong>{{ selectedFile.name }}</strong>
        <span>{{ formatDuration(duration) }} · analyzed in Rust</span>
      </div>
      <button class="text-button" @click="$emit('reset')">Analyze another <span>↗</span></button>
    </div>
    <div v-if="processing" class="processing" :class="{ 'processing-inline': recordings.length }">
      <div class="progress"><i :style="{ width: progress + '%' }"></i></div>
      <span>
        Analyzing
        {{ batchTotal > 1 ? `recording ${batchIndex} of ${batchTotal}` : "your master" }} locally…
        {{ progress }}%
      </span>
    </div>
    <template v-if="!processing || recordings.length">
      <AnalysisMetrics :integrated="integrated" :peak="peak" :lra="lra" />
      <RecordingComparison
        v-if="recordings.length > 1"
        :recordings="recordings"
        :selected-path="selectedFile.path"
        @select="$emit('select', $event)"
      />
      <StreamingPreview
        :selected-file="selectedFile"
        :duration="duration"
        :integrated="integrated"
        @error="$emit('error', $event)"
      />
      <p v-if="error" class="error">{{ error }}</p>
      <p class="disclaimer">
        EBU R128 / ITU-R BS.1770 analysis is performed locally in the Rust backend. No audio leaves
        your device.
      </p>
    </template>
  </section>
</template>
