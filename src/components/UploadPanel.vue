<script setup lang="ts">
defineProps<{ isDragging: boolean; error: string }>();
defineEmits<{ choose: [] }>();
</script>

<template>
  <section class="upload-shell">
    <div class="upload-card" :class="{ dragging: isDragging }">
      <div class="upload-icon"><span>↑</span></div>
      <h2>Drop your masters here</h2>
      <p>Choose one file or a batch · WAV, AIFF, MP3, AAC, FLAC, or OGG</p>
      <button class="primary" @click="$emit('choose')">Choose audio files <span>→</span></button>
      <small>Your file stays on this device. Always.</small>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <div class="supported">
      <span>LOCAL · PRIVATE · NO ACCOUNT</span>
      <div></div>
      <span>BUILT FOR MASTERING</span>
    </div>
  </section>
</template>
