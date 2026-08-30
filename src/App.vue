<script setup lang="ts">
import AnalysisResults from "./components/AnalysisResults.vue";
import AppHeader from "./components/AppHeader.vue";
import HeroSection from "./components/HeroSection.vue";
import UploadPanel from "./components/UploadPanel.vue";
import { useAudioAnalysis } from "./composables/useAudioAnalysis";

const analysis = useAudioAnalysis();
</script>

<template>
  <main>
    <AppHeader />
    <HeroSection />
    <UploadPanel
      v-if="!analysis.selectedFile.value"
      :is-dragging="analysis.isDragging.value"
      :error="analysis.error.value"
      @choose="analysis.chooseFiles"
    />
    <AnalysisResults
      v-else
      :selected-file="analysis.selectedFile.value"
      :recordings="analysis.recordings.value"
      :batch-index="analysis.batchIndex.value"
      :batch-total="analysis.batchTotal.value"
      :processing="analysis.processing.value"
      :progress="analysis.progress.value"
      :duration="analysis.duration.value"
      :integrated="analysis.integrated.value"
      :peak="analysis.peak.value"
      :lra="analysis.lra.value"
      :error="analysis.error.value"
      @reset="analysis.reset"
      @select="analysis.selectRecording"
      @error="analysis.setError"
    />
  </main>
</template>
