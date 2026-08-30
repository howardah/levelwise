<script setup lang="ts">
import { computed, ref, toRef } from "vue";
import { useAudioPreview } from "../composables/useAudioPreview";
import {
  formatDb,
  gainAdjustment,
  streamingServices,
  type PreviewTrack,
} from "../lib/loudness";

const props = defineProps<{
  selectedFile: PreviewTrack;
  duration: number;
  integrated: number | null;
}>();
const emit = defineEmits<{ error: [message: string] }>();

const selectedService = ref("Spotify");
const selectedPenalty = computed(() => {
  const service =
    streamingServices.find(({ service }) => service === selectedService.value) ??
    streamingServices[0];
  return gainAdjustment(service.target, service.canBoost, props.integrated);
});
const preview = useAudioPreview({
  selectedFile: toRef(props, "selectedFile"),
  duration: toRef(props, "duration"),
  gain: selectedPenalty,
  onError: (message) => emit("error", message),
});
</script>

<template>
  <div class="section-title">
    <div>
      <p class="eyebrow">NORMALIZATION PREVIEW</p>
      <h2>Streaming service impact</h2>
    </div>
    <p>Estimated gain adjustment relative to each<br />platform’s standard playback level.</p>
  </div>
  <div class="service-grid">
    <button
      v-for="item in streamingServices"
      :key="item.service"
      class="service"
      :class="{ active: selectedService === item.service }"
      @click="selectedService = item.service"
    >
      <span class="service-dot" :style="{ background: item.color }"></span>
      <div>
        <strong>{{ item.service }}</strong>
        <small>{{ item.note }} · {{ item.target }} LUFS</small>
      </div>
      <b
        :class="{
          neutral: gainAdjustment(item.target, item.canBoost, integrated) === 0,
          boost: gainAdjustment(item.target, item.canBoost, integrated) > 0,
        }"
      >
        {{ formatDb(gainAdjustment(item.target, item.canBoost, integrated), " dB") }}
      </b>
    </button>
  </div>
  <div class="preview">
    <div>
      <p class="eyebrow">NORMALIZATION REFERENCE</p>
      <h3>{{ selectedService }} would apply {{ formatDb(selectedPenalty, " dB") }}</h3>
      <span>Results are calculated locally against the platform target.</span>
    </div>
    <div class="preview-transport">
      <button
        class="wave"
        :class="{ loading: preview.waveformLoading.value }"
        type="button"
        aria-label="Seek through preview"
        @click="preview.seek"
      >
        <i
          v-for="(height, index) in preview.waveBars.value"
          :key="index"
          :class="{
            played:
              index / preview.waveBars.value.length <=
              preview.previewTime.value / Math.max(duration, 1),
          }"
          :style="{ height: height + '%' }"
        ></i>
        <span
          class="playhead"
          :style="{
            left: `${Math.min(100, (preview.previewTime.value / Math.max(duration, 1)) * 100)}%`,
          }"
        ></span>
      </button>
      <span class="preview-time">
        {{ preview.previewTimeText.value }} / {{ preview.durationText.value }}
      </span>
    </div>
    <button
      class="play"
      :aria-label="preview.isPreviewing.value ? 'Pause preview' : 'Play normalized preview'"
      @click="preview.toggle"
    >
      {{ preview.isPreviewing.value ? "Ⅱ" : "▶" }}
    </button>
    <audio
      :ref="preview.setPlayerA"
      @play="preview.onPlay(0)"
      @pause="preview.onPause(0)"
      @timeupdate="preview.onTimeUpdate(0)"
      @ended="preview.onEnd(0)"
    ></audio>
    <audio
      :ref="preview.setPlayerB"
      @play="preview.onPlay(1)"
      @pause="preview.onPause(1)"
      @timeupdate="preview.onTimeUpdate(1)"
      @ended="preview.onEnd(1)"
    ></audio>
  </div>
</template>
