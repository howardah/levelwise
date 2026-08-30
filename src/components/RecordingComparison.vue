<script setup lang="ts">
import { formatDb, type Recording } from "../lib/loudness";

defineProps<{ recordings: Recording[]; selectedPath: string }>();
defineEmits<{ select: [recording: Recording] }>();
</script>

<template>
  <div class="comparison">
    <div class="comparison-head">
      <div>
        <p class="eyebrow">BATCH COMPARISON</p>
        <h2>{{ recordings.length }} recordings</h2>
      </div>
      <span>Click a recording to inspect and preview it.</span>
    </div>
    <button
      v-for="recording in recordings"
      :key="recording.path"
      class="recording-row"
      :class="{ active: selectedPath === recording.path }"
      @click="$emit('select', recording)"
    >
      <strong>{{ recording.name }}</strong>
      <span>{{ formatDb(recording.integratedLufs, " LUFS") }}</span>
      <span>{{ formatDb(recording.truePeakDbtp, " dBTP") }}</span>
      <span>{{ recording.loudnessRange.toFixed(1) }} LU</span>
    </button>
  </div>
</template>
